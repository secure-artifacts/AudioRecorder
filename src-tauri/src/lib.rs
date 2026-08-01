use base64::{engine::general_purpose, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::{Body, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    fs,
    io::{Cursor, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use tauri::{
    AppHandle,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
    Manager,
};
#[cfg(target_os = "windows")]
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0},
        Media::MediaFoundation::{
            MFCreateMediaType, MFCreateSourceReaderFromURL, MFAudioFormat_Float, MFMediaType_Audio,
            MFShutdown, MFStartup, MFSTARTUP_FULL,
            MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_MAJOR_TYPE,
            MF_MT_SUBTYPE, MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED,
            MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READER_ALL_STREAMS,
            MF_SOURCE_READER_FIRST_AUDIO_STREAM, MF_VERSION,
        },
        System::Threading::{
            CreateEventW, CreateMutexW, OpenEventW, ReleaseMutex, SetEvent, WaitForSingleObject,
            EVENT_ALL_ACCESS, INFINITE,
        },
    },
};

#[cfg(target_os = "windows")]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

#[derive(Default)]
struct RecordingWindows(Mutex<HashSet<String>>);

#[derive(Default)]
struct GoogleOAuthCancel(Mutex<Option<Arc<AtomicBool>>>);

const WAVEFORM_CACHE_VERSION: &[u8] = b"waveform-cache-v9-ffmpeg-200k-12khz";
const SOURCE_CACHE_FOLDER: &str = ".AudioRecorderCache";
const STARTUP_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const STARTUP_APP_NAME: &str = "AudioRecorder";

#[cfg(target_os = "windows")]
struct NormalSingleInstanceGuard {
    mutex: HANDLE,
    event: HANDLE,
    event_name: String,
}

#[cfg(target_os = "windows")]
impl Drop for NormalSingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.mutex);
            let _ = CloseHandle(self.event);
        }
    }
}

#[cfg(target_os = "windows")]
enum NormalSingleInstanceResult {
    Primary(NormalSingleInstanceGuard),
    SecondarySignaled,
    ShellAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct GoogleDriveToken {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    client_secret: String,
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    expires_at: u64,
    #[serde(default)]
    email: String,
}

#[derive(Debug, Clone, Serialize)]
struct GoogleDriveStatus {
    connected: bool,
    email: String,
}

#[derive(Debug, Clone, Serialize)]
struct GoogleOAuthClientConfig {
    client_id: String,
    client_secret: String,
    client_type: String,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DriveUploadMetadata {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parents: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct DriveUploadResponse {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "webViewLink")]
    web_view_link: Option<String>,
}

#[derive(Debug, Serialize)]
struct DrivePermissionRequest {
    role: String,
    #[serde(rename = "type")]
    permission_type: String,
    #[serde(rename = "allowFileDiscovery")]
    allow_file_discovery: bool,
}

#[derive(Debug, Clone, Serialize)]
struct GoogleDriveUploadProgress {
    upload_id: u64,
    sent_bytes: u64,
    total_bytes: u64,
    percent: u8,
}

#[derive(Debug, Clone, Serialize)]
struct NativeAudioMetadata {
    duration_seconds: f64,
    sample_rate: u32,
    channels: usize,
    frame_count: u64,
    file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NativeAudioWaveform {
    duration: f64,
    sample_rate: u32,
    channels: usize,
    point_count: usize,
    mins: Vec<f32>,
    maxs: Vec<f32>,
    cache_hit: bool,
}

#[derive(Debug, Clone, Serialize)]
struct NativeAudioWaveformLevels {
    levels: Vec<NativeAudioWaveform>,
}

#[derive(Debug, Clone, Serialize)]
struct NativeWaveformProgress {
    request_id: String,
    path: String,
    stage: String,
    percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<NativeAudioWaveform>,
}

#[derive(Debug, Clone, Serialize)]
struct EditorAudioImport {
    source_path: String,
    playback_path: String,
    filename: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorExportSegment {
    source_path: String,
    source_start_frame: u64,
    source_end_frame: u64,
    sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
struct EditorExportResult {
    path: String,
    filename: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mp3ContextMenuPreset {
    id: String,
    title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchAction {
    action_type: String,
    preset_id: Option<String>,
    file_path: String,
    file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellUploadQueueItem {
    preset_id: String,
    file_paths: Vec<String>,
    created_at: u64,
}

struct StartupLaunchAction(Mutex<Option<LaunchAction>>);

#[cfg(target_os = "windows")]
struct ShellUploadOwnerGuard {
    handle: HANDLE,
}

#[cfg(target_os = "windows")]
impl Drop for ShellUploadOwnerGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

struct ProgressReader<R> {
    inner: R,
    upload_id: u64,
    sent_bytes: u64,
    total_bytes: u64,
    last_percent: u8,
    on_progress: Box<dyn FnMut(GoogleDriveUploadProgress) + Send>,
}

impl<R: Read> Read for ProgressReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read_count = self.inner.read(buffer)?;
        if read_count == 0 {
            return Ok(0);
        }

        self.sent_bytes = self.sent_bytes.saturating_add(read_count as u64);
        let percent = if self.total_bytes == 0 {
            100
        } else {
            ((self.sent_bytes.saturating_mul(100)) / self.total_bytes).min(100) as u8
        };
        if percent != self.last_percent || self.sent_bytes >= self.total_bytes {
            self.last_percent = percent;
            (self.on_progress)(GoogleDriveUploadProgress {
                upload_id: self.upload_id,
                sent_bytes: self.sent_bytes,
                total_bytes: self.total_bytes,
                percent,
            });
        }

        Ok(read_count)
    }
}

fn clean_filename(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect();

    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "recording.mp3".to_string()
    } else {
        trimmed
    }
}

fn default_recordings_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .or_else(dirs::audio_dir)
        .or_else(dirs::home_dir)
        .map(|base| base.join("AudioRecorder"))
        .ok_or_else(|| "无法定位系统下载目录".to_string())
}

fn recordings_dir(save_dir: Option<String>) -> Result<PathBuf, String> {
    let trimmed = save_dir.unwrap_or_default().trim().to_string();
    let dir = if trimmed.is_empty() {
        default_recordings_dir()?
    } else {
        PathBuf::from(trimmed)
    };
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建保存目录: {err}"))?;
    Ok(dir)
}

fn unique_recording_path(dir: PathBuf, filename: &str) -> PathBuf {
    let cleaned = clean_filename(filename);
    let original_path = dir.join(&cleaned);
    if !original_path.exists() {
        return original_path;
    }

    let source_path = PathBuf::from(&cleaned);
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let extension = source_path.extension().and_then(|value| value.to_str());

    for index in 1..10_000 {
        let next_name = match extension {
            Some(ext) if !ext.is_empty() => format!("{stem} ({index}).{ext}"),
            _ => format!("{stem} ({index})"),
        };
        let next_path = dir.join(next_name);
        if !next_path.exists() {
            return next_path;
        }
    }

    let timestamp = chrono_like_timestamp();
    match extension {
        Some(ext) if !ext.is_empty() => dir.join(format!("{stem} ({timestamp}).{ext}")),
        _ => dir.join(format!("{stem} ({timestamp})")),
    }
}

fn chrono_like_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "copy".to_string())
}

fn cache_dir(save_dir: Option<String>) -> Result<PathBuf, String> {
    let dir = recordings_dir(save_dir)?.join("录音缓存文件");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建录音缓存目录: {err}"))?;
    Ok(dir)
}

#[cfg(target_os = "windows")]
fn hide_cache_root_folder(dir: &Path) {
    if !dir.exists() {
        return;
    }
    let mut command = Command::new("attrib");
    command.arg("+h").arg(dir);
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
}

#[cfg(not(target_os = "windows"))]
fn hide_cache_root_folder(_dir: &Path) {}

fn ensure_writable_cache_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("无法创建缓存目录 {}: {err}", dir.display()))?;
    let probe = dir.join(format!(".write-test-{}.tmp", chrono_like_timestamp()));
    fs::write(&probe, b"ok").map_err(|err| format!("缓存目录不可写 {}: {err}", dir.display()))?;
    let _ = fs::remove_file(probe);
    Ok(())
}

fn save_dir_cache_dir(save_dir: Option<String>, kind: &str) -> Result<PathBuf, String> {
    let cache_root = recordings_dir(save_dir)?.join(SOURCE_CACHE_FOLDER);
    fs::create_dir_all(&cache_root).map_err(|err| format!("无法创建缓存目录 {}: {err}", cache_root.display()))?;
    hide_cache_root_folder(&cache_root);
    let dir = cache_root.join(kind);
    ensure_writable_cache_dir(&dir)?;
    Ok(dir)
}

fn preferred_cache_dir(save_dir: Option<String>, kind: &str) -> Result<PathBuf, String> {
    save_dir_cache_dir(save_dir, kind)
}

fn editor_audio_media_cache_dir_for_save(save_dir: Option<String>) -> Result<PathBuf, String> {
    preferred_cache_dir(save_dir, "editor-audio-media")
}

fn editor_cache_root_for_save(save_dir: Option<String>) -> Result<PathBuf, String> {
    let dir = recordings_dir(save_dir)?.join(SOURCE_CACHE_FOLDER);
    ensure_writable_cache_dir(&dir)?;
    hide_cache_root_folder(&dir);
    Ok(dir)
}

fn canonical_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn path_is_inside(path: &Path, parent: &Path) -> bool {
    canonical_or_original(path).starts_with(canonical_or_original(parent))
}

fn allow_editor_cache_asset_scope(app: &AppHandle, save_dir: Option<String>) -> Result<(), String> {
    let cache_root = editor_cache_root_for_save(save_dir)?;
    app.asset_protocol_scope()
        .allow_directory(cache_root, true)
        .map_err(|err| format!("授权编辑器缓存播放路径失败: {err}"))
}

fn write_file_safely(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建缓存父目录: {err}"))?;
    }
    let tmp_path = path.with_extension(format!(
        "{}tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));
    {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|err| format!("创建临时缓存失败: {err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("写入临时缓存失败: {err}"))?;
        file.sync_all().map_err(|err| format!("同步临时缓存失败: {err}"))?;
    }
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp_path, path).map_err(|err| format!("提交缓存文件失败: {err}"))
}

fn copy_file_safely(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建缓存父目录: {err}"))?;
    }
    let tmp_path = target.with_extension(format!(
        "{}tmp",
        target
            .extension()
            .and_then(|value| value.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));
    fs::copy(source, &tmp_path).map_err(|err| format!("复制音频到临时缓存失败: {err}"))?;
    if target.exists() {
        let _ = fs::remove_file(target);
    }
    fs::rename(&tmp_path, target).map_err(|err| format!("提交编辑器音频缓存失败: {err}"))
}

fn editor_audio_cache_path(source_path: &PathBuf, filename: &str, metadata: &fs::Metadata, save_dir: Option<String>) -> Result<PathBuf, String> {
    let cleaned = clean_filename(filename);
    let source_name = PathBuf::from(&cleaned);
    let stem = source_name
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let extension = source_name.extension().and_then(|value| value.to_str()).unwrap_or("mp3");
    let mut hasher = Sha256::new();
    hasher.update(source_path.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    hasher.update(file_modified_seconds(metadata).to_le_bytes());
    hasher.update(WAVEFORM_CACHE_VERSION);
    let key = format!("{:x}", hasher.finalize());
    Ok(editor_audio_media_cache_dir_for_save(save_dir)?.join(format!("{stem}-{}.{}", &key[..16], extension)))
}

fn file_modified_seconds(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn waveform_cache_path(path: &str, file_size: u64, modified_at: u64, max_points: usize, save_dir: Option<String>) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(WAVEFORM_CACHE_VERSION);
    hasher.update(path.as_bytes());
    hasher.update(file_size.to_le_bytes());
    hasher.update(modified_at.to_le_bytes());
    hasher.update((max_points as u64).to_le_bytes());
    let key = format!("{:x}", hasher.finalize());
    Ok(preferred_cache_dir(save_dir, "waveform-cache")?.join(format!("{key}.json")))
}

fn cleanup_old_files_in_dir(
    dir: &Path,
    max_age: std::time::Duration,
    protected: Option<&str>,
    now: SystemTime,
) -> Result<u64, String> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut deleted_count = 0;
    for entry_result in fs::read_dir(dir).map_err(|err| format!("读取缓存目录失败: {err}"))? {
        let entry = entry_result.map_err(|err| format!("读取缓存文件失败: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            deleted_count += cleanup_old_files_in_dir(&path, max_age, protected, now)?;
            let _ = fs::remove_dir(&path);
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if protected == Some(filename.as_str()) {
            continue;
        }
        let metadata = entry.metadata().map_err(|err| format!("读取缓存文件信息失败: {err}"))?;
        let modified = metadata.modified().map_err(|err| format!("读取缓存修改时间失败: {err}"))?;
        let age = now.duration_since(modified).unwrap_or_default();
        if age > max_age {
            fs::remove_file(&path).map_err(|err| format!("删除过期缓存失败: {err}"))?;
            deleted_count += 1;
        }
    }
    Ok(deleted_count)
}

fn count_files_in_dir(dir: &Path) -> Result<u64, String> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut count = 0;
    for entry_result in fs::read_dir(dir).map_err(|err| format!("读取目录失败 {}: {err}", dir.display()))? {
        let entry = entry_result.map_err(|err| format!("读取目录项失败: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            count += count_files_in_dir(&path)?;
        } else if path.is_file() {
            count += 1;
        }
    }
    Ok(count)
}

fn source_cache_root_for_path(path: &str) -> Option<PathBuf> {
    PathBuf::from(path)
        .parent()
        .map(|parent| parent.join(SOURCE_CACHE_FOLDER))
}

fn audio_hint_for_path(path: &PathBuf) -> Hint {
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    hint
}

fn read_native_audio_metadata_blocking(path: String) -> Result<NativeAudioMetadata, String> {
    let source_path = PathBuf::from(&path);
    let metadata = fs::metadata(&source_path).map_err(|err| format!("读取音频文件信息失败: {err}"))?;
    let file = fs::File::open(&source_path).map_err(|err| format!("打开音频文件失败: {err}"))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = audio_hint_for_path(&source_path);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|err| format!("识别音频格式失败: {err}"))?;
    let track = probed
        .format
        .default_track()
        .ok_or_else(|| "没有找到可解码的音频轨道".to_string())?;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let channels = track.codec_params.channels.map(|value| value.count()).unwrap_or(1).max(1);
    let frame_count = track.codec_params.n_frames.unwrap_or(0);
    let duration_seconds = if frame_count > 0 && sample_rate > 0 {
        frame_count as f64 / sample_rate as f64
    } else {
        0.0
    };
    Ok(NativeAudioMetadata {
        duration_seconds,
        sample_rate,
        channels,
        frame_count,
        file_size: metadata.len(),
    })
}

fn compact_waveform_peaks(mins: &[f32], maxs: &[f32], target_points: usize) -> (Vec<f32>, Vec<f32>) {
    let target_points = target_points.max(1);
    if mins.is_empty() || mins.len() <= target_points {
        return (
            mins.iter().map(|value| if *value == 1.0 { 0.0 } else { *value }).collect(),
            maxs.iter().map(|value| if *value == -1.0 { 0.0 } else { *value }).collect(),
        );
    }

    let mut compact_mins = Vec::with_capacity(target_points);
    let mut compact_maxs = Vec::with_capacity(target_points);
    for point in 0..target_points {
        let start = point * mins.len() / target_points;
        let end = ((point + 1) * mins.len() / target_points).max(start + 1).min(mins.len());
        let mut min_value = 1.0_f32;
        let mut max_value = -1.0_f32;
        for index in start..end {
            min_value = min_value.min(mins[index]);
            max_value = max_value.max(maxs[index]);
        }
        compact_mins.push(if min_value == 1.0 { 0.0 } else { min_value });
        compact_maxs.push(if max_value == -1.0 { 0.0 } else { max_value });
    }
    (compact_mins, compact_maxs)
}

fn fill_missing_waveform_buckets(mins: &mut [f32], maxs: &mut [f32]) {
    let mut previous_peak = None;
    for index in 0..mins.len() {
        let missing = mins[index] == 1.0 && maxs[index] == -1.0;
        if missing {
            if let Some((min_value, max_value)) = previous_peak {
                mins[index] = min_value;
                maxs[index] = max_value;
            }
        } else {
            previous_peak = Some((mins[index], maxs[index]));
        }
    }

    let mut next_peak = None;
    for index in (0..mins.len()).rev() {
        let missing = mins[index] == 1.0 && maxs[index] == -1.0;
        if missing {
            if let Some((min_value, max_value)) = next_peak {
                mins[index] = min_value;
                maxs[index] = max_value;
            } else {
                mins[index] = 0.0;
                maxs[index] = 0.0;
            }
        } else {
            next_peak = Some((mins[index], maxs[index]));
        }
    }
}

fn progressive_waveform_preview(
    mins: &[f32],
    maxs: &[f32],
    total_duration: f64,
    sample_rate: u32,
    channels: usize,
    decoded_frames: u64,
    total_frames: u64,
) -> Option<NativeAudioWaveform> {
    if mins.is_empty() || total_duration <= 0.0 || total_frames == 0 {
        return None;
    }

    let target_points = 20_000_usize;
    let decoded_ratio = (decoded_frames.min(total_frames) as f64 / total_frames as f64).clamp(0.0, 1.0);
    let filled_points = ((target_points as f64 * decoded_ratio).ceil() as usize).clamp(1, target_points);
    let (partial_mins, partial_maxs) = compact_waveform_peaks(mins, maxs, filled_points);
    let mut preview_mins = vec![0.0_f32; target_points];
    let mut preview_maxs = vec![0.0_f32; target_points];

    for (index, value) in partial_mins.into_iter().enumerate().take(filled_points) {
        preview_mins[index] = value;
    }
    for (index, value) in partial_maxs.into_iter().enumerate().take(filled_points) {
        preview_maxs[index] = value;
    }

    Some(NativeAudioWaveform {
        duration: total_duration,
        sample_rate,
        channels,
        point_count: target_points,
        mins: preview_mins,
        maxs: preview_maxs,
        cache_hit: false,
    })
}

fn ffmpeg_command_candidates(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut push_candidate_set = |base_dir: &std::path::Path| {
        candidates.push(base_dir.join("ffmpeg.exe"));
        candidates.push(base_dir.join("bin").join("ffmpeg.exe"));
        candidates.push(base_dir.join("tools").join("ffmpeg.exe"));
    };

    if let Some(app_handle) = app {
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            push_candidate_set(&resource_dir);
        }
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(app_dir) = current_exe.parent() {
            push_candidate_set(app_dir);
            for ancestor in app_dir.ancestors().take(6) {
                push_candidate_set(ancestor);
            }
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        push_candidate_set(&current_dir);
        for ancestor in current_dir.ancestors().take(6) {
            push_candidate_set(ancestor);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    push_candidate_set(&manifest_dir);
    if let Some(project_dir) = manifest_dir.parent() {
        push_candidate_set(project_dir);
    }
    candidates.push(PathBuf::from("ffmpeg"));
    candidates.dedup();
    candidates
}

fn resolve_ffmpeg_executable(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    ffmpeg_command_candidates(app)
        .into_iter()
        .find(|path| {
            path.file_name().and_then(|name| name.to_str()) == Some("ffmpeg") || path.exists()
        })
        .ok_or_else(|| "未找到 ffmpeg.exe，无法导出编辑后的长音频".to_string())
}

fn export_editor_segments_mp3_blocking(
    app: Option<AppHandle>,
    segments: Vec<EditorExportSegment>,
    filename: String,
    bitrate_kbps: Option<u32>,
    save_dir: Option<String>,
) -> Result<EditorExportResult, String> {
    let valid_segments: Vec<EditorExportSegment> = segments
        .into_iter()
        .filter(|segment| {
            !segment.source_path.trim().is_empty()
                && segment.sample_rate > 0
                && segment.source_end_frame > segment.source_start_frame
        })
        .collect();
    if valid_segments.is_empty() {
        return Err("没有可导出的编辑片段".to_string());
    }

    let output_filename = {
        let cleaned = clean_filename(&filename);
        let path = PathBuf::from(&cleaned);
        match path.extension().and_then(|value| value.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case("mp3") => cleaned,
            _ => format!(
                "{}.mp3",
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or("recording")
            ),
        }
    };
    let output_path = unique_recording_path(recordings_dir(save_dir.clone())?, &output_filename);
    let ffmpeg_path = resolve_ffmpeg_executable(app.as_ref())?;

    let mut input_paths: Vec<PathBuf> = Vec::new();
    let mut filter_lines = Vec::new();
    let mut labels = Vec::new();

    for (index, segment) in valid_segments.iter().enumerate() {
        let source_path = PathBuf::from(segment.source_path.trim());
        if !source_path.exists() {
            return Err(format!("编辑片段源文件不存在: {}", source_path.display()));
        }
        let input_index = match input_paths.iter().position(|path| path == &source_path) {
            Some(existing_index) => existing_index,
            None => {
                input_paths.push(source_path);
                input_paths.len() - 1
            }
        };
        let label = format!("s{index}");
        filter_lines.push(format!(
            "[{input_index}:a]atrim=start_sample={}:end_sample={},asetpts=PTS-STARTPTS[{label}]",
            segment.source_start_frame,
            segment.source_end_frame
        ));
        labels.push(label);
    }

    if labels.len() == 1 {
        filter_lines.push(format!("[{}]anull[out]", labels[0]));
    } else {
        let concat_inputs = labels
            .iter()
            .map(|label| format!("[{label}]"))
            .collect::<String>();
        filter_lines.push(format!("{concat_inputs}concat=n={}:v=0:a=1[out]", labels.len()));
    }

    let script_dir = preferred_cache_dir(save_dir, "editor-export-temp")?;
    let script_path = script_dir.join(format!("export-{}.ffscript", chrono_like_timestamp()));
    write_file_safely(&script_path, filter_lines.join(";\n").as_bytes())?;

    let bitrate = bitrate_kbps.unwrap_or(128).clamp(8, 320);
    let mut command = Command::new(&ffmpeg_path);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-y");
    for input_path in &input_paths {
        command.arg("-i").arg(input_path);
    }
    command
        .arg("-filter_complex_script")
        .arg(&script_path)
        .arg("-map")
        .arg("[out]")
        .arg("-vn")
        .arg("-c:a")
        .arg("libmp3lame")
        .arg("-b:a")
        .arg(format!("{bitrate}k"))
        .arg(&output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|err| format!("启动 FFmpeg 导出失败: {err}"));
    let _ = fs::remove_file(&script_path);
    let output = output?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("未知错误");
        let _ = fs::remove_file(&output_path);
        return Err(format!("FFmpeg 导出编辑音频失败: {message}"));
    }

    let saved_filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&output_filename)
        .to_string();
    Ok(EditorExportResult {
        path: output_path.to_string_lossy().to_string(),
        filename: saved_filename,
    })
}

fn build_ffmpeg_audio_waveform(
    app: Option<AppHandle>,
    path: String,
    max_points: usize,
    mut on_progress: Option<Box<dyn FnMut(u8, String, Option<NativeAudioWaveform>) + Send>>,
) -> Result<NativeAudioWaveform, String> {
    let metadata_hint = read_native_audio_metadata_blocking(path.clone()).ok();
    let source_duration = metadata_hint
        .as_ref()
        .map(|metadata| metadata.duration_seconds)
        .filter(|duration| *duration > 0.0);
    let original_sample_rate = metadata_hint
        .as_ref()
        .map(|metadata| metadata.sample_rate)
        .filter(|sample_rate| *sample_rate > 0)
        .unwrap_or(44_100);
    let original_channels = metadata_hint
        .as_ref()
        .map(|metadata| metadata.channels)
        .filter(|channels| *channels > 0)
        .unwrap_or(1);
    let target_points = max_points.clamp(1_000, 80_000);
    let fast_sample_rate = 12_000_u32;
    let estimated_output_frames = source_duration
        .map(|duration| (duration * fast_sample_rate as f64).ceil() as u64)
        .filter(|frames| *frames > 0);
    let samples_per_peak = estimated_output_frames
        .map(|frames| ((frames as f64 / target_points as f64).ceil() as u64).max(1))
        .unwrap_or_else(|| (fast_sample_rate as u64 / 25).max(1));

    if let Some(progress) = on_progress.as_mut() {
        progress(2, "正在启动 FFmpeg 后台波形任务".to_string(), None);
    }

    let mut spawn_errors = Vec::new();
    for ffmpeg_path in ffmpeg_command_candidates(app.as_ref()) {
        if ffmpeg_path.file_name().and_then(|name| name.to_str()) != Some("ffmpeg")
            && !ffmpeg_path.exists()
        {
            continue;
        }

        if let Some(progress) = on_progress.as_mut() {
            progress(
                3,
                format!("正在使用 FFmpeg 后台生成波形: {}", ffmpeg_path.display()),
                None,
            );
        }

        let mut ffmpeg_command = Command::new(&ffmpeg_path);
        #[cfg(target_os = "windows")]
        ffmpeg_command.creation_flags(CREATE_NO_WINDOW);

        let mut child = match ffmpeg_command
            .arg("-hide_banner")
            .arg("-nostdin")
            .arg("-v")
            .arg("error")
            .arg("-i")
            .arg(&path)
            .arg("-map")
            .arg("0:a:0")
            .arg("-vn")
            .arg("-ac")
            .arg("1")
            .arg("-ar")
            .arg(fast_sample_rate.to_string())
            .arg("-f")
            .arg("f32le")
            .arg("-")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                spawn_errors.push(format!("{}: {err}", ffmpeg_path.display()));
                continue;
            }
        };

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法读取 FFmpeg 音频输出".to_string())?;
        let mut mins = Vec::new();
        let mut maxs = Vec::new();
        let mut bucket_min = 1.0_f32;
        let mut bucket_max = -1.0_f32;
        let mut bucket_frames = 0_u64;
        let mut decoded_frames = 0_u64;
        let mut last_progress = 2_u8;
        let mut last_progress_emit = Instant::now() - Duration::from_millis(900);
        let mut leftover = Vec::<u8>::new();
        let mut read_buffer = [0_u8; 64 * 1024];
        let mut read_failed = None;

        loop {
            let read_len = match stdout.read(&mut read_buffer) {
                Ok(0) => break,
                Ok(length) => length,
                Err(err) => {
                    read_failed = Some(err.to_string());
                    break;
                }
            };

            let mut bytes = Vec::with_capacity(leftover.len() + read_len);
            bytes.extend_from_slice(&leftover);
            bytes.extend_from_slice(&read_buffer[..read_len]);
            let usable_len = bytes.len() - (bytes.len() % 4);

            for chunk in bytes[..usable_len].chunks_exact(4) {
                let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                bucket_min = bucket_min.min(sample);
                bucket_max = bucket_max.max(sample);
                bucket_frames = bucket_frames.saturating_add(1);
                decoded_frames = decoded_frames.saturating_add(1);

                if bucket_frames >= samples_per_peak {
                    mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
                    maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
                    bucket_min = 1.0;
                    bucket_max = -1.0;
                    bucket_frames = 0;
                }
            }
            leftover.clear();
            leftover.extend_from_slice(&bytes[usable_len..]);

            if last_progress_emit.elapsed() >= Duration::from_millis(800) {
                let percent = estimated_output_frames
                    .map(|frames| {
                        let ratio = decoded_frames as f64 / frames.max(1) as f64;
                        (2.0 + ratio.clamp(0.0, 1.0) * 92.0).round() as u8
                    })
                    .unwrap_or_else(|| last_progress.saturating_add(2))
                    .min(94);
                if percent > last_progress {
                    last_progress = percent;
                    last_progress_emit = Instant::now();
                    if let Some(progress) = on_progress.as_mut() {
                        progress(percent, "正在使用 FFmpeg 后台生成波形".to_string(), None);
                    }
                }
            }
        }

        if let Some(error) = read_failed {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("读取 FFmpeg 波形输出失败: {error}"));
        }

        let exit_status = child
            .wait()
            .map_err(|err| format!("等待 FFmpeg 波形任务结束失败: {err}"))?;
        if !exit_status.success() {
            spawn_errors.push(format!("{}: 退出码 {:?}", ffmpeg_path.display(), exit_status.code()));
            continue;
        }

        if bucket_frames > 0 || mins.is_empty() {
            mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
            maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
        }
        let duration = source_duration.unwrap_or(decoded_frames as f64 / fast_sample_rate as f64);
        if duration <= 0.0 || decoded_frames == 0 {
            return Err("FFmpeg 未读取到有效音频波形".to_string());
        }
        if let Some(progress) = on_progress.as_mut() {
            progress(96, "正在整理 FFmpeg 波形峰值".to_string(), None);
        }
        let (mins, maxs) = compact_waveform_peaks(&mins, &maxs, target_points);
        return Ok(NativeAudioWaveform {
            duration,
            sample_rate: original_sample_rate,
            channels: original_channels,
            point_count: mins.len(),
            mins,
            maxs,
            cache_hit: false,
        });
    }

    Err(format!(
        "未找到可用 FFmpeg，已回退其他解码器{}",
        if spawn_errors.is_empty() {
            String::new()
        } else {
            format!(": {}", spawn_errors.join("; "))
        }
    ))
}

#[cfg(target_os = "windows")]
struct MediaFoundationSession;

#[cfg(target_os = "windows")]
impl MediaFoundationSession {
    fn start() -> Result<Self, String> {
        unsafe {
            MFStartup(MF_VERSION, MFSTARTUP_FULL)
                .map_err(|err| format!("启动 Windows Media Foundation 失败: {err}"))?;
        }
        Ok(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for MediaFoundationSession {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
        }
    }
}

#[cfg(target_os = "windows")]
fn build_media_foundation_audio_waveform(
    path: String,
    max_points: usize,
    mut on_progress: Option<Box<dyn FnMut(u8, String, Option<NativeAudioWaveform>) + Send>>,
) -> Result<NativeAudioWaveform, String> {
    if let Some(progress) = on_progress.as_mut() {
        progress(3, "正在启动 Windows 原生解码器".to_string(), None);
    }

    let _session = MediaFoundationSession::start()?;
    let source_path = PathBuf::from(&path);
    let path_text = source_path
        .canonicalize()
        .unwrap_or(source_path)
        .to_string_lossy()
        .to_string();
    let target_points = max_points.clamp(1_000, 80_000);
    let metadata_hint = read_native_audio_metadata_blocking(path.clone()).ok();

    unsafe {
        let reader = MFCreateSourceReaderFromURL(
            &HSTRING::from(path_text),
            None::<&windows::Win32::Media::MediaFoundation::IMFAttributes>,
        )
        .map_err(|err| format!("创建 Windows 原生音频读取器失败: {err}"))?;
        let all_streams = MF_SOURCE_READER_ALL_STREAMS.0 as u32;
        let audio_stream = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;
        let _ = reader.SetStreamSelection(all_streams, false);
        reader
            .SetStreamSelection(audio_stream, true)
            .map_err(|err| format!("选择音频流失败: {err}"))?;

        let output_type = MFCreateMediaType()
            .map_err(|err| format!("创建 Windows 原生音频输出格式失败: {err}"))?;
        output_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
            .map_err(|err| format!("设置音频输出主类型失败: {err}"))?;
        output_type
            .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_Float)
            .map_err(|err| format!("设置音频输出为 float PCM 失败: {err}"))?;
        reader
            .SetCurrentMediaType(audio_stream, None, &output_type)
            .map_err(|err| format!("启用 Windows 原生音频解码失败: {err}"))?;

        let actual_type = reader
            .GetCurrentMediaType(audio_stream)
            .map_err(|err| format!("读取 Windows 原生音频格式失败: {err}"))?;
        let subtype = actual_type
            .GetGUID(&MF_MT_SUBTYPE)
            .map_err(|err| format!("读取音频输出编码失败: {err}"))?;
        if subtype != MFAudioFormat_Float {
            return Err("Windows 原生解码器未返回 float PCM，已回退旧解码器".to_string());
        }
        let sample_rate = actual_type
            .GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND)
            .unwrap_or(44_100)
            .max(1);
        let channels = actual_type
            .GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)
            .unwrap_or(1)
            .max(1) as usize;
        let estimated_total_frames = metadata_hint
            .as_ref()
            .and_then(|metadata| {
                if metadata.frame_count > 0 {
                    Some(metadata.frame_count)
                } else if metadata.duration_seconds > 0.0 {
                    Some((metadata.duration_seconds * sample_rate as f64).round() as u64)
                } else {
                    None
                }
            })
            .filter(|frames| *frames > 0);
        let samples_per_peak = estimated_total_frames
            .map(|frames| ((frames as f64 / target_points as f64).ceil() as u64).max(1))
            .unwrap_or_else(|| (sample_rate as u64 / 25).max(1));
        let sample_stride = (samples_per_peak / 512).max(1);

        let mut mins = Vec::new();
        let mut maxs = Vec::new();
        let mut bucket_min = 1.0_f32;
        let mut bucket_max = -1.0_f32;
        let mut bucket_frames = 0_u64;
        let mut decoded_frames = 0_u64;
        let mut last_progress = 5_u8;
        let mut last_progress_emit = Instant::now() - Duration::from_millis(600);
        let mut estimated_progress = 5_u8;

        if let Some(progress) = on_progress.as_mut() {
            progress(5, "正在使用 Windows 原生解码器解码".to_string(), None);
        }

        loop {
            let mut flags = 0_u32;
            let mut timestamp = 0_i64;
            let mut sample = None;
            reader
                .ReadSample(
                    audio_stream,
                    0,
                    None,
                    Some(&mut flags),
                    Some(&mut timestamp),
                    Some(&mut sample),
                )
                .map_err(|err| format!("Windows 原生解码读取失败: {err}"))?;

            if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                break;
            }
            if flags & (MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0 as u32) != 0 {
                continue;
            }

            let Some(sample) = sample else {
                continue;
            };
            let buffer = sample
                .ConvertToContiguousBuffer()
                .map_err(|err| format!("读取 Windows 原生 PCM 缓冲失败: {err}"))?;
            let mut data_ptr = std::ptr::null_mut::<u8>();
            let mut current_len = 0_u32;
            buffer
                .Lock(&mut data_ptr, None, Some(&mut current_len))
                .map_err(|err| format!("锁定 Windows 原生 PCM 缓冲失败: {err}"))?;

            if !data_ptr.is_null() && current_len >= 4 {
                let bytes = std::slice::from_raw_parts(data_ptr, current_len as usize);
                let sample_count = bytes.len() / 4;
                let frame_count = sample_count / channels;
                for frame in 0..frame_count {
                    let should_measure = bucket_frames == 0
                        || bucket_frames + 1 >= samples_per_peak
                        || bucket_frames % sample_stride == 0;
                    if should_measure {
                        let mut mixed = 0.0_f32;
                        for channel in 0..channels {
                            let offset = (frame * channels + channel) * 4;
                            mixed += f32::from_le_bytes([
                                bytes[offset],
                                bytes[offset + 1],
                                bytes[offset + 2],
                                bytes[offset + 3],
                            ]);
                        }
                        mixed /= channels as f32;
                        bucket_min = bucket_min.min(mixed);
                        bucket_max = bucket_max.max(mixed);
                    }
                    bucket_frames = bucket_frames.saturating_add(1);
                    if bucket_frames >= samples_per_peak {
                        mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
                        maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
                        bucket_min = 1.0;
                        bucket_max = -1.0;
                        bucket_frames = 0;
                    }
                }
                decoded_frames = decoded_frames.saturating_add(frame_count as u64);
            }
            let _ = buffer.Unlock();

            if last_progress_emit.elapsed() >= Duration::from_millis(1500) {
                estimated_progress = estimated_total_frames
                    .map(|frames| {
                        let ratio = decoded_frames as f64 / frames.max(1) as f64;
                        (5.0 + ratio.clamp(0.0, 1.0) * 84.0).round() as u8
                    })
                    .unwrap_or_else(|| estimated_progress.saturating_add(2))
                    .min(89);
                if estimated_progress > last_progress {
                    last_progress = estimated_progress;
                    last_progress_emit = Instant::now();
                    if let Some(progress) = on_progress.as_mut() {
                        progress(
                            estimated_progress,
                            format!("正在使用 Windows 原生解码器快速生成 {target_points} 点波形"),
                            None,
                        );
                    }
                }
            }
        }

        if bucket_frames > 0 || mins.is_empty() {
            mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
            maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
        }

        let duration = decoded_frames as f64 / sample_rate as f64;
        if duration <= 0.0 {
            return Err("Windows 原生解码未读取到有效音频".to_string());
        }
        if let Some(progress) = on_progress.as_mut() {
            progress(92, "正在整理 Windows 原生波形峰值".to_string(), None);
        }
        let (mins, maxs) = compact_waveform_peaks(&mins, &maxs, target_points);
        if let Some(progress) = on_progress.as_mut() {
            progress(96, "正在写入波形缓存".to_string(), None);
        }

        Ok(NativeAudioWaveform {
            duration,
            sample_rate,
            channels,
            point_count: mins.len(),
            mins,
            maxs,
            cache_hit: false,
        })
    }
}

fn build_native_audio_waveform(
    path: String,
    max_points: usize,
    mut on_progress: Option<Box<dyn FnMut(u8, String, Option<NativeAudioWaveform>) + Send>>,
) -> Result<NativeAudioWaveform, String> {
    if let Some(progress) = on_progress.as_mut() {
        progress(3, "正在打开音频文件".to_string(), None);
    }
    let source_path = PathBuf::from(&path);
    let file = fs::File::open(&source_path).map_err(|err| format!("打开音频文件失败: {err}"))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = audio_hint_for_path(&source_path);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|err| format!("识别音频格式失败: {err}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "没有找到可解码的音频轨道".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44_100);
    let channels = codec_params.channels.map(|value| value.count()).unwrap_or(1).max(1);
    let total_frames = codec_params.n_frames.unwrap_or(0);
    let time_base = codec_params.time_base;
    let total_duration = if total_frames > 0 {
        total_frames as f64 / sample_rate as f64
    } else {
        0.0
    };
    let target_points = max_points.clamp(1_000, 80_000);
    let samples_per_peak = codec_params
        .n_frames
        .map(|frames| ((frames as f64 / target_points as f64).ceil() as u64).max(1))
        .unwrap_or_else(|| (sample_rate as u64 / 25).max(1));

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|err| format!("创建音频解码器失败: {err}"))?;

    // 有些长 MP3 的包时间戳并不是简单从 0 顺序累加。
    // 波形按 packet timestamp 放入峰值桶，才能和浏览器播放器听到的位置对齐。
    let use_timestamp_buckets = total_frames > 0 && time_base.is_some();
    let bucket_count = if use_timestamp_buckets {
        ((total_frames + samples_per_peak - 1) / samples_per_peak).max(1) as usize
    } else {
        0
    };
    let mut mins = if use_timestamp_buckets {
        vec![1.0_f32; bucket_count]
    } else {
        Vec::new()
    };
    let mut maxs = if use_timestamp_buckets {
        vec![-1.0_f32; bucket_count]
    } else {
        Vec::new()
    };
    let mut bucket_min = 1.0_f32;
    let mut bucket_max = -1.0_f32;
    let mut decoded_max_frame = 0_u64;
    let mut sequential_frames = 0_u64;
    let mut bucket_frames = 0_u64;
    let mut last_progress = 0_u8;
    let mut estimated_progress = 5_u8;
    let mut last_progress_emit = Instant::now() - Duration::from_millis(600);

    if let Some(progress) = on_progress.as_mut() {
        progress(5, "正在解码音频".to_string(), None);
    }

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => return Err("音频流需要重置，当前暂不支持该格式".to_string()),
            Err(err) => return Err(format!("读取音频包失败: {err}")),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(err) => return Err(format!("音频解码失败: {err}")),
        };

        let decoded_spec = *decoded.spec();
        let decoded_channels = decoded_spec.channels.count().max(1);
        let frame_count = decoded.frames();
        let mut sample_buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, decoded_spec);
        sample_buffer.copy_interleaved_ref(decoded);
        let samples = sample_buffer.samples();
        let timestamp_frame = time_base
            .map(|base| {
                let time = base.calc_time(packet.ts());
                ((time.seconds as f64 + time.frac) * sample_rate as f64).round() as u64
            });
        let timestamp_lag_tolerance = sample_rate as u64 * 2;
        let timestamp_future_tolerance = sample_rate as u64 * 30;
        let packet_start_frame = timestamp_frame
            .filter(|frame| {
                let not_too_far_after_duration =
                    total_frames == 0 || *frame <= total_frames.saturating_add(timestamp_future_tolerance);
                let not_stalled_behind_sequence =
                    frame.saturating_add(timestamp_lag_tolerance) >= sequential_frames;
                not_too_far_after_duration && not_stalled_behind_sequence
            })
            .unwrap_or(sequential_frames);

        for frame in 0..frame_count {
            let base = frame * decoded_channels;
            let mut mixed = 0.0_f32;
            for channel in 0..decoded_channels {
                mixed += samples.get(base + channel).copied().unwrap_or(0.0);
            }
            mixed /= decoded_channels as f32;
            if use_timestamp_buckets {
                let absolute_frame = packet_start_frame.saturating_add(frame as u64);
                let bucket_index = (absolute_frame / samples_per_peak) as usize;
                let safe_bucket_index = bucket_index.min(mins.len().saturating_sub(1));
                if let (Some(min_value), Some(max_value)) =
                    (mins.get_mut(safe_bucket_index), maxs.get_mut(safe_bucket_index))
                {
                    *min_value = min_value.min(mixed);
                    *max_value = max_value.max(mixed);
                }
                decoded_max_frame = decoded_max_frame.max(absolute_frame.saturating_add(1));
            } else {
                bucket_min = bucket_min.min(mixed);
                bucket_max = bucket_max.max(mixed);
                bucket_frames = bucket_frames.saturating_add(1);

                if bucket_frames >= samples_per_peak {
                    mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
                    maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
                    bucket_min = 1.0;
                    bucket_max = -1.0;
                    bucket_frames = 0;
                }
            }
        }
        sequential_frames = sequential_frames.saturating_add(frame_count as u64);
        decoded_max_frame = decoded_max_frame.max(sequential_frames);

        if total_frames > 0 {
            let progress_frames = decoded_max_frame.max(sequential_frames).min(total_frames);
            let percent = (5.0 + (progress_frames as f64 / total_frames as f64) * 85.0)
                .round()
                .clamp(5.0, 90.0) as u8;
            if percent > last_progress && last_progress_emit.elapsed() >= Duration::from_millis(1500) {
                last_progress = percent;
                last_progress_emit = Instant::now();
                if let Some(progress) = on_progress.as_mut() {
                    let preview = progressive_waveform_preview(
                        &mins,
                        &maxs,
                        total_duration,
                        sample_rate,
                        channels,
                        progress_frames,
                        total_frames,
                    );
                    progress(percent, "正在解码音频".to_string(), preview);
                }
            }
        } else if last_progress_emit.elapsed() >= Duration::from_millis(1500) {
            estimated_progress = estimated_progress.saturating_add(2).min(85);
            if estimated_progress > last_progress {
                last_progress = estimated_progress;
                last_progress_emit = Instant::now();
                if let Some(progress) = on_progress.as_mut() {
                    progress(estimated_progress, "正在解码音频（时长估算中）".to_string(), None);
                }
            }
        }
    }

    if let Some(progress) = on_progress.as_mut() {
        progress(92, "正在整理波形峰值".to_string(), None);
    }
    if !use_timestamp_buckets && (bucket_frames > 0 || mins.is_empty()) {
        mins.push(if bucket_min == 1.0 { 0.0 } else { bucket_min });
        maxs.push(if bucket_max == -1.0 { 0.0 } else { bucket_max });
    }
    if use_timestamp_buckets {
        fill_missing_waveform_buckets(&mut mins, &mut maxs);
    }

    let duration = if total_frames > 0 {
        total_frames as f64 / sample_rate as f64
    } else if decoded_max_frame > 0 {
        decoded_max_frame as f64 / sample_rate as f64
    } else if sequential_frames > 0 {
        sequential_frames as f64 / sample_rate as f64
    } else {
        0.0
    };
    if duration <= 0.0 {
        return Err("音频时长解析失败".to_string());
    }

    let (mins, maxs) = compact_waveform_peaks(&mins, &maxs, target_points);
    if let Some(progress) = on_progress.as_mut() {
        progress(96, "正在写入波形缓存".to_string(), None);
    }
    Ok(NativeAudioWaveform {
        duration,
        sample_rate,
        channels,
        point_count: mins.len(),
        mins,
        maxs,
        cache_hit: false,
    })
}

fn google_token_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .or_else(dirs::data_local_dir)
        .or_else(dirs::home_dir)
        .map(|base| base.join("AudioRecorder"))
        .ok_or_else(|| "无法定位配置目录".to_string())?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建配置目录: {err}"))?;
    Ok(dir.join("google_drive_token.json"))
}

fn parse_google_oauth_client_config(text: &str) -> Result<GoogleOAuthClientConfig, String> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|err| format!("解析 OAuth JSON 失败: {err}"))?;
    let (client_type, client) = if let Some(installed) = value.get("installed") {
        ("installed", installed)
    } else if let Some(web) = value.get("web") {
        ("web", web)
    } else {
        ("root", &value)
    };
    let client_id = client
        .get("client_id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let client_secret = client
        .get("client_secret")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if client_id.is_empty() {
        return Err("OAuth JSON 中没有 client_id".to_string());
    }
    Ok(GoogleOAuthClientConfig {
        client_id,
        client_secret,
        client_type: client_type.to_string(),
    })
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn sanitize_registry_key_part(value: &str) -> String {
    let key: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if key.trim_matches('_').is_empty() {
        "preset".to_string()
    } else {
        key
    }
}

fn quote_command_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn parse_launch_action_from_args(args: &[String]) -> Option<LaunchAction> {
    let mut action_type = String::new();
    let mut preset_id = None;
    let mut file_paths = Vec::new();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--audio-recorder-action" => {
                if let Some(value) = args.get(index + 1) {
                    action_type = value.to_string();
                    index += 1;
                }
            }
            "--preset-id" => {
                if let Some(value) = args.get(index + 1) {
                    preset_id = Some(value.to_string());
                    index += 1;
                }
            }
            "--file" => {
                if let Some(value) = args.get(index + 1) {
                    if !value.trim().is_empty() {
                        file_paths.push(value.to_string());
                    }
                    index += 1;
                }
            }
            "--files" => {
                index += 1;
                while index < args.len() {
                    if let Some(value) = args.get(index) {
                        if !value.trim().is_empty() {
                            file_paths.push(value.to_string());
                        }
                    }
                    index += 1;
                }
                break;
            }
            _ => {}
        }
        index += 1;
    }

    let mut seen_paths = HashSet::new();
    file_paths.retain(|path| seen_paths.insert(path.clone()));

    if action_type.is_empty() || file_paths.is_empty() {
        return None;
    }

    let normalized_action = match action_type.as_str() {
        "edit" | "upload" => action_type,
        _ => return None,
    };
    Some(LaunchAction {
        action_type: normalized_action,
        preset_id,
        file_path: file_paths.first().cloned().unwrap_or_default(),
        file_paths,
    })
}

fn dedup_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .filter(|path| seen.insert(path.to_ascii_lowercase()))
        .collect()
}

#[cfg(target_os = "windows")]
fn shell_upload_queue_key(preset_id: &str) -> Result<String, String> {
    let exe_path = env::current_exe()
        .map_err(|err| format!("无法读取当前程序路径: {err}"))?
        .canonicalize()
        .unwrap_or_else(|_| env::current_exe().unwrap_or_default())
        .to_string_lossy()
        .to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(exe_path.as_bytes());
    hasher.update(b"|upload|");
    hasher.update(preset_id.as_bytes());
    Ok(hasher
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

#[cfg(target_os = "windows")]
fn shell_upload_queue_file(preset_id: &str) -> Result<PathBuf, String> {
    let key = shell_upload_queue_key(preset_id)?;
    let dir = env::temp_dir().join("AudioRecorder").join("shell-upload-queue");
    fs::create_dir_all(&dir).map_err(|err| format!("创建右键上传队列目录失败: {err}"))?;
    Ok(dir.join(format!("{key}.jsonl")))
}

#[cfg(target_os = "windows")]
fn with_shell_upload_queue_lock<T>(
    preset_id: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let key = shell_upload_queue_key(preset_id)?;
    let lock_name = format!("Local\\AudioRecorderShellUploadQueueFile-{key}");
    unsafe {
        let mutex = CreateMutexW(None, false, &HSTRING::from(lock_name))
            .map_err(|err| format!("创建右键上传队列锁失败: {err}"))?;
        let wait_result = WaitForSingleObject(mutex, INFINITE);
        if wait_result != WAIT_OBJECT_0 {
            let _ = CloseHandle(mutex);
            return Err("等待右键上传队列锁失败".to_string());
        }
        let result = operation();
        let _ = ReleaseMutex(mutex);
        let _ = CloseHandle(mutex);
        result
    }
}

#[cfg(target_os = "windows")]
fn append_shell_upload_queue(action: &LaunchAction, reset_first: bool) -> Result<(), String> {
    let preset_id = action
        .preset_id
        .as_deref()
        .unwrap_or("default")
        .trim()
        .to_string();
    let file_paths = dedup_paths(action.file_paths.clone());
    if file_paths.is_empty() {
        return Ok(());
    }
    with_shell_upload_queue_lock(&preset_id, || {
        let queue_file = shell_upload_queue_file(&preset_id)?;
        if reset_first && queue_file.exists() {
            fs::remove_file(&queue_file).map_err(|err| format!("清理旧右键上传队列失败: {err}"))?;
        }
        let item = ShellUploadQueueItem {
            preset_id: preset_id.clone(),
            file_paths,
            created_at: now_seconds(),
        };
        let line = serde_json::to_string(&item).map_err(|err| format!("生成右键上传队列失败: {err}"))?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(queue_file)
            .map_err(|err| format!("写入右键上传队列失败: {err}"))?;
        writeln!(file, "{line}").map_err(|err| format!("写入右键上传队列失败: {err}"))?;
        Ok(())
    })
}

#[cfg(target_os = "windows")]
fn read_shell_upload_queue_paths(preset_id: &str) -> Result<Vec<String>, String> {
    let preset_id = preset_id.trim();
    if preset_id.is_empty() {
        return Ok(Vec::new());
    }
    with_shell_upload_queue_lock(preset_id, || {
        let queue_file = shell_upload_queue_file(preset_id)?;
        if !queue_file.exists() {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(queue_file).map_err(|err| format!("读取右键上传队列失败: {err}"))?;
        let mut paths = Vec::new();
        for line in text.lines() {
            let Ok(item) = serde_json::from_str::<ShellUploadQueueItem>(line) else {
                continue;
            };
            if item.preset_id == preset_id {
                paths.extend(item.file_paths);
            }
        }
        Ok(dedup_paths(paths))
    })
}

#[cfg(target_os = "windows")]
fn clear_shell_upload_queue_file(preset_id: &str) -> Result<(), String> {
    let preset_id = preset_id.trim();
    if preset_id.is_empty() {
        return Ok(());
    }
    with_shell_upload_queue_lock(preset_id, || {
        let queue_file = shell_upload_queue_file(preset_id)?;
        if queue_file.exists() {
            fs::remove_file(queue_file).map_err(|err| format!("清空右键上传队列失败: {err}"))?;
        }
        Ok(())
    })
}

#[cfg(target_os = "windows")]
enum ShellUploadStartup {
    Owner(LaunchAction, ShellUploadOwnerGuard),
    Follower,
}

#[cfg(target_os = "windows")]
fn prepare_shell_upload_startup(action: LaunchAction) -> Result<ShellUploadStartup, String> {
    if action.action_type != "upload" {
        return Ok(ShellUploadStartup::Owner(
            action,
            ShellUploadOwnerGuard { handle: HANDLE::default() },
        ));
    }

    let preset_id = action.preset_id.as_deref().unwrap_or("default");
    let key = shell_upload_queue_key(preset_id)?;
    let owner_name = format!("Local\\AudioRecorderShellUploadQueueOwner-{key}");
    unsafe {
        let owner = CreateMutexW(None, true, &HSTRING::from(owner_name))
            .map_err(|err| format!("创建右键上传窗口锁失败: {err}"))?;
        let owner_exists = GetLastError() == ERROR_ALREADY_EXISTS;
        append_shell_upload_queue(&action, !owner_exists)?;
        if owner_exists {
            let _ = CloseHandle(owner);
            Ok(ShellUploadStartup::Follower)
        } else {
            Ok(ShellUploadStartup::Owner(
                action,
                ShellUploadOwnerGuard { handle: owner },
            ))
        }
    }
}

#[cfg(target_os = "windows")]
fn normal_single_instance_names() -> Result<(String, String), String> {
    let exe_path = env::current_exe()
        .map_err(|err| format!("无法读取当前程序路径: {err}"))?
        .canonicalize()
        .unwrap_or_else(|_| env::current_exe().unwrap_or_default())
        .to_string_lossy()
        .to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(exe_path.as_bytes());
    let digest = hasher.finalize();
    let key = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok((
        format!("Local\\AudioRecorderNormalInstanceMutex-{key}"),
        format!("Local\\AudioRecorderNormalInstanceEvent-{key}"),
    ))
}

#[cfg(target_os = "windows")]
fn acquire_normal_single_instance() -> Result<NormalSingleInstanceResult, String> {
    let args = env::args().collect::<Vec<_>>();
    if parse_launch_action_from_args(&args).is_some() {
        return Ok(NormalSingleInstanceResult::ShellAction);
    }

    let (mutex_name, event_name) = normal_single_instance_names()?;
    unsafe {
        let event = CreateEventW(None, false, false, &HSTRING::from(event_name.clone()))
            .map_err(|err| format!("创建单实例激活事件失败: {err}"))?;
        let mutex = CreateMutexW(None, true, &HSTRING::from(mutex_name))
            .map_err(|err| format!("创建单实例锁失败: {err}"))?;

        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = SetEvent(event);
            let _ = CloseHandle(mutex);
            let _ = CloseHandle(event);
            return Ok(NormalSingleInstanceResult::SecondarySignaled);
        }

        Ok(NormalSingleInstanceResult::Primary(NormalSingleInstanceGuard {
            mutex,
            event,
            event_name,
        }))
    }
}

#[cfg(target_os = "windows")]
fn app_executable_path() -> Result<String, String> {
    env::current_exe()
        .map_err(|err| format!("无法定位 AudioRecorder.exe: {err}"))
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn set_context_menu_command(
    parent: &RegKey,
    key_name: &str,
    label: &str,
    icon: &str,
    command: &str,
    multi_select_model: &str,
) -> Result<(), String> {
    let (item_key, _) = parent
        .create_subkey(key_name)
        .map_err(|err| format!("创建右键菜单项失败: {err}"))?;
    item_key
        .set_value("MUIVerb", &label)
        .map_err(|err| format!("写入右键菜单名称失败: {err}"))?;
    item_key
        .set_value("Icon", &icon)
        .map_err(|err| format!("写入右键菜单图标失败: {err}"))?;
    item_key
        .set_value("MultiSelectModel", &multi_select_model)
        .map_err(|err| format!("写入右键菜单多选模式失败: {err}"))?;
    let (command_key, _) = item_key
        .create_subkey("command")
        .map_err(|err| format!("创建右键菜单命令失败: {err}"))?;
    command_key
        .set_value("", &command)
        .map_err(|err| format!("写入右键菜单命令失败: {err}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_mp3_context_menu_windows(presets: Vec<Mp3ContextMenuPreset>) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mp3_shell_path = r"Software\Classes\SystemFileAssociations\.mp3\shell";
    let _ = hkcu.delete_subkey_all(format!(r"{mp3_shell_path}\AudioRecorder"));

    let (root_key, _) = hkcu
        .create_subkey(format!(r"{mp3_shell_path}\AudioRecorder"))
        .map_err(|err| format!("创建 MP3 右键菜单失败: {err}"))?;
    let exe_path = app_executable_path()?;
    let exe_arg = quote_command_arg(&exe_path);

    root_key
        .set_value("MUIVerb", &"AudioRecorder")
        .map_err(|err| format!("写入 MP3 右键菜单标题失败: {err}"))?;
    root_key
        .set_value("Icon", &exe_path)
        .map_err(|err| format!("写入 MP3 右键菜单图标失败: {err}"))?;
    root_key
        .set_value("SubCommands", &"")
        .map_err(|err| format!("写入 MP3 右键层叠菜单失败: {err}"))?;

    let (shell_key, _) = root_key
        .create_subkey("shell")
        .map_err(|err| format!("创建 MP3 右键子菜单失败: {err}"))?;
    set_context_menu_command(
        &shell_key,
        "edit_audio",
        "编辑音频",
        &exe_path,
        &format!("{exe_arg} --audio-recorder-action edit --file \"%1\""),
        "Single",
    )?;

    for (index, preset) in presets.into_iter().enumerate() {
        let title = clean_filename(&preset.title).trim_end_matches(".mp3").to_string();
        if title.trim().is_empty() {
            continue;
        }
        let key_name = format!("{:02}_upload_{}", index + 1, sanitize_registry_key_part(&preset.id));
        set_context_menu_command(
            &shell_key,
            &key_name,
            &format!("{title} 上传音频"),
            &exe_path,
            &format!(
                "{exe_arg} --audio-recorder-action upload --preset-id {} --file \"%1\" --files %*",
                quote_command_arg(&preset.id)
            ),
            "Document",
        )?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn unregister_mp3_context_menu_windows() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.delete_subkey_all(r"Software\Classes\SystemFileAssociations\.mp3\shell\AudioRecorder") {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("移除 MP3 右键菜单失败: {err}")),
    }
}

fn read_google_token() -> Option<GoogleDriveToken> {
    let path = google_token_path().ok()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn google_http_error(prefix: &str, response: reqwest::blocking::Response) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if body.trim().is_empty() {
        format!("{prefix}: HTTP {status}")
    } else {
        format!("{prefix}: HTTP {status}: {body}")
    }
}

fn request_google_token(form: &[(&str, &str)], prefix: &str) -> Result<GoogleTokenResponse, String> {
    let response = Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(form)
        .send()
        .map_err(|err| format!("{prefix}: {err}"))?;
    if !response.status().is_success() {
        return Err(google_http_error(prefix, response));
    }
    response
        .json()
        .map_err(|err| format!("解析 Google 令牌失败: {err}"))
}

fn write_google_token(token: &GoogleDriveToken) -> Result<(), String> {
    let path = google_token_path()?;
    let text = serde_json::to_string_pretty(token).map_err(|err| format!("保存 Google 令牌失败: {err}"))?;
    fs::write(path, text).map_err(|err| format!("写入 Google 令牌失败: {err}"))
}

fn delete_google_token_file() -> Result<(), String> {
    let path = google_token_path()?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("删除 Google 令牌失败: {err}"))?;
    }
    Ok(())
}

fn base64_url_no_pad(bytes: &[u8]) -> String {
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_code_verifier() -> String {
    let mut bytes = [0u8; 64];
    OsRng.fill_bytes(&mut bytes);
    base64_url_no_pad(&bytes)
}

fn code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64_url_no_pad(&hasher.finalize())
}

fn google_oauth_callback_page(success: bool) -> String {
    let (tone, title, message, detail) = if success {
        (
            "#21c465",
            "Google Drive 已授权",
            "可以回到 AudioRecorder 继续使用。",
            "授权窗口将在几秒后尝试自动关闭。",
        )
    } else {
        (
            "#ff5b5b",
            "Google Drive 授权失败",
            "请回到 AudioRecorder 查看错误信息。",
            "如果刚才取消了授权，可以在软件里重新连接。",
        )
    };
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      color: #12213a;
      background:
        radial-gradient(circle at 18% 12%, rgba(111, 203, 255, 0.28), transparent 28%),
        radial-gradient(circle at 86% 20%, rgba(56, 214, 127, 0.24), transparent 30%),
        linear-gradient(135deg, #eef8ff 0%, #f8fcff 52%, #eefbf5 100%);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 28px;
    }}
    .card {{
      width: min(560px, 100%);
      padding: 34px 34px 30px;
      border: 1px solid rgba(125, 177, 224, 0.55);
      border-radius: 28px;
      background: rgba(255, 255, 255, 0.78);
      box-shadow: 0 22px 60px rgba(72, 110, 148, 0.18);
      backdrop-filter: blur(18px);
      text-align: center;
    }}
    .mark {{
      width: 78px;
      height: 78px;
      margin: 0 auto 18px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: white;
      background: linear-gradient(145deg, {tone}, #2d88ff);
      box-shadow: 0 14px 30px rgba(45, 136, 255, 0.22);
      font-size: 38px;
      font-weight: 900;
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.2;
      letter-spacing: 0;
    }}
    .message {{
      margin: 0;
      color: #31506f;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.55;
    }}
    .detail {{
      margin: 14px 0 0;
      color: #6b7c91;
      font-size: 13px;
      line-height: 1.6;
    }}
    .app {{
      margin-top: 22px;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 10px 16px;
      border-radius: 999px;
      background: rgba(45, 136, 255, 0.1);
      color: #1f6ee8;
      font-size: 13px;
      font-weight: 900;
    }}
    .dot {{
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: {tone};
      box-shadow: 0 0 0 5px rgba(33, 196, 101, 0.13);
    }}
  </style>
</head>
<body>
  <main class="card">
    <div class="mark" aria-hidden="true">{}</div>
    <h1>{title}</h1>
    <p class="message">{message}</p>
    <p class="detail">{detail}</p>
    <div class="app"><span class="dot"></span><span>AudioRecorder</span></div>
  </main>
  <script>
    setTimeout(() => window.close(), 3200);
  </script>
</body>
</html>"#,
        if success { "✓" } else { "!" }
    )
}

fn read_oauth_code(listener: TcpListener, cancelled: Arc<AtomicBool>) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("设置授权回调监听失败: {err}"))?;
    let start = SystemTime::now();
    let mut stream = loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err("Google 授权窗口已关闭".to_string());
        }
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                let elapsed = SystemTime::now().duration_since(start).unwrap_or_default();
                if elapsed > Duration::from_secs(60) {
                    return Err("等待 Google 授权超时".to_string());
                }
                thread::sleep(Duration::from_millis(120));
            }
            Err(err) => return Err(format!("等待 Google 授权回调失败: {err}")),
        }
    };
    let mut buffer = [0u8; 4096];
    let size = stream
        .read(&mut buffer)
        .map_err(|err| format!("读取授权回调失败: {err}"))?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let first_line = request.lines().next().unwrap_or_default();
    let path = first_line.split_whitespace().nth(1).unwrap_or_default();
    let query = path.split_once('?').map(|(_, value)| value).unwrap_or_default();
    let code = query
        .split('&')
        .find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key == "code").then(|| urlencoding::decode(value).ok().map(|decoded| decoded.to_string()))?
        })
        .ok_or_else(|| "Google 授权回调中没有 code".to_string());
    let body = google_oauth_callback_page(code.is_ok());
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    code
}

fn refresh_google_access_token(mut token: GoogleDriveToken) -> Result<GoogleDriveToken, String> {
    if !token.access_token.is_empty() && token.expires_at > now_seconds() + 60 {
        return Ok(token);
    }
    if token.refresh_token.is_empty() {
        return Err("Google Drive 未保存刷新令牌，请重新连接".to_string());
    }

    let mut form = vec![
        ("client_id", token.client_id.as_str()),
        ("refresh_token", token.refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if !token.client_secret.trim().is_empty() {
        form.push(("client_secret", token.client_secret.as_str()));
    }

    let next = match request_google_token(&form, "刷新 Google 令牌失败") {
        Ok(next) => next,
        Err(first_error) if !token.client_secret.trim().is_empty() => {
            let fallback_form = [
                ("client_id", token.client_id.as_str()),
                ("refresh_token", token.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ];
            token.client_secret.clear();
            request_google_token(&fallback_form, "刷新 Google 令牌失败")
                .map_err(|second_error| format!("{first_error}\n无 Client Secret 重试仍失败: {second_error}"))?
        }
        Err(error) => return Err(error),
    };
    token.access_token = next.access_token;
    token.expires_at = now_seconds() + next.expires_in.unwrap_or(3600);
    write_google_token(&token)?;
    Ok(token)
}

fn google_user_email(access_token: &str) -> Result<String, String> {
    let response = Client::new()
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .map_err(|err| format!("读取 Google 账号失败: {err}"))?;
    if !response.status().is_success() {
        return Err(google_http_error("读取 Google 账号失败", response));
    }
    let info: GoogleUserInfo = response
        .json()
        .map_err(|err| format!("解析 Google 账号失败: {err}"))?;
    Ok(info.email.or(info.name).unwrap_or_else(|| "Google 用户".to_string()))
}

fn guess_mime_type(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "webm" => "audio/webm",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn make_google_drive_file_public(access_token: &str, file_id: &str) -> Result<(), String> {
    let permission = DrivePermissionRequest {
        role: "reader".to_string(),
        permission_type: "anyone".to_string(),
        allow_file_discovery: false,
    };
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}/permissions?fields=id",
        urlencoding::encode(file_id)
    );
    let response = Client::new()
        .post(url)
        .bearer_auth(access_token)
        .json(&permission)
        .send()
        .map_err(|err| format!("设置 Google Drive 分享权限失败: {err}"))?;
    if !response.status().is_success() {
        return Err(google_http_error("设置 Google Drive 分享权限失败", response));
    }
    Ok(())
}


#[tauri::command]
fn get_default_recordings_dir() -> Result<String, String> {
    Ok(default_recordings_dir()?.to_string_lossy().to_string())
}

#[tauri::command]
fn select_save_directory(current_dir: Option<String>) -> Result<Option<String>, String> {
    let initial_dir = recordings_dir(current_dir).or_else(|_| default_recordings_dir())?;
    Ok(rfd::FileDialog::new()
        .set_title("选择音频保存文件夹")
        .set_directory(initial_dir)
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn select_google_oauth_client_file() -> Result<Option<GoogleOAuthClientConfig>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("选择 Google OAuth Client JSON")
        .add_filter("Google OAuth JSON", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let text = fs::read_to_string(path).map_err(|err| format!("读取 OAuth JSON 失败: {err}"))?;
    parse_google_oauth_client_config(&text).map(Some)
}

#[tauri::command]
fn select_audio_editor_file(app: AppHandle, save_dir: Option<String>) -> Result<Option<EditorAudioImport>, String> {
    let Some(source_path) = rfd::FileDialog::new()
        .set_title("导入音频文件")
        .add_filter("音频文件", &["mp3", "wav", "m4a", "aac", "flac", "ogg", "webm"])
        .pick_file()
    else {
        return Ok(None);
    };
    prepare_editor_audio_file(&app, source_path, save_dir).map(Some)
}

fn prepare_editor_audio_file(app: &AppHandle, source_path: PathBuf, save_dir: Option<String>) -> Result<EditorAudioImport, String> {
    if !source_path.exists() {
        return Err("音频文件不存在，无法准备播放".to_string());
    }
    let metadata = fs::metadata(&source_path).map_err(|err| format!("读取音频文件信息失败: {err}"))?;
    let filename = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(clean_filename)
        .unwrap_or_else(|| "AudioRecorder.mp3".to_string());
    let editor_cache_dir = editor_audio_media_cache_dir_for_save(save_dir.clone())?;
    let playback_path = if path_is_inside(&source_path, &editor_cache_dir) {
        source_path.clone()
    } else {
        editor_audio_cache_path(&source_path, &filename, &metadata, save_dir.clone())?
    };
    if !playback_path.exists() {
        copy_file_safely(&source_path, &playback_path)?;
    }
    allow_editor_cache_asset_scope(app, save_dir)?;

    Ok(EditorAudioImport {
        source_path: source_path.to_string_lossy().to_string(),
        playback_path: playback_path.to_string_lossy().to_string(),
        filename,
    })
}

#[tauri::command]
fn prepare_audio_editor_file(app: AppHandle, path: String, save_dir: Option<String>) -> Result<EditorAudioImport, String> {
    prepare_editor_audio_file(&app, PathBuf::from(path), save_dir)
}

#[tauri::command]
fn save_audio_file(filename: String, base64_data: String, save_dir: Option<String>) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|err| format!("音频数据解码失败: {err}"))?;
    let path = unique_recording_path(recordings_dir(save_dir)?, &filename);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|err| format!("创建音频文件失败: {err}"))?;
    file.write_all(&bytes)
        .map_err(|err| format!("保存音频失败: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_uploaded_local_audio_file(path: String, save_dir: Option<String>) -> Result<bool, String> {
    let save_root = recordings_dir(save_dir)?;
    let target = PathBuf::from(path);
    if !path_is_inside(&target, &save_root) {
        return Ok(false);
    }
    if target.exists() && target.is_file() {
        fs::remove_file(&target).map_err(|err| format!("删除已上传本地音频失败: {err}"))?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn save_editor_source_file(filename: String, base64_data: String, save_dir: Option<String>) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|err| format!("编辑器音频数据解码失败: {err}"))?;
    let path = unique_recording_path(editor_audio_media_cache_dir_for_save(save_dir)?, &filename);
    write_file_safely(&path, &bytes)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn export_editor_segments_mp3(
    app: AppHandle,
    segments: Vec<EditorExportSegment>,
    filename: String,
    bitrate_kbps: Option<u32>,
    save_dir: Option<String>,
) -> Result<EditorExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_editor_segments_mp3_blocking(Some(app), segments, filename, bitrate_kbps, save_dir)
    })
    .await
    .map_err(|err| format!("编辑音频导出线程失败: {err}"))?
}

#[tauri::command]
fn delete_editor_audio_cache_file(path: String, save_dir: Option<String>) -> Result<bool, String> {
    let cache_dir = editor_audio_media_cache_dir_for_save(save_dir)?;
    let target = PathBuf::from(path);
    if !path_is_inside(&target, &cache_dir) {
        return Ok(false);
    }
    if target.exists() && target.is_file() {
        fs::remove_file(&target).map_err(|err| format!("删除编辑器音频缓存失败: {err}"))?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn save_cache_file(
    filename: String,
    base64_data: String,
    save_dir: Option<String>,
    overwrite_existing: Option<bool>,
) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|err| format!("缓存音频数据解码失败: {err}"))?;
    let save_root = recordings_dir(save_dir.clone())?;
    let dir = save_root.join("录音缓存文件");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建录音缓存目录: {err}"))?;
    let path = if overwrite_existing.unwrap_or(false) {
        dir.join(clean_filename(&filename))
    } else {
        unique_recording_path(dir, &filename)
    };
    if overwrite_existing.unwrap_or(false) {
        fs::write(&path, bytes).map_err(|err| format!("保存缓存音频失败: {err}"))?;
    } else {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|err| format!("创建缓存音频失败: {err}"))?;
        file.write_all(&bytes)
            .map_err(|err| format!("保存缓存音频失败: {err}"))?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_cache_file_chunk(
    filename: String,
    base64_data: String,
    save_dir: Option<String>,
    append_existing: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_cache_file_chunk_blocking(filename, base64_data, save_dir, append_existing)
    })
    .await
    .map_err(|err| format!("缓存写入线程失败: {err}"))?
}

fn save_cache_file_chunk_blocking(
    filename: String,
    base64_data: String,
    save_dir: Option<String>,
    append_existing: Option<bool>,
) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|err| format!("缓存音频数据解码失败: {err}"))?;
    let save_root = recordings_dir(save_dir.clone())?;
    let dir = save_root.join("录音缓存文件");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建录音缓存目录: {err}"))?;
    let append_existing = append_existing.unwrap_or(false);
    let path = if append_existing {
        dir.join(clean_filename(&filename))
    } else {
        unique_recording_path(dir, &filename)
    };

    let mut file = if append_existing {
        fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
            .map_err(|err| format!("打开缓存音频失败: {err}"))?
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|err| format!("创建缓存音频失败: {err}"))?
    };
    file.write_all(&bytes)
        .map_err(|err| format!("写入缓存音频失败: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_cache_file(filename: String, save_dir: Option<String>) -> Result<bool, String> {
    let path = cache_dir(save_dir)?.join(clean_filename(&filename));
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path).map_err(|err| format!("删除缓存音频失败: {err}"))?;
    Ok(true)
}

#[tauri::command]
fn cleanup_cache_files(
    save_dir: Option<String>,
    retention_days: u64,
    protected_filename: Option<String>,
    source_paths: Option<Vec<String>>,
) -> Result<u64, String> {
    if retention_days == 0 {
        return Ok(0);
    }

    let save_root = recordings_dir(save_dir.clone())?;
    let dir = save_root.join("录音缓存文件");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建录音缓存目录: {err}"))?;
    let protected = protected_filename.map(|value| clean_filename(&value));
    let max_age = std::time::Duration::from_secs(retention_days.saturating_mul(86_400));
    let now = std::time::SystemTime::now();

    let mut deleted_count = cleanup_old_files_in_dir(&dir, max_age, protected.as_deref(), now)?;
    deleted_count += cleanup_old_files_in_dir(&save_root.join(SOURCE_CACHE_FOLDER), max_age, None, now)?;
    let mut cleaned_source_roots = HashSet::new();
    for source_path in source_paths.unwrap_or_default() {
        if let Some(root) = source_cache_root_for_path(&source_path) {
            let key = root.to_string_lossy().to_string();
            if cleaned_source_roots.insert(key) {
                deleted_count += cleanup_old_files_in_dir(&root, max_age, None, now)?;
            }
        }
    }

    Ok(deleted_count)
}

#[tauri::command]
fn clear_editor_waveform_cache(save_dir: Option<String>) -> Result<u64, String> {
    let cache_root = recordings_dir(save_dir)?.join(SOURCE_CACHE_FOLDER);
    if !cache_root.exists() {
        return Ok(0);
    }

    let mut deleted_count = 0;
    for entry_result in fs::read_dir(&cache_root).map_err(|err| format!("读取音波缓存目录失败: {err}"))? {
        let entry = entry_result.map_err(|err| format!("读取音波缓存文件失败: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            deleted_count += count_files_in_dir(&path)?;
            fs::remove_dir_all(&path).map_err(|err| format!("删除音波缓存目录失败 {}: {err}", path.display()))?;
        } else if path.is_file() {
            fs::remove_file(&path).map_err(|err| format!("删除音波缓存文件失败 {}: {err}", path.display()))?;
            deleted_count += 1;
        }
    }
    hide_cache_root_folder(&cache_root);
    Ok(deleted_count)
}

#[tauri::command]
fn google_drive_status() -> Result<GoogleDriveStatus, String> {
    let Some(token) = read_google_token() else {
        return Ok(GoogleDriveStatus {
            connected: false,
            email: String::new(),
        });
    };
    Ok(GoogleDriveStatus {
        connected: !token.refresh_token.is_empty(),
        email: token.email,
    })
}

#[tauri::command]
fn google_drive_disconnect() -> Result<(), String> {
    delete_google_token_file()
}

#[tauri::command]
async fn google_drive_connect(
    cancel_state: tauri::State<'_, GoogleOAuthCancel>,
    client_id: String,
    client_secret: Option<String>,
) -> Result<GoogleDriveStatus, String> {
    let oauth_session = prepare_google_oauth_session(client_id, client_secret)?;
    let current_cancel = Arc::clone(&oauth_session.cancelled);
    {
        let mut guard = cancel_state
            .0
            .lock()
            .map_err(|_| "Google 授权取消状态已损坏".to_string())?;
        if let Some(previous) = guard.replace(Arc::clone(&current_cancel)) {
            previous.store(true, Ordering::SeqCst);
        }
    }

    let result = tauri::async_runtime::spawn_blocking(move || google_drive_connect_blocking(oauth_session))
        .await
        .map_err(|err| format!("Google Drive 授权线程失败: {err}"))?;

    if let Ok(mut guard) = cancel_state.0.lock() {
        if guard
            .as_ref()
            .map(|cancelled| Arc::ptr_eq(cancelled, &current_cancel))
            .unwrap_or(false)
        {
            *guard = None;
        }
    }

    result
}

#[tauri::command]
fn google_drive_cancel_connect(cancel_state: tauri::State<'_, GoogleOAuthCancel>) -> Result<(), String> {
    let Some(cancelled) = cancel_state
        .0
        .lock()
        .map_err(|_| "Google 授权取消状态已损坏".to_string())?
        .as_ref()
        .cloned()
    else {
        return Ok(());
    };
    cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

struct GoogleOAuthSession {
    client_id: String,
    client_secret: String,
    verifier: String,
    listener: TcpListener,
    redirect_uri: String,
    cancelled: Arc<AtomicBool>,
}

fn prepare_google_oauth_session(
    client_id: String,
    client_secret: Option<String>,
) -> Result<GoogleOAuthSession, String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.unwrap_or_default().trim().to_string();
    if client_id.is_empty() {
        return Err("请先填写 Google OAuth Client ID".to_string());
    }

    let verifier = random_code_verifier();
    let challenge = code_challenge(&verifier);
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|err| format!("启动本机授权回调失败: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("读取授权回调端口失败: {err}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth2callback");
    let scope = "openid email profile https://www.googleapis.com/auth/drive.file";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(&challenge)
    );

    let cancelled = Arc::new(AtomicBool::new(false));
    open_target_with_system(&auth_url)?;

    Ok(GoogleOAuthSession {
        client_id,
        client_secret,
        verifier,
        listener,
        redirect_uri,
        cancelled,
    })
}

fn google_drive_connect_blocking(session: GoogleOAuthSession) -> Result<GoogleDriveStatus, String> {
    let GoogleOAuthSession {
        client_id,
        client_secret,
        verifier,
        listener,
        redirect_uri,
        cancelled,
        ..
    } = session;

    let code = read_oauth_code(listener, cancelled)?;
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret.as_str()));
    }

    let mut saved_client_secret = client_secret.clone();
    let token_response = match request_google_token(&form, "获取 Google 令牌失败") {
        Ok(token_response) => token_response,
        Err(first_error) if !client_secret.is_empty() => {
            let fallback_form = [
                ("client_id", client_id.as_str()),
                ("code", code.as_str()),
                ("code_verifier", verifier.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ];
            saved_client_secret.clear();
            request_google_token(&fallback_form, "获取 Google 令牌失败")
                .map_err(|second_error| format!("{first_error}\n无 Client Secret 重试仍失败: {second_error}"))?
        }
        Err(error) => return Err(error),
    };
    let email = google_user_email(&token_response.access_token).unwrap_or_else(|_| "Google 用户".to_string());
    let token = GoogleDriveToken {
        client_id,
        client_secret: saved_client_secret,
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token.unwrap_or_default(),
        expires_at: now_seconds() + token_response.expires_in.unwrap_or(3600),
        email: email.clone(),
    };
    if token.refresh_token.is_empty() {
        return Err("Google 没有返回刷新令牌，请移除旧授权后重新连接".to_string());
    }
    write_google_token(&token)?;
    Ok(GoogleDriveStatus {
        connected: true,
        email,
    })
}

#[tauri::command]
async fn upload_google_drive_file(
    window: tauri::WebviewWindow,
    path: String,
    filename: String,
    folder_id: Option<String>,
    share_public: Option<bool>,
    upload_id: u64,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        upload_google_drive_file_blocking(window, path, filename, folder_id, share_public, upload_id)
    })
    .await
    .map_err(|err| format!("Google Drive 上传线程失败: {err}"))?
}

fn upload_google_drive_file_blocking(
    window: tauri::WebviewWindow,
    path: String,
    filename: String,
    folder_id: Option<String>,
    share_public: Option<bool>,
    upload_id: u64,
) -> Result<String, String> {
    let mut token = read_google_token().ok_or_else(|| "请先连接 Google 云端硬盘".to_string())?;
    token = refresh_google_access_token(token)?;

    let path = PathBuf::from(path);
    let bytes = fs::read(&path).map_err(|err| format!("读取待上传音频失败: {err}"))?;
    let upload_name = clean_filename(if filename.trim().is_empty() {
        path.file_name().and_then(|value| value.to_str()).unwrap_or("AudioRecorder.mp3")
    } else {
        filename.trim()
    });
    let folder_id = folder_id.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    let metadata = DriveUploadMetadata {
        name: upload_name.clone(),
        parents: folder_id.map(|value| vec![value]),
    };
    let metadata_json = serde_json::to_string(&metadata).map_err(|err| format!("生成上传元数据失败: {err}"))?;
    let boundary = format!("audiorecorder-{}", chrono_like_timestamp());
    let mime_type = guess_mime_type(&path);
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata_json}\r\n").as_bytes());
    body.extend_from_slice(format!("--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let total_bytes = body.len() as u64;
    let _ = window.emit(
        "google-drive-upload-progress",
        GoogleDriveUploadProgress {
            upload_id,
            sent_bytes: 0,
            total_bytes,
            percent: 0,
        },
    );
    let progress_window = window.clone();
    let reader = ProgressReader {
        inner: Cursor::new(body),
        upload_id,
        sent_bytes: 0,
        total_bytes,
        last_percent: 0,
        on_progress: Box::new(move |progress| {
            let _ = progress_window.emit("google-drive-upload-progress", progress);
        }),
    };

    let response = Client::new()
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink")
        .bearer_auth(&token.access_token)
        .header("Content-Type", format!("multipart/related; boundary={boundary}"))
        .header("Content-Length", total_bytes.to_string())
        .body(Body::new(reader))
        .send()
        .map_err(|err| format!("上传到 Google Drive 失败: {err}"))?;
    if !response.status().is_success() {
        return Err(google_http_error("上传到 Google Drive 失败", response));
    }
    let uploaded: DriveUploadResponse = response
        .json()
        .map_err(|err| format!("解析上传结果失败: {err}"))?;
    let file_id = uploaded.id.clone();
    if share_public.unwrap_or(false) {
        let id = file_id.as_deref().ok_or_else(|| "设置 Google Drive 分享权限失败: 上传结果没有文件 ID".to_string())?;
        make_google_drive_file_public(&token.access_token, id)?;
    }
    let _ = window.emit(
        "google-drive-upload-progress",
        GoogleDriveUploadProgress {
            upload_id,
            sent_bytes: total_bytes,
            total_bytes,
            percent: 100,
        },
    );
    Ok(uploaded
        .web_view_link
        .or_else(|| file_id.map(|id| format!("https://drive.google.com/file/d/{id}/view")))
        .or(uploaded.name)
        .unwrap_or(upload_name))
}

#[tauri::command]
async fn read_native_audio_metadata(path: String) -> Result<NativeAudioMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || read_native_audio_metadata_blocking(path))
        .await
        .map_err(|err| format!("读取音频元数据任务失败: {err}"))?
}

#[tauri::command]
async fn load_native_audio_waveform_levels(
    window: tauri::Window,
    path: String,
    levels: Vec<usize>,
    request_id: Option<String>,
    save_dir: Option<String>,
) -> Result<NativeAudioWaveformLevels, String> {
    let request_id = request_id.unwrap_or_else(chrono_like_timestamp);
    let app_handle = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = fs::metadata(&path).map_err(|err| format!("读取音频文件信息失败: {err}"))?;
        let file_size = metadata.len();
        let modified = file_modified_seconds(&metadata);
        let emit_progress = |percent: u8, stage: &str| {
            let _ = window.emit(
                "native-waveform-progress",
                NativeWaveformProgress {
                    request_id: request_id.clone(),
                    path: path.clone(),
                    stage: stage.to_string(),
                    percent,
                    preview: None,
                },
            );
        };
        emit_progress(1, "正在检查波形缓存");
        let mut normalized_levels = levels
            .into_iter()
            .map(|points| points.clamp(1_000, 80_000))
            .collect::<Vec<_>>();
        normalized_levels.sort_unstable();
        normalized_levels.dedup();
        if normalized_levels.is_empty() {
            normalized_levels.push(20_000);
        }

        let mut cached_levels = Vec::with_capacity(normalized_levels.len());
        let mut all_cached = true;
        for target_points in &normalized_levels {
            let cache_path = waveform_cache_path(&path, file_size, modified, *target_points, save_dir.clone())?;
            let cached = if cache_path.exists() {
                fs::read_to_string(&cache_path)
                    .ok()
                    .and_then(|text| serde_json::from_str::<NativeAudioWaveform>(&text).ok())
                    .filter(|waveform| {
                        waveform.point_count == waveform.mins.len()
                            && waveform.point_count == waveform.maxs.len()
                            && waveform.point_count > 0
                            && waveform.duration > 0.0
                    })
            } else {
                None
            };

            if let Some(mut waveform) = cached {
                waveform.cache_hit = true;
                cached_levels.push(waveform);
            } else {
                all_cached = false;
                break;
            }
        }

        if all_cached {
            emit_progress(100, "已读取波形缓存");
            return Ok(NativeAudioWaveformLevels { levels: cached_levels });
        }

        emit_progress(3, "正在启动解码任务");
        let max_points = *normalized_levels.last().unwrap_or(&20_000);
        let allow_preview = max_points <= 20_000;
        let ffmpeg_result = {
            let ffmpeg_window = window.clone();
            let ffmpeg_request_id = request_id.clone();
            let ffmpeg_path = path.clone();
            build_ffmpeg_audio_waveform(
                Some(app_handle.clone()),
                path.clone(),
                max_points,
                Some(Box::new(move |percent, stage, preview| {
                    let preview = if allow_preview { preview } else { None };
                    let _ = ffmpeg_window.emit(
                        "native-waveform-progress",
                        NativeWaveformProgress {
                            request_id: ffmpeg_request_id.clone(),
                            path: ffmpeg_path.clone(),
                            stage,
                            percent,
                            preview,
                        },
                    );
                })),
            )
        };

        let max_waveform = match ffmpeg_result {
            Ok(waveform) => waveform,
            Err(ffmpeg_error) => {
                emit_progress(4, &format!("FFmpeg 后台波形不可用，正在回退: {ffmpeg_error}"));

                #[cfg(target_os = "windows")]
                {
                    let native_window = window.clone();
                    let native_request_id = request_id.clone();
                    let native_path = path.clone();
                    match build_media_foundation_audio_waveform(
                        path.clone(),
                        max_points,
                        Some(Box::new(move |percent, stage, preview| {
                            let preview = if allow_preview { preview } else { None };
                            let _ = native_window.emit(
                                "native-waveform-progress",
                                NativeWaveformProgress {
                                    request_id: native_request_id.clone(),
                                    path: native_path.clone(),
                                    stage,
                                    percent,
                                    preview,
                                },
                            );
                        })),
                    ) {
                        Ok(waveform) => waveform,
                        Err(err) => {
                            emit_progress(
                                5,
                                &format!("Windows 原生解码失败，正在回退兼容解码器: {err}"),
                            );
                            let fallback_window = window.clone();
                            let fallback_request_id = request_id.clone();
                            let fallback_path = path.clone();
                            build_native_audio_waveform(
                                path.clone(),
                                max_points,
                                Some(Box::new(move |percent, stage, preview| {
                                    let preview = if allow_preview { preview } else { None };
                                    let _ = fallback_window.emit(
                                        "native-waveform-progress",
                                        NativeWaveformProgress {
                                            request_id: fallback_request_id.clone(),
                                            path: fallback_path.clone(),
                                            stage,
                                            percent,
                                            preview,
                                        },
                                    );
                                })),
                            )?
                        }
                    }
                }

                #[cfg(not(target_os = "windows"))]
                {
                    let progress_window = window.clone();
                    let progress_request_id = request_id.clone();
                    let progress_path = path.clone();
                    build_native_audio_waveform(
                        path.clone(),
                        max_points,
                        Some(Box::new(move |percent, stage, preview| {
                            let preview = if allow_preview { preview } else { None };
                            let _ = progress_window.emit(
                                "native-waveform-progress",
                                NativeWaveformProgress {
                                    request_id: progress_request_id.clone(),
                                    path: progress_path.clone(),
                                    stage,
                                    percent,
                                    preview,
                                },
                            );
                        })),
                    )?
                }
            }
        };

        emit_progress(97, "正在生成多级缓存");
        let mut built_levels = Vec::with_capacity(normalized_levels.len());
        for target_points in normalized_levels {
            let mut waveform = if target_points == max_waveform.point_count {
                max_waveform.clone()
            } else {
                let (mins, maxs) = compact_waveform_peaks(&max_waveform.mins, &max_waveform.maxs, target_points);
                NativeAudioWaveform {
                    duration: max_waveform.duration,
                    sample_rate: max_waveform.sample_rate,
                    channels: max_waveform.channels,
                    point_count: mins.len(),
                    mins,
                    maxs,
                    cache_hit: false,
                }
            };

            let cache_path = waveform_cache_path(&path, file_size, modified, target_points, save_dir.clone())?;
            if let Ok(text) = serde_json::to_string(&waveform) {
                let _ = write_file_safely(&cache_path, text.as_bytes());
            }
            waveform.cache_hit = false;
            built_levels.push(waveform);
        }

        emit_progress(100, "波形缓存完成");
        Ok(NativeAudioWaveformLevels { levels: built_levels })
    })
    .await
    .map_err(|err| format!("生成长音频波形任务失败: {err}"))?
}

#[tauri::command]
fn open_recordings_folder(save_dir: Option<String>) -> Result<(), String> {
    let dir = recordings_dir(save_dir)?;
    open_target_with_system(&dir.to_string_lossy())
}

#[tauri::command]
fn open_target(target: String) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("链接或路径为空".to_string());
    }
    open_target_with_system(trimmed)
}

#[tauri::command]
fn get_launch_action(state: tauri::State<'_, StartupLaunchAction>) -> Result<Option<LaunchAction>, String> {
    let mut launch_action = state
        .0
        .lock()
        .map_err(|_| "读取启动动作失败".to_string())?
        .take()
        .or_else(|| parse_launch_action_from_args(&env::args().collect::<Vec<_>>()));

    #[cfg(target_os = "windows")]
    if let Some(action) = launch_action.as_mut() {
        if action.action_type == "upload" {
            thread::sleep(Duration::from_millis(850));
            let preset_id = action.preset_id.as_deref().unwrap_or("default");
            let queued_paths = read_shell_upload_queue_paths(preset_id)?;
            if !queued_paths.is_empty() {
                action.file_paths = queued_paths;
                action.file_path = action.file_paths.first().cloned().unwrap_or_default();
            }
        }
    }

    Ok(launch_action)
}

#[tauri::command]
fn read_shell_upload_queue(preset_id: String) -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        return read_shell_upload_queue_paths(&preset_id);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = preset_id;
        Ok(Vec::new())
    }
}

#[tauri::command]
fn clear_shell_upload_queue(preset_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return clear_shell_upload_queue_file(&preset_id);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = preset_id;
        Ok(())
    }
}

#[tauri::command]
fn register_mp3_context_menu(presets: Vec<Mp3ContextMenuPreset>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return register_mp3_context_menu_windows(presets);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = presets;
        Err("当前系统不支持 Windows MP3 右键菜单".to_string())
    }
}

#[tauri::command]
fn unregister_mp3_context_menu() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return unregister_mp3_context_menu_windows();
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前系统不支持 Windows MP3 右键菜单".to_string())
    }
}

#[tauri::command]
fn close_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|err| format!("关闭窗口失败: {err}"))
}

#[tauri::command]
fn set_recording_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RecordingWindows>,
    recording: bool,
) -> Result<(), String> {
    let mut windows = state
        .0
        .lock()
        .map_err(|_| "无法更新录音窗口状态".to_string())?;
    if recording {
        windows.insert(window.label().to_string());
    } else {
        windows.remove(window.label());
    }
    Ok(())
}

fn looks_like_url(target: &str) -> bool {
    let lower = target.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
}

fn open_target_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if looks_like_url(target) {
            Command::new("rundll32")
                .arg("url.dll,FileProtocolHandler")
                .arg(target)
                .spawn()
                .map_err(|err| format!("无法打开默认浏览器: {err}"))?;
        } else {
            Command::new("explorer")
                .arg(target)
                .spawn()
                .map_err(|err| format!("无法打开链接或路径: {err}"))?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|err| format!("无法打开链接或路径: {err}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|err| format!("无法打开链接或路径: {err}"))?;
        return Ok(());
    }
}

fn has_active_recording(app: &tauri::AppHandle) -> bool {
    app.state::<RecordingWindows>()
        .0
        .lock()
        .map(|windows| !windows.is_empty())
        .unwrap_or(false)
}

#[tauri::command]
fn quit_all_windows(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "windows")]
fn startup_registry_key() -> Result<RegKey, String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(STARTUP_RUN_KEY, winreg::enums::KEY_READ | winreg::enums::KEY_WRITE)
        .map_err(|err| format!("无法打开开机自启注册表项: {err}"))
}

#[cfg(target_os = "windows")]
fn startup_command() -> Result<String, String> {
    let exe_path = env::current_exe().map_err(|err| format!("无法读取当前程序路径: {err}"))?;
    Ok(format!("\"{}\"", exe_path.display()))
}

#[tauri::command]
fn get_startup_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let key = startup_registry_key()?;
        let value: Result<String, _> = key.get_value(STARTUP_APP_NAME);
        let exe_path = env::current_exe()
            .map_err(|err| format!("无法读取当前程序路径: {err}"))?
            .display()
            .to_string();
        return Ok(value
            .ok()
            .map(|text| text.trim_matches('"').eq_ignore_ascii_case(&exe_path))
            .unwrap_or(false));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_startup_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let key = startup_registry_key()?;
        if enabled {
            key.set_value(STARTUP_APP_NAME, &startup_command()?)
                .map_err(|err| format!("无法开启开机自启: {err}"))?;
        } else {
            let _ = key.delete_value(STARTUP_APP_NAME);
        }
        return Ok(enabled);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

fn show_recording_quit_prompts(app: &tauri::AppHandle) {
    let recording_labels = app
        .state::<RecordingWindows>()
        .0
        .lock()
        .map(|windows| windows.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for label in recording_labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("request-quit-all-while-recording", ());
        }
    }
}

fn present_recorder_windows(app: &tauri::AppHandle) {
    let windows = app.webview_windows();
    for (label, window) in windows.iter() {
        if label.as_str() == "preset-menu" {
            let _ = window.hide();
            continue;
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "windows")]
fn listen_for_normal_instance_requests(app: tauri::AppHandle, event_name: String) {
    thread::spawn(move || {
        let event = unsafe { OpenEventW(EVENT_ALL_ACCESS, false, &HSTRING::from(event_name)) };
        let Ok(event) = event else {
            return;
        };

        loop {
            let wait_result = unsafe { WaitForSingleObject(event, INFINITE) };
            if wait_result != WAIT_OBJECT_0 {
                break;
            }
            present_recorder_windows(&app);
            let _ = app.emit("audio-recorder-normal-instance-requested", ());
        }

        unsafe {
            let _ = CloseHandle(event);
        }
    });
}

fn toggle_recorder_windows(app: &tauri::AppHandle) {
    let windows = app.webview_windows();
    let should_hide = windows
        .iter()
        .filter(|(label, _window)| label.as_str() != "preset-menu")
        .any(|(_label, window)| window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false));

    for (label, window) in windows.iter() {
        if label.as_str() == "preset-menu" {
            let _ = window.hide();
            continue;
        }
        if should_hide {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn run() {
    let startup_args = env::args().collect::<Vec<_>>();
    let parsed_startup_action = parse_launch_action_from_args(&startup_args);

    #[cfg(target_os = "windows")]
    let (startup_launch_action, _shell_upload_owner_guard) =
        if let Some(action) = parsed_startup_action.clone() {
            if action.action_type == "upload" {
                match prepare_shell_upload_startup(action) {
                    Ok(ShellUploadStartup::Owner(owner_action, owner_guard)) => (Some(owner_action), Some(owner_guard)),
                    Ok(ShellUploadStartup::Follower) => return,
                    Err(err) => {
                        eprintln!("AudioRecorder shell upload queue disabled: {err}");
                        (parsed_startup_action.clone(), None)
                    }
                }
            } else {
                (Some(action), None)
            }
        } else {
            (None, None)
        };
    #[cfg(not(target_os = "windows"))]
    let startup_launch_action = parsed_startup_action.clone();

    let is_shell_action_instance = startup_launch_action.is_some();

    #[cfg(target_os = "windows")]
    let normal_single_instance_guard = match acquire_normal_single_instance() {
        Ok(NormalSingleInstanceResult::Primary(guard)) => Some(guard),
        Ok(NormalSingleInstanceResult::SecondarySignaled) => return,
        Ok(NormalSingleInstanceResult::ShellAction) => None,
        Err(err) => {
            eprintln!("AudioRecorder normal single instance disabled: {err}");
            None
        }
    };
    #[cfg(target_os = "windows")]
    let normal_single_instance_event_name = normal_single_instance_guard
        .as_ref()
        .map(|guard| guard.event_name.clone());

    tauri::Builder::default()
        .manage(RecordingWindows::default())
        .manage(GoogleOAuthCancel::default())
        .manage(StartupLaunchAction(Mutex::new(startup_launch_action)))
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            if let Some(event_name) = normal_single_instance_event_name.clone() {
                listen_for_normal_instance_requests(app.handle().clone(), event_name);
            }

            if !is_shell_action_instance {
                let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
                let app_handle = app.handle().clone();
                let arrange_grid_item = MenuItem::with_id(app, "arrange_grid", "网格排列窗口", true, None::<&str>)?;
                let arrange_horizontal_item = MenuItem::with_id(app, "arrange_horizontal", "横向排列窗口", true, None::<&str>)?;
                let arrange_vertical_item = MenuItem::with_id(app, "arrange_vertical", "纵向排列窗口", true, None::<&str>)?;
                let arrange_left_item = MenuItem::with_id(app, "arrange_left", "贴左侧排列", true, None::<&str>)?;
                let arrange_right_item = MenuItem::with_id(app, "arrange_right", "贴右侧排列", true, None::<&str>)?;
                let arrange_restore_item = MenuItem::with_id(app, "arrange_restore", "恢复上次位置", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit_all", "退出全部", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[
                    &arrange_grid_item,
                    &arrange_horizontal_item,
                    &arrange_vertical_item,
                    &arrange_left_item,
                    &arrange_right_item,
                    &arrange_restore_item,
                    &quit_item,
                ])?;
                TrayIconBuilder::new()
                    .icon(tray_icon)
                    .tooltip("AudioRecorder")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(move |_tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            toggle_recorder_windows(&app_handle);
                        }
                    })
                    .on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "arrange_grid" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "grid");
                            }
                            "arrange_horizontal" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "horizontal");
                            }
                            "arrange_vertical" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "vertical");
                            }
                            "arrange_left" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "left");
                            }
                            "arrange_right" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "right");
                            }
                            "arrange_restore" => {
                                let _ = app.emit("audio-recorder-arrange-windows", "restore");
                            }
                            "quit_all" => {
                                if has_active_recording(app) {
                                    show_recording_quit_prompts(app);
                                } else {
                                    app.exit(0);
                                }
                            }
                            _ => {}
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_recordings_dir,
            select_save_directory,
            select_google_oauth_client_file,
            select_audio_editor_file,
            prepare_audio_editor_file,
            save_audio_file,
            delete_uploaded_local_audio_file,
            save_editor_source_file,
            export_editor_segments_mp3,
            delete_editor_audio_cache_file,
            save_cache_file,
            save_cache_file_chunk,
            delete_cache_file,
            cleanup_cache_files,
            clear_editor_waveform_cache,
            google_drive_status,
            google_drive_connect,
            google_drive_cancel_connect,
            google_drive_disconnect,
            upload_google_drive_file,
            read_native_audio_metadata,
            load_native_audio_waveform_levels,
            open_recordings_folder,
            open_target,
            get_launch_action,
            read_shell_upload_queue,
            clear_shell_upload_queue,
            register_mp3_context_menu,
            unregister_mp3_context_menu,
            close_main_window,
            set_recording_state,
            get_startup_enabled,
            set_startup_enabled,
            quit_all_windows
        ])
        .run(tauri::generate_context!())
        .expect("error while running AudioRecorder");
}
