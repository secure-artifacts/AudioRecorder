import React, { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow, LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  AudioLines,
  ArrowUp,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Search,
  Settings,
  SkipBack,
  SlidersHorizontal,
  Split,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  X
} from 'lucide-react';

const VERSION = '0.0.9';
const LEGACY_AUTO_SAVE_KEY = 'audioRecorderAutoDownload';
const PRESETS_KEY = 'audioRecorderPresetsV1';
const DEFAULT_PRESET_ID = 'default';
const PRESET_MENU_LABEL = 'preset-menu';
const PRESETS_UPDATED_EVENT = 'audio-recorder-presets-updated';
const SHELL_ACTION_STORAGE_PREFIX = 'audioRecorderPendingShellAction:';
const GLOBAL_SCALE_UPDATED_EVENT = 'audio-recorder-global-scale-updated';
const GLOBAL_WINDOW_SCALE_KEY = 'audioRecorderGlobalWindowScale';
const MICROPHONE_SETTINGS_UPDATED_EVENT = 'audio-recorder-microphone-settings-updated';
const ARRANGE_WINDOWS_EVENT = 'audio-recorder-arrange-windows';
const SHELL_ACTION_EVENT = 'audio-recorder-shell-action';
const GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT = 'google-drive-upload-progress';
const NATIVE_WAVEFORM_PROGRESS_EVENT = 'native-waveform-progress';
const NATIVE_WAVEFORM_PREVIEW_POINTS = 200000;
const DEFAULT_EDITOR_ZOOM = 20;
const EDITOR_PLAYBACK_RATE_KEY = 'audioRecorderEditorPlaybackRate';
const EDITOR_FRAME_RATE_KEY = 'audioRecorderEditorFrameRate';
const STARTUP_ENABLED_KEY = 'audioRecorderStartupEnabled';

// 所有用户偏好都集中写入 localStorage，方便以后迁移到文件配置或 Tauri store。
const STORAGE_KEYS = {
  autoSave: 'audioRecorderAutoSave',
  autoOpenEditor: 'audioRecorderAutoOpenEditor',
  autoCache: 'audioRecorderAutoCache',
  cacheInterval: 'audioRecorderCacheInterval',
  cacheDeleteOnSave: 'audioRecorderCacheDeleteOnSave',
  cacheRetentionDays: 'audioRecorderCacheRetentionDays',
  bitrate: 'audioRecorderBitrate',
  layoutMode: 'audioRecorderLayoutMode',
  tokens: 'audioRecorderFilenameTokensV2',
  date: 'audioRecorderDate',
  name: 'audioRecorderName',
  numberDigits: 'audioRecorderNumberDigits',
  custom: 'audioRecorderCustom',
  saveDirectory: 'audioRecorderSaveDirectory',
  googleDriveAutoUpload: 'audioRecorderGoogleDriveAutoUpload',
  googleDrivePublicShare: 'audioRecorderGoogleDrivePublicShare',
  googleDriveClientId: 'audioRecorderGoogleDriveClientId',
  googleDriveClientSecret: 'audioRecorderGoogleDriveClientSecret',
  googleDriveFolderId: 'audioRecorderGoogleDriveFolderId',
  microphoneSlots: 'audioRecorderMicrophoneSlots',
  activeMicrophoneSlot: 'audioRecorderActiveMicrophoneSlot',
  timeCopyStyle: 'audioRecorderTimeCopyStyle',
  windowPosition: 'audioRecorderWindowPosition',
  arrangeBackupPosition: 'audioRecorderArrangeBackupPosition',
  links: 'audioRecorderLinks'
};

const tokenLabels = {
  date: '日期',
  time: '时间',
  name: '名称',
  number: '编号',
  custom: '自定义',
  separator: '分隔符'
};

const tokenOptions = ['date', 'time', 'name', 'number', 'custom', 'separator'];
const DEFAULT_TOKEN_TYPES = ['date', 'separator', 'time', 'separator', 'name', 'separator', 'number', 'separator', 'custom'];
const TEXT_DEFAULTS = {
  name: '名称',
  custom: '自定义'
};
const DEFAULT_BITRATE = 16;
const DEFAULT_CACHE_INTERVAL = 10;
const DEFAULT_CACHE_RETENTION_DAYS = 7;
const UPLOADED_LOCAL_FILES_LOG_LIMIT = 300;
const DEFAULT_WINDOW_SCALE = 100;
const AUDIO_EDITOR_HISTORY_LIMIT = 20;
const WINDOW_SCALE_OPTIONS = [100, 90, 80, 70, 60, 50];
const DEFAULT_SILENCE_CUT_SECONDS = 10;
const MIN_SILENCE_CUT_SECONDS = 1;
const MAX_SILENCE_CUT_SECONDS = 1000;
const DEFAULT_SILENCE_SENSITIVITY = 50;
const MIN_SILENCE_SENSITIVITY = 1;
const MAX_SILENCE_SENSITIVITY = 1000;
const DEFAULT_SILENCE_RESERVE_SECONDS = 0.5;
const MIN_SILENCE_RESERVE_SECONDS = 0;
const MAX_SILENCE_RESERVE_SECONDS = 60;
const EDITOR_SILENCE_SETTING_KEYS = {
  seconds: 'audioRecorderEditorSilenceCutSeconds',
  sensitivity: 'audioRecorderEditorSilenceSensitivity',
  reserve: 'audioRecorderEditorSilenceReserveSeconds'
};
const CACHE_RETENTION_OPTIONS = [
  { value: 1, label: '保留1天' },
  { value: 3, label: '保留3天' },
  { value: 7, label: '保留7天' },
  { value: 30, label: '保留30天' },
  { value: 0, label: '不自动清理' }
];
const DEFAULT_MICROPHONE_SLOTS = ['default', '', '', '', '', '', '', '', ''];
const DEFAULT_PRESET = {
  id: DEFAULT_PRESET_ID,
  title: '默认设置',
  icon: '🟢',
  enabled: true
};
const PRESET_STORAGE_KEYS = [
  'autoSave',
  'autoOpenEditor',
  'autoCache',
  'cacheInterval',
  'cacheDeleteOnSave',
  'cacheRetentionDays',
  'deleteLocalAfterUpload',
  'uploadedLocalRetentionDays',
  'uploadedLocalFiles',
  'bitrate',
  'layoutMode',
  'tokens',
  'date',
  'name',
  'numberDigits',
  'custom',
  'saveDirectory',
  'googleDriveAutoUpload',
  'googleDrivePublicShare',
  'googleDriveClientId',
  'googleDriveClientSecret',
  'googleDriveFolderId',
  'activeMicrophoneSlot',
  'timeCopyStyle',
  'windowPosition',
  'arrangeBackupPosition',
  'links'
];
const TIME_COPY_OPTIONS = [
  { value: 'plain', label: '无样式复制' },
  { value: 'color', label: '仅颜色' },
  { value: 'color23', label: '23PX颜色' },
  { value: 'color23bg', label: '23PX颜色BG' },
  { value: 'full', label: '复制整体样式' }
];
const EDITOR_PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5];
const EDITOR_FRAME_RATE_OPTIONS = [
  { value: '23.98', fps: 23.98, label: '23.98 fps (NTSC)' },
  { value: '24', fps: 24, label: '24 fps (Film)' },
  { value: '25', fps: 25, label: '25 fps (PAL/EBU)' },
  { value: '29.97-nd', fps: 29.97, label: '29.97 fps (NTSC Non-Drop)' },
  { value: '29.97-df', fps: 29.97, label: '29.97 fps (NTSC Drop-Frame)' },
  { value: '30', fps: 30, label: '30 fps' },
  { value: '50', fps: 50, label: '50 fps (PAL/EBU)' },
  { value: '59.94-nd', fps: 59.94, label: '59.94 fps (NTSC Non-Drop)' },
  { value: '59.94-df', fps: 59.94, label: '59.94 fps (NTSC Drop-Frame)' },
  { value: '60', fps: 60, label: '60 fps' },
  { value: 'cd', fps: 75, label: 'CD / Red Book (M:S:F)' }
];
const LEGACY_TEXT_DEFAULTS = {
  name: ['录音'],
  custom: ['自定义']
};
const windowSizes = {
  mini: [500, 230],
  regular: [560, 450]
};
const editorWindowSize = new LogicalSize(1200, 680);

function normalizeWindowScale(value) {
  const scale = Number(value);
  return WINDOW_SCALE_OPTIONS.includes(scale) ? scale : DEFAULT_WINDOW_SCALE;
}

function scaledWindowSize(layoutMode, scalePercent) {
  const [width, height] = windowSizes[layoutMode] || windowSizes.mini;
  const scale = normalizeWindowScale(scalePercent) / 100;
  return new LogicalSize(Math.round(width * scale), Math.round(height * scale));
}

// 文件名里的日期使用紧凑格式：20260101。
function todayText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function dateKeyFromValue(value) {
  const cleaned = String(value || '').replace(/\D/g, '');
  if (cleaned.length >= 8) return cleaned.slice(0, 8);
  return '';
}

function normalizeDateInput(value) {
  const key = dateKeyFromValue(value);
  if (!key) return '';
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function compactDateText(value) {
  return dateKeyFromValue(value) || todayText();
}

function filenameFromPath(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).pop() || 'AudioRecorder.mp3';
}

function editorMp3FilenameFromPath(path) {
  const filename = filenameFromPath(path);
  const stem = filename.replace(/\.[^.\\/]+$/i, '') || 'AudioRecorder';
  return `${stem}.mp3`;
}

function currentTimeText() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

function googleDriveFolderIdFromInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const folderMatch = text.match(/\/folders\/([^/?#]+)/i);
  if (folderMatch?.[1]) return decodeURIComponent(folderMatch[1]);
  try {
    const url = new URL(text);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {
    // 不是 URL 时按纯文件夹 ID 处理，兼容旧配置。
  }
  return text;
}

function googleDriveFolderLinkFromInput(value) {
  const folderId = googleDriveFolderIdFromInput(value);
  return folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` : 'https://drive.google.com/drive/my-drive';
}

function normalizeDriveUploadLink(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const link = value.webViewLink || value.web_view_link || value.fileLink || value.file_link || value.link || '';
  return typeof link === 'string' ? link : '';
}

function makeToken(type) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    value: type === 'separator' ? '_' : ''
  };
}

function makePresetId() {
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizePreset(preset, index = 0) {
  if (!preset || typeof preset !== 'object') return null;
  const id = String(preset.id || '').trim();
  if (!id) return null;
  const hasIcon = Object.prototype.hasOwnProperty.call(preset, 'icon');
  const hasTitle = Object.prototype.hasOwnProperty.call(preset, 'title');
  const fallbackTitle = id === DEFAULT_PRESET_ID ? DEFAULT_PRESET.title : `自定义预设${index}`;
  return {
    id,
    title: hasTitle ? sanitizePart(preset.title) : fallbackTitle,
    icon: String(hasIcon ? preset.icon : (id === DEFAULT_PRESET_ID ? DEFAULT_PRESET.icon : '🟢')).slice(0, 2),
    enabled: preset.enabled !== false
  };
}

function loadPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    if (Array.isArray(parsed)) {
      const normalized = parsed.map(normalizePreset).filter(Boolean);
      const hasDefault = normalized.some((preset) => preset.id === DEFAULT_PRESET_ID);
      return hasDefault ? normalized : [DEFAULT_PRESET, ...normalized];
    }
  } catch {
    // 预设列表损坏时只保留默认预设，避免启动白屏。
  }
  return [DEFAULT_PRESET];
}

function presetStorageKey(presetId, key) {
  const baseKey = STORAGE_KEYS[key];
  if (!baseKey) return key;
  return presetId === DEFAULT_PRESET_ID ? baseKey : `audioRecorderPreset:${presetId}:${baseKey}`;
}

function normalizeWindowPosition(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || 'null') : value;
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x: Math.round(x), y: Math.round(y) };
    }
  } catch {
    // 窗口坐标损坏时忽略，避免启动时定位失败。
  }
  return null;
}

function loadWindowPosition(presetId) {
  return normalizeWindowPosition(localStorage.getItem(presetStorageKey(presetId, 'windowPosition')));
}

function saveWindowPosition(presetId, position) {
  const normalized = normalizeWindowPosition(position);
  if (!normalized) return;
  localStorage.setItem(presetStorageKey(presetId, 'windowPosition'), JSON.stringify(normalized));
}

function loadArrangeBackupPosition(presetId) {
  return normalizeWindowPosition(localStorage.getItem(presetStorageKey(presetId, 'arrangeBackupPosition')));
}

function saveArrangeBackupPosition(presetId, position) {
  const normalized = normalizeWindowPosition(position);
  if (!normalized) return;
  localStorage.setItem(presetStorageKey(presetId, 'arrangeBackupPosition'), JSON.stringify(normalized));
}

function clearArrangeBackupPosition(presetId) {
  localStorage.removeItem(presetStorageKey(presetId, 'arrangeBackupPosition'));
}

function removePresetStorage(presetId) {
  if (presetId === DEFAULT_PRESET_ID) return;
  PRESET_STORAGE_KEYS.forEach((key) => localStorage.removeItem(presetStorageKey(presetId, key)));
}

function clonePresetStorage(sourcePresetId, targetPresetId) {
  PRESET_STORAGE_KEYS.forEach((key) => {
    if (key === 'windowPosition' || key === 'arrangeBackupPosition') return;
    const sourceKey = presetStorageKey(sourcePresetId, key);
    const targetKey = presetStorageKey(targetPresetId, key);
    const value = localStorage.getItem(sourceKey);
    if (value === null) {
      localStorage.removeItem(targetKey);
    } else {
      localStorage.setItem(targetKey, value);
    }
  });
}

function resolveInitialPresetId(presets) {
  const params = new URLSearchParams(window.location.search);
  const requestedPresetId = params.get('presetId');
  if (requestedPresetId && presets.some((preset) => preset.id === requestedPresetId)) return requestedPresetId;
  return DEFAULT_PRESET_ID;
}

function windowLabelForPreset(presetId) {
  if (presetId === DEFAULT_PRESET_ID) return 'main';
  return `preset-${presetId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function windowTitleForPreset(presetId) {
  const preset = loadPresets().find((item) => item.id === presetId);
  return sanitizePart(preset?.title) || DEFAULT_PRESET.title;
}

function presetDisplayTitle(preset) {
  return sanitizePart(preset?.title) || '未命名';
}

async function openedRecorderWindowItems(presets = loadPresets()) {
  if (!isTauriRuntime()) return [];
  const items = await Promise.all(
    presets.map(async (preset, index) => {
      const window = await WebviewWindow.getByLabel(windowLabelForPreset(preset.id)).catch(() => null);
      return window ? { preset, index, window } : null;
    })
  );
  return items.filter(Boolean);
}

async function openedRecorderWindowLayoutItems(presets = loadPresets()) {
  const openedItems = await openedRecorderWindowItems(presets);
  const layoutItems = await Promise.all(
    openedItems.map(async (item) => {
      const size = await item.window.outerSize().catch(() => null);
      return {
        ...item,
        width: Math.max(1, size?.width || windowSizes.mini[0]),
        height: Math.max(1, size?.height || windowSizes.mini[1])
      };
    })
  );
  return layoutItems;
}

async function arrangementBounds(anchorWindow) {
  const margin = 18;
  const monitor = await anchorWindow.currentMonitor?.().catch(() => null);
  const monitorX = Number(monitor?.position?.x) || 0;
  const monitorY = Number(monitor?.position?.y) || 0;
  const monitorWidth = Number(monitor?.size?.width) || window.screen?.availWidth || 1280;
  const monitorHeight = Number(monitor?.size?.height) || window.screen?.availHeight || 720;
  return {
    x: monitorX + margin,
    y: monitorY + margin,
    width: Math.max(240, monitorWidth - margin * 2),
    height: Math.max(180, monitorHeight - margin * 2)
  };
}

function arrangeVariableWindowPositions(mode, items, bounds) {
  const gap = -6;
  const positions = new Map();
  const totalWidth = items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * gap;
  const totalHeight = items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * gap;

  if (mode === 'horizontal' && totalWidth <= bounds.width) {
    let x = bounds.x;
    items.forEach((item) => {
      positions.set(item.preset.id, { x, y: bounds.y });
      x += item.width + gap;
    });
    return positions;
  }

  if (mode === 'vertical' && totalHeight <= bounds.height) {
    let y = bounds.y;
    items.forEach((item) => {
      positions.set(item.preset.id, { x: bounds.x, y });
      y += item.height + gap;
    });
    return positions;
  }

  if (mode === 'left' || mode === 'right') {
    const columns = [];
    let currentColumn = { width: 0, height: 0, items: [] };
    items.forEach((item) => {
      const nextHeight = currentColumn.items.length ? currentColumn.height + gap + item.height : item.height;
      if (currentColumn.items.length && nextHeight > bounds.height) {
        columns.push(currentColumn);
        currentColumn = { width: 0, height: 0, items: [] };
      }
      currentColumn.items.push(item);
      currentColumn.width = Math.max(currentColumn.width, item.width);
      currentColumn.height = currentColumn.items.length === 1 ? item.height : currentColumn.height + gap + item.height;
    });
    if (currentColumn.items.length) columns.push(currentColumn);

    let columnX = mode === 'right'
      ? bounds.x + bounds.width - columns[0].width
      : bounds.x;
    columns.forEach((column, columnIndex) => {
      if (mode === 'right' && columnIndex > 0) {
        columnX -= column.width + gap;
      }
      let y = bounds.y;
      column.items.forEach((item) => {
        positions.set(item.preset.id, { x: columnX, y });
        y += item.height + gap;
      });
      if (mode === 'left') columnX += column.width + gap;
    });
    return positions;
  }

  let x = bounds.x;
  let y = bounds.y;
  let rowHeight = 0;
  items.forEach((item) => {
    if (x > bounds.x && x + item.width > bounds.x + bounds.width) {
      x = bounds.x;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    positions.set(item.preset.id, { x, y });
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  });
  return positions;
}

async function emitArrangeRecorderWindows(mode) {
  if (!isTauriRuntime()) return;
  await emit(ARRANGE_WINDOWS_EVENT, { mode }).catch((error) => console.warn('发送窗口排列命令失败:', error));
}

function savePresetList(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  if (isTauriRuntime()) {
    emit(PRESETS_UPDATED_EVENT).catch((error) => console.warn('同步预设列表失败:', error));
    syncMp3ContextMenu(presets);
  }
}

function contextMenuPresetItems(presets = loadPresets()) {
  return presets
    .map((preset) => ({
      id: String(preset.id || '').trim(),
      title: presetDisplayTitle(preset)
    }))
    .filter((preset) => preset.id && preset.title);
}

function syncMp3ContextMenu(presets = loadPresets()) {
  if (!isTauriRuntime()) return;
  invoke('register_mp3_context_menu', { presets: contextMenuPresetItems(presets) })
    .catch((error) => console.warn('同步 MP3 右键菜单失败:', error));
}

function shellActionStorageKey(presetId) {
  return `${SHELL_ACTION_STORAGE_PREFIX}${presetId || DEFAULT_PRESET_ID}`;
}

function makeShellActionId(actionType, presetId, filePath) {
  return `${actionType || 'action'}:${presetId || DEFAULT_PRESET_ID}:${filePath || ''}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function shellActionFilePaths(action) {
  const paths = Array.isArray(action?.filePaths)
    ? action.filePaths
    : Array.isArray(action?.file_paths)
      ? action.file_paths
      : [];
  const fallbackPath = action?.filePath || action?.file_path || '';
  const merged = [...paths, fallbackPath]
    .map((path) => String(path || '').trim())
    .filter(Boolean);
  return [...new Set(merged)];
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function openRecorderPresetWindow(presetId, openSettings = true, offsetIndex = 0) {
  if (!isTauriRuntime()) return null;
  const label = windowLabelForPreset(presetId);
  const existingWindow = await WebviewWindow.getByLabel(label);
  if (existingWindow) {
    await existingWindow.unminimize().catch(() => {});
    await existingWindow.show().catch(() => {});
    await existingWindow.setTitle(windowTitleForPreset(presetId)).catch(() => {});
    await existingWindow.setFocus().catch(() => {});
    if (openSettings) await existingWindow.emit('open-preset-settings').catch(() => {});
    return existingWindow;
  }

  const url = `/?presetId=${encodeURIComponent(presetId)}${openSettings ? '&settings=1' : ''}`;
  const offset = Math.min(offsetIndex, 8) * 26;
  const savedPosition = loadWindowPosition(presetId);
  const scalePercent = normalizeWindowScale(localStorage.getItem(GLOBAL_WINDOW_SCALE_KEY));
  const scaledSize = scaledWindowSize('mini', scalePercent);
  return new WebviewWindow(label, {
    url,
    title: windowTitleForPreset(presetId),
    width: scaledSize.width,
    height: scaledSize.height,
    minWidth: scaledSize.width,
    minHeight: scaledSize.height,
    x: savedPosition?.x ?? 80 + offset,
    y: savedPosition?.y ?? 80 + offset,
    resizable: false,
    decorations: false,
    transparent: true,
    visible: false,
    focus: false
  });
}

// 加载可排序的文件名片段；旧数据损坏时自动回到默认组合。
function loadTokens(storageKey = STORAGE_KEYS.tokens) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .filter((token) => tokenLabels[token.type])
        .map((token) => ({ ...makeToken(token.type), ...token }));
    }
  } catch {
    // 本地存储数据损坏时直接使用默认命名规则。
  }
  return DEFAULT_TOKEN_TYPES.map(makeToken);
}

function loadTokensForPreset(presetId) {
  return loadTokens(presetStorageKey(presetId, 'tokens'));
}

function loadAutoSavePreference(storageKey = STORAGE_KEYS.autoSave) {
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) return saved !== 'false';
  if (storageKey === STORAGE_KEYS.autoSave) return localStorage.getItem(LEGACY_AUTO_SAVE_KEY) !== 'false';
  return true;
}

function normalizeNumberDigits(value) {
  const digits = Number(value);
  return [0, 2, 3].includes(digits) ? digits : 0;
}

function normalizeCacheInterval(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_CACHE_INTERVAL;
  return Math.min(3600, Math.max(1, Math.round(seconds)));
}

function normalizeCacheRetentionDays(value) {
  const days = Number(value);
  return CACHE_RETENTION_OPTIONS.some((option) => option.value === days) ? days : DEFAULT_CACHE_RETENTION_DAYS;
}

function dayIndexFromStartDate(startDateKey) {
  if (!startDateKey) return null;
  const startYear = Number(startDateKey.slice(0, 4));
  const startMonth = Number(startDateKey.slice(4, 6));
  const startDay = Number(startDateKey.slice(6, 8));
  const todayKey = todayText();
  const todayYear = Number(todayKey.slice(0, 4));
  const todayMonth = Number(todayKey.slice(4, 6));
  const todayDay = Number(todayKey.slice(6, 8));
  const startTime = Date.UTC(startYear, startMonth - 1, startDay);
  const todayTime = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const diffDays = Math.floor((todayTime - startTime) / 86400000) + 1;
  return diffDays > 0 ? diffDays : null;
}

function formatRecordingNumber(value, digits) {
  if (!value) return 'N';
  const text = String(value);
  return digits > 0 ? text.padStart(digits, '0') : text;
}

// 时间码只负责显示，真实录音时长由 totalSeconds 累计。
function formatTime(totalSeconds) {
  const value = Math.max(0, totalSeconds);
  const hrs = Math.floor(value / 3600);
  const mins = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return [hrs, mins, secs].map((item) => String(item).padStart(2, '0')).join(':');
}

function formatEditorTime(seconds) {
  const safeValue = Math.max(0, Number(seconds) || 0);
  const wholeSeconds = Math.floor(safeValue);
  const millis = Math.floor((safeValue - wholeSeconds) * 1000);
  return `${formatTime(wholeSeconds)}.${String(millis).padStart(3, '0')}`;
}

function normalizeEditorPlaybackRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0.1 && rate <= 8 ? rate : 1;
}

function normalizeEditorFrameRate(value) {
  const text = String(value || '30');
  return EDITOR_FRAME_RATE_OPTIONS.some((option) => option.value === text) ? text : '30';
}

function editorFrameRateOption(value) {
  const normalized = normalizeEditorFrameRate(value);
  return EDITOR_FRAME_RATE_OPTIONS.find((option) => option.value === normalized) || EDITOR_FRAME_RATE_OPTIONS.find((option) => option.value === '30');
}

function formatEditorFpsTime(value, frameRateValue = '30') {
  const option = editorFrameRateOption(frameRateValue);
  const fps = Math.max(1, Number(option?.fps) || 30);
  const safeValue = Math.max(0, Number(value) || 0);
  const wholeSeconds = Math.floor(safeValue);
  const frame = Math.min(Math.ceil(fps) - 1, Math.max(0, Math.floor((safeValue - wholeSeconds) * fps + 0.000001)));
  return `${formatTime(wholeSeconds)}:${String(frame).padStart(2, '0')}`;
}

function parseEditorTimeInput(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (!text.includes(':')) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds : 0;
  }
  const parts = text.split(':').map((part) => part.trim());
  if (parts.length > 3) return 0;
  const [hoursText, minutesText, secondsText] = parts.length === 3
    ? parts
    : ['0', ...parts];
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

function clampEditorTime(value, maxValue) {
  const number = typeof value === 'string' ? parseEditorTimeInput(value) : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(number, 0), Math.max(0, maxValue || 0));
}

function editorSampleRate(editor) {
  const rate = Number(editor?.audioBuffer?.sampleRate || editor?.segments?.[0]?.sampleRate || 44100);
  return Number.isFinite(rate) && rate > 0 ? rate : 44100;
}

function editorFrameDuration(editor) {
  return 1 / editorSampleRate(editor);
}

function nativeSegmentSampleRate(segment, fallback = 44100) {
  const rate = Number(segment?.sampleRate || segment?.sample_rate || fallback);
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate) : fallback;
}

function nativeSecondsToFrame(value, sampleRate) {
  return Math.max(0, Math.round((Number(value) || 0) * sampleRate));
}

function nativeFrameToSeconds(value, sampleRate) {
  const rate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
  return Math.max(0, Number(value) || 0) / rate;
}

function nativeSegmentSourceStartFrame(segment) {
  const sampleRate = nativeSegmentSampleRate(segment);
  const frame = Number(segment?.sourceStartFrame);
  return Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : nativeSecondsToFrame(segment?.sourceStart || 0, sampleRate);
}

function nativeSegmentSourceEndFrame(segment) {
  const sampleRate = nativeSegmentSampleRate(segment);
  const frame = Number(segment?.sourceEndFrame);
  if (Number.isFinite(frame)) return Math.max(nativeSegmentSourceStartFrame(segment), Math.round(frame));
  return Math.max(nativeSegmentSourceStartFrame(segment), nativeSecondsToFrame(segment?.sourceEnd || segment?.duration || 0, sampleRate));
}

function nativeSegmentFrameCount(segment) {
  const frameCount = Number(segment?.frameCount);
  if (Number.isFinite(frameCount) && frameCount > 0) return Math.round(frameCount);
  return Math.max(0, nativeSegmentSourceEndFrame(segment) - nativeSegmentSourceStartFrame(segment));
}

function nativeEditorSampleRateFromSegments(segments) {
  const first = Array.isArray(segments) ? segments.find((segment) => nativeSegmentFrameCount(segment) > 0) : null;
  return nativeSegmentSampleRate(first);
}

function nativeEditorFrameCountFromSegments(segments) {
  return (segments || []).reduce((total, segment) => total + nativeSegmentFrameCount(segment), 0);
}

function nativeEditorFrameToTime(frame, editor) {
  return nativeFrameToSeconds(frame, editorSampleRate(editor));
}

function nativeEditorTimeToFrame(value, editor) {
  const sampleRate = editorSampleRate(editor);
  const maxFrame = nativeEditorFrameCountFromSegments(editor?.segments || []);
  return Math.min(Math.max(0, nativeSecondsToFrame(clampEditorTime(value, editor?.duration || nativeFrameToSeconds(maxFrame, sampleRate)), sampleRate)), maxFrame);
}

function snapEditorTimeToFrame(value, editor) {
  const sampleRate = editorSampleRate(editor);
  const duration = Number(editor?.duration) || 0;
  const frame = Math.round(clampEditorTime(value, duration) * sampleRate);
  return clampEditorTime(frame / sampleRate, duration);
}

function editorFrameNumber(value, editor) {
  return Math.round(snapEditorTimeToFrame(value, editor) * editorSampleRate(editor));
}

function formatEditorFrameTime(value, editor) {
  const sampleRate = editorSampleRate(editor);
  const frameNumber = editorFrameNumber(value, editor);
  const wholeSeconds = Math.floor(frameNumber / sampleRate);
  const frameInSecond = Math.max(0, frameNumber - wholeSeconds * sampleRate);
  return `${formatTime(wholeSeconds)}:${String(frameInSecond).padStart(String(Math.floor(sampleRate)).length, '0')}`;
}

function editorWaveTimeToPlaybackTime(value, editor) {
  if (editor?.nativeWaveformOnly && Array.isArray(editor?.segments) && editor.segments.length) {
    const waveFrame = nativeEditorTimeToFrame(value, editor);
    let cursorFrame = 0;
    for (let index = 0; index < editor.segments.length; index += 1) {
      const segment = editor.segments[index];
      const segmentFrameCount = nativeSegmentFrameCount(segment);
      const segmentEndFrame = cursorFrame + segmentFrameCount;
      if (waveFrame < segmentEndFrame || index === editor.segments.length - 1) {
        const sourceFrame = nativeSegmentSourceStartFrame(segment) + Math.max(0, waveFrame - cursorFrame);
        return clampEditorTime(nativeFrameToSeconds(sourceFrame, nativeSegmentSampleRate(segment, editorSampleRate(editor))), editor.playbackDuration || segment.sourceEnd || segment.duration);
      }
      cursorFrame = segmentEndFrame;
    }
  }
  const waveDuration = Number(editor?.duration) || 0;
  const playbackDuration = Number(editor?.playbackDuration) || waveDuration;
  if (waveDuration <= 0 || playbackDuration <= 0) return clampEditorTime(value, waveDuration);
  return clampEditorTime((Number(value) || 0) * playbackDuration / waveDuration, playbackDuration);
}

function editorPlaybackTimeToWaveTime(value, editor) {
  if (editor?.nativeWaveformOnly && Array.isArray(editor?.segments) && editor.segments.length) {
    let cursorFrame = 0;
    for (const segment of editor.segments) {
      const segmentFrameCount = nativeSegmentFrameCount(segment);
      const sampleRate = nativeSegmentSampleRate(segment, editorSampleRate(editor));
      const playbackFrame = nativeSecondsToFrame(value, sampleRate);
      const sourceStartFrame = nativeSegmentSourceStartFrame(segment);
      const sourceEndFrame = nativeSegmentSourceEndFrame(segment);
      if (playbackFrame >= sourceStartFrame && playbackFrame <= sourceEndFrame) {
        return nativeEditorFrameToTime(cursorFrame + Math.min(segmentFrameCount, playbackFrame - sourceStartFrame), editor);
      }
      if (playbackFrame < sourceStartFrame) return nativeEditorFrameToTime(cursorFrame, editor);
      cursorFrame += segmentFrameCount;
    }
    return nativeEditorFrameToTime(cursorFrame, editor);
  }
  const waveDuration = Number(editor?.duration) || 0;
  const playbackDuration = Number(editor?.playbackDuration) || waveDuration;
  if (waveDuration <= 0 || playbackDuration <= 0) return clampEditorTime(value, waveDuration);
  return snapEditorTimeToFrame((Number(value) || 0) * waveDuration / playbackDuration, editor);
}

function createNativeEditorSegment(sourcePath, waveform) {
  const duration = Number(waveform?.duration) || 0;
  const sampleRate = Number(waveform?.sample_rate || waveform?.sampleRate) || 44100;
  const frameCount = nativeSecondsToFrame(duration, sampleRate);
  return {
    sourcePath,
    sourceStart: 0,
    sourceEnd: duration,
    duration,
    sourceStartFrame: 0,
    sourceEndFrame: frameCount,
    frameCount,
    sampleRate,
    channels: Number(waveform?.channels) || 1,
    wavePeaks: {
      mins: Array.isArray(waveform?.mins) ? waveform.mins : [],
      maxs: Array.isArray(waveform?.maxs) ? waveform.maxs : [],
      pointCount: Number(waveform?.point_count || waveform?.pointCount) || 0
    }
  };
}

function createEmptyNativeEditorSegment(sourcePath, durationSeconds) {
  const pointCount = NATIVE_WAVEFORM_PREVIEW_POINTS;
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const sampleRate = 44100;
  const frameCount = nativeSecondsToFrame(duration, sampleRate);
  return {
    sourcePath,
    sourceStart: 0,
    sourceEnd: duration,
    duration,
    sourceStartFrame: 0,
    sourceEndFrame: frameCount,
    frameCount,
    sampleRate,
    channels: 1,
    wavePeaks: {
      mins: new Array(pointCount).fill(0),
      maxs: new Array(pointCount).fill(0),
      pointCount
    }
  };
}

function nativeEditorDurationFromSegments(segments) {
  const sampleRate = nativeEditorSampleRateFromSegments(segments);
  return nativeFrameToSeconds(nativeEditorFrameCountFromSegments(segments), sampleRate);
}

function nativeEditorSegmentAtWaveTime(editor, value) {
  const segments = Array.isArray(editor?.segments) ? editor.segments : [];
  const waveFrame = nativeEditorTimeToFrame(value, { ...editor, segments });
  let cursorFrame = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentEndFrame = cursorFrame + segmentFrameCount;
    if (waveFrame < segmentEndFrame || index === segments.length - 1) {
      return {
        segment,
        index,
        start: nativeEditorFrameToTime(cursorFrame, { ...editor, segments }),
        end: nativeEditorFrameToTime(segmentEndFrame, { ...editor, segments }),
        startFrame: cursorFrame,
        endFrame: segmentEndFrame
      };
    }
    cursorFrame = segmentEndFrame;
  }
  return null;
}

function nativeEditorSegmentByIndex(editor, targetIndex) {
  const segments = Array.isArray(editor?.segments) ? editor.segments : [];
  const index = Number(targetIndex);
  if (!Number.isInteger(index) || index < 0 || index >= segments.length) return null;
  let cursorFrame = 0;
  for (let itemIndex = 0; itemIndex < segments.length; itemIndex += 1) {
    const segment = segments[itemIndex];
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentEndFrame = cursorFrame + segmentFrameCount;
    if (itemIndex === index) {
      return {
        segment,
        index: itemIndex,
        start: nativeEditorFrameToTime(cursorFrame, { ...editor, segments }),
        end: nativeEditorFrameToTime(segmentEndFrame, { ...editor, segments }),
        startFrame: cursorFrame,
        endFrame: segmentEndFrame
      };
    }
    cursorFrame = segmentEndFrame;
  }
  return null;
}

function cloneNativeEditorSegment(segment) {
  const peaks = segment?.wavePeaks || {};
  return {
    ...segment,
    wavePeaks: {
      mins: Array.isArray(peaks.mins) ? [...peaks.mins] : [],
      maxs: Array.isArray(peaks.maxs) ? [...peaks.maxs] : [],
      pointCount: Number(peaks.pointCount) || Math.min(peaks.mins?.length || 0, peaks.maxs?.length || 0)
    }
  };
}

function nativeEditorHistoryEntry(editor) {
  const segments = Array.isArray(editor?.segments) ? editor.segments.map(cloneNativeEditorSegment) : [];
  return {
    native: true,
    segments,
    duration: nativeEditorDurationFromSegments(segments),
    currentTime: clampEditorTime(editor?.currentTime || 0, nativeEditorDurationFromSegments(segments)),
    visibleStart: Math.max(0, Number(editor?.visibleStart) || 0),
    playbackDuration: Number(editor?.playbackDuration) || Number(editor?.duration) || 0
  };
}

function editorWithNativeHistory(current, nextState) {
  const keptHistory = (Array.isArray(current.history) ? current.history : []).slice(0, Math.max(0, current.historyIndex) + 1);
  const nextHistory = [...keptHistory, nativeEditorHistoryEntry(nextState)];
  const overflow = Math.max(0, nextHistory.length - AUDIO_EDITOR_HISTORY_LIMIT);
  const limitedHistory = overflow ? nextHistory.slice(overflow) : nextHistory;
  return {
    ...nextState,
    history: limitedHistory,
    historyIndex: limitedHistory.length - 1
  };
}

function copyNativeEditorSelection(editor, startSeconds, endSeconds) {
  const segments = Array.isArray(editor?.segments) ? editor.segments : [];
  const startFrame = nativeEditorTimeToFrame(Math.min(startSeconds, endSeconds), editor);
  const endFrame = nativeEditorTimeToFrame(Math.max(startSeconds, endSeconds), editor);
  let cursorFrame = 0;
  const copiedSegments = [];

  segments.forEach((segment) => {
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentStartFrame = cursorFrame;
    const segmentEndFrame = cursorFrame + segmentFrameCount;
    const copyStartFrame = Math.max(startFrame, segmentStartFrame);
    const copyEndFrame = Math.min(endFrame, segmentEndFrame);
    if (copyEndFrame > copyStartFrame) {
      const piece = sliceNativeEditorSegmentByFrames(segment, copyStartFrame - segmentStartFrame, copyEndFrame - segmentStartFrame);
      if (piece) copiedSegments.push(piece);
    }
    cursorFrame = segmentEndFrame;
  });

  return {
    native: true,
    segments: copiedSegments.map(cloneNativeEditorSegment),
    duration: nativeEditorDurationFromSegments(copiedSegments)
  };
}

function pasteNativeEditorSelection(editor, clipboard, startSeconds, endSeconds) {
  const segments = Array.isArray(editor?.segments) ? editor.segments : [];
  const startFrame = nativeEditorTimeToFrame(Math.min(startSeconds, endSeconds), editor);
  const endFrame = nativeEditorTimeToFrame(Math.max(startSeconds, endSeconds), editor);
  let cursorFrame = 0;
  const nextSegments = [];
  let inserted = false;
  const clipboardSegments = (clipboard?.segments || []).map(cloneNativeEditorSegment);

  const insertClipboard = () => {
    if (inserted) return;
    clipboardSegments.forEach((item) => nextSegments.push(item));
    inserted = true;
  };

  segments.forEach((segment) => {
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentStartFrame = cursorFrame;
    const segmentEndFrame = cursorFrame + segmentFrameCount;

    if (!inserted && startFrame <= segmentStartFrame) {
      insertClipboard();
    }

    if (segmentEndFrame <= startFrame || segmentStartFrame >= endFrame) {
      nextSegments.push(cloneNativeEditorSegment(segment));
    } else {
      const left = sliceNativeEditorSegmentByFrames(segment, 0, Math.max(0, startFrame - segmentStartFrame));
      const right = sliceNativeEditorSegmentByFrames(segment, Math.max(0, endFrame - segmentStartFrame), segmentFrameCount);
      if (left) nextSegments.push(left);
      if (segmentStartFrame <= startFrame && startFrame <= segmentEndFrame) {
        insertClipboard();
      }
      if (right) nextSegments.push(right);
    }
    cursorFrame = segmentEndFrame;
  });

  if (!inserted) insertClipboard();

  const nextDuration = nativeEditorDurationFromSegments(nextSegments);
  const sampleRate = editorSampleRate({ ...editor, segments: nextSegments });
  const pastedFrameCount = nativeEditorFrameCountFromSegments(clipboardSegments);
  const pastedStartFrame = Math.min(startFrame, nativeEditorFrameCountFromSegments(nextSegments));
  const pastedEndFrame = Math.min(pastedStartFrame + pastedFrameCount, nativeEditorFrameCountFromSegments(nextSegments));
  const pastedStart = nativeFrameToSeconds(pastedStartFrame, sampleRate);
  const pastedEnd = nativeFrameToSeconds(pastedEndFrame, sampleRate);
  const pastedRange = pastedEnd > pastedStart
    ? [{ start: pastedStart, end: pastedEnd }]
    : [];
  return {
    ...editor,
    segments: nextSegments,
    duration: nextDuration,
    selectionStart: pastedRange[0]?.start || 0,
    selectionEnd: pastedRange[0]?.end || 0,
    selectionRanges: pastedRange,
    activeSelectionIndex: pastedRange.length ? 0 : -1,
    currentTime: pastedStart,
    playbackMarkerTime: pastedStart,
    playbackSegmentIndex: null,
    visibleStart: clampEditorVisibleStart(editor.visibleStart, nextDuration, editorVisibleRange({ ...editor, duration: nextDuration }).duration),
    previewMode: 'full',
    editorPlaying: false,
    error: ''
  };
}

function sliceNativeEditorSegmentByFrames(segment, startFrameValue, endFrameValue) {
  const sampleRate = nativeSegmentSampleRate(segment);
  const frameCount = nativeSegmentFrameCount(segment);
  const startFrame = Math.min(Math.max(0, Math.round(Number(startFrameValue) || 0)), frameCount);
  const endFrame = Math.min(Math.max(startFrame, Math.round(Number(endFrameValue) || 0)), frameCount);
  const nextFrameCount = Math.max(0, endFrame - startFrame);
  if (nextFrameCount <= 0) return null;

  const peaks = segment?.wavePeaks || {};
  const mins = Array.isArray(peaks.mins) ? peaks.mins : [];
  const maxs = Array.isArray(peaks.maxs) ? peaks.maxs : [];
  const pointCount = Math.min(mins.length, maxs.length);
  const startPoint = pointCount && frameCount > 0 ? Math.max(0, Math.min(pointCount - 1, Math.floor((startFrame / frameCount) * pointCount))) : 0;
  const endPoint = pointCount && frameCount > 0 ? Math.max(startPoint + 1, Math.min(pointCount, Math.ceil((endFrame / frameCount) * pointCount))) : 0;
  const sourceStartFrame = nativeSegmentSourceStartFrame(segment) + startFrame;
  const sourceEndFrame = sourceStartFrame + nextFrameCount;

  return {
    ...segment,
    sourceStartFrame,
    sourceEndFrame,
    frameCount: nextFrameCount,
    sourceStart: nativeFrameToSeconds(sourceStartFrame, sampleRate),
    sourceEnd: nativeFrameToSeconds(sourceEndFrame, sampleRate),
    duration: nativeFrameToSeconds(nextFrameCount, sampleRate),
    wavePeaks: {
      mins: pointCount ? mins.slice(startPoint, endPoint) : [],
      maxs: pointCount ? maxs.slice(startPoint, endPoint) : [],
      pointCount: pointCount ? Math.max(1, endPoint - startPoint) : 0
    }
  };
}

function sliceNativeEditorSegment(segment, startSeconds, endSeconds) {
  const sampleRate = nativeSegmentSampleRate(segment);
  return sliceNativeEditorSegmentByFrames(
    segment,
    nativeSecondsToFrame(startSeconds, sampleRate),
    nativeSecondsToFrame(endSeconds, sampleRate)
  );
}

function deleteNativeEditorSelection(editor, startSeconds, endSeconds) {
  const segments = Array.isArray(editor?.segments) ? editor.segments : [];
  const startFrame = nativeEditorTimeToFrame(Math.min(startSeconds, endSeconds), editor);
  const endFrame = nativeEditorTimeToFrame(Math.max(startSeconds, endSeconds), editor);
  let cursorFrame = 0;
  const nextSegments = [];

  segments.forEach((segment) => {
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentStartFrame = cursorFrame;
    const segmentEndFrame = cursorFrame + segmentFrameCount;
    const cutStartFrame = Math.max(startFrame, segmentStartFrame);
    const cutEndFrame = Math.min(endFrame, segmentEndFrame);

    if (cutEndFrame <= segmentStartFrame || cutStartFrame >= segmentEndFrame) {
      nextSegments.push(cloneNativeEditorSegment(segment));
    } else {
      const left = sliceNativeEditorSegmentByFrames(segment, 0, cutStartFrame - segmentStartFrame);
      const right = sliceNativeEditorSegmentByFrames(segment, cutEndFrame - segmentStartFrame, segmentFrameCount);
      if (left) nextSegments.push(left);
      if (right) nextSegments.push(right);
    }
    cursorFrame = segmentEndFrame;
  });

  const nextDuration = nativeEditorDurationFromSegments(nextSegments);
  const sampleRate = editorSampleRate({ ...editor, segments: nextSegments });
  const nextCurrentTime = nativeFrameToSeconds(Math.min(startFrame, nativeEditorFrameCountFromSegments(nextSegments)), sampleRate);
  return {
    ...editor,
    segments: nextSegments,
    duration: nextDuration,
    selectionStart: 0,
    selectionEnd: 0,
    selectionRanges: [],
    activeSelectionIndex: -1,
    currentTime: nextCurrentTime,
    playbackSegmentIndex: null,
    visibleStart: clampEditorVisibleStart(editor.visibleStart, nextDuration, editorVisibleRange({ ...editor, duration: nextDuration }).duration),
    previewMode: 'full',
    error: ''
  };
}

function deleteNativeEditorRanges(editor, ranges) {
  const normalizedRanges = mergeEditorRanges(ranges, editor, 0)
    .sort((a, b) => b.start - a.start);
  if (!normalizedRanges.length) return editor;
  return normalizedRanges.reduce((nextEditor, range) => (
    deleteNativeEditorSelection(nextEditor, range.start, range.end)
  ), editor);
}

function detectNativeSilentRanges(editor, minSeconds, threshold = silenceThresholdFromSensitivity(DEFAULT_SILENCE_SENSITIVITY)) {
  const ranges = [];
  const sourceSegments = Array.isArray(editor?.segments) ? editor.segments : [];
  const timelineSampleRate = editorSampleRate(editor);
  let cursorFrame = 0;
  let silentStart = null;
  let lastSilentEnd = 0;

  const closeSilentRange = () => {
    if (silentStart === null) return;
    if (lastSilentEnd - silentStart >= minSeconds) {
      ranges.push({ start: silentStart, end: lastSilentEnd });
    }
    silentStart = null;
    lastSilentEnd = 0;
  };

  sourceSegments.forEach((segment) => {
    const segmentFrameCount = nativeSegmentFrameCount(segment);
    const segmentStart = nativeFrameToSeconds(cursorFrame, timelineSampleRate);
    const segmentDuration = nativeFrameToSeconds(segmentFrameCount, nativeSegmentSampleRate(segment, timelineSampleRate));
    const peaks = segment?.wavePeaks || {};
    const pointCount = Math.min(peaks.mins?.length || 0, peaks.maxs?.length || 0);
    if (!pointCount || segmentDuration <= 0) {
      closeSilentRange();
      cursorFrame += segmentFrameCount;
      return;
    }

    for (let index = 0; index < pointCount; index += 1) {
      const min = Number(peaks.mins[index]) || 0;
      const max = Number(peaks.maxs[index]) || 0;
      const amplitude = Math.max(Math.abs(min), Math.abs(max));
      const start = segmentStart + (index / pointCount) * segmentDuration;
      const end = segmentStart + ((index + 1) / pointCount) * segmentDuration;
      if (amplitude <= threshold) {
        if (silentStart === null) silentStart = start;
        lastSilentEnd = end;
      } else {
        closeSilentRange();
      }
    }
    cursorFrame += segmentFrameCount;
  });
  closeSilentRange();
  return mergeEditorRanges(ranges, editor, 0.2)
    .filter((range) => range.end - range.start >= minSeconds);
}

function combineNativeSegmentPeaks(segments) {
  const sourceSegments = Array.isArray(segments) ? segments : [];
  if (!sourceSegments.length) return null;
  const mins = [];
  const maxs = [];
  sourceSegments.forEach((segment) => {
    const peaks = segment?.wavePeaks || {};
    const segmentMins = Array.isArray(peaks.mins) ? peaks.mins : [];
    const segmentMaxs = Array.isArray(peaks.maxs) ? peaks.maxs : [];
    const count = Math.min(segmentMins.length, segmentMaxs.length);
    for (let index = 0; index < count; index += 1) {
      mins.push(segmentMins[index]);
      maxs.push(segmentMaxs[index]);
    }
  });
  return mins.length ? { mins, maxs, pointCount: mins.length } : null;
}

function nativeWaveformPointsForZoom(zoom) {
  void zoom;
  return NATIVE_WAVEFORM_PREVIEW_POINTS;
}

function editorVisibleDurationForZoom(duration, zoom, sampleRate = 44100) {
  const fullDuration = Math.max(1, Number(duration) || 1);
  const safeZoom = Math.max(0, Math.min(100, Number(zoom) || 0));
  const safeSampleRate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
  const minDuration = Math.min(fullDuration, 1 / safeSampleRate);
  if (safeZoom <= 0) return fullDuration;
  const ratio = safeZoom / 100;
  return Math.max(minDuration, fullDuration * Math.pow(minDuration / fullDuration, ratio));
}

function editorVisibleRange(editor) {
  const duration = Math.max(0, Number(editor?.duration) || 0);
  const visibleDuration = Math.min(duration || 1, editorVisibleDurationForZoom(duration || 1, editor?.zoom || 0, editorSampleRate(editor)));
  const maxStart = Math.max(0, duration - visibleDuration);
  const start = Math.min(Math.max(0, Number(editor?.visibleStart) || 0), maxStart);
  return {
    start,
    end: Math.min(duration, start + visibleDuration),
    duration: visibleDuration
  };
}

function clampEditorVisibleStart(start, duration, visibleDuration) {
  return Math.min(Math.max(0, Number(start) || 0), Math.max(0, (Number(duration) || 0) - (Number(visibleDuration) || 0)));
}

function pointerRatioInElement(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
}

function editorTimeToVisibleRatio(time, visible) {
  if (!visible?.duration) return 0;
  return Math.min(Math.max((Number(time) - visible.start) / visible.duration, 0), 1);
}

function editorVisibleRatioToTime(ratio, visible, editor) {
  if (!visible?.duration) return 0;
  return snapEditorTimeToFrame(visible.start + Math.min(Math.max(Number(ratio) || 0, 0), 1) * visible.duration, editor);
}

function editorOverviewRatioToTime(ratio, editor) {
  const duration = Math.max(0, Number(editor?.duration) || 0);
  return snapEditorTimeToFrame(Math.min(Math.max(Number(ratio) || 0, 0), 1) * duration, editor);
}

function makeEditorSelectionRange(start, end, editor) {
  const frameStep = editorFrameDuration(editor);
  const selectionStart = snapEditorTimeToFrame(Math.min(start, end), editor);
  const selectionEnd = snapEditorTimeToFrame(Math.max(start, end), editor);
  if (selectionEnd - selectionStart < frameStep) return null;
  return { start: selectionStart, end: selectionEnd };
}

function editorSelectionRanges(editor) {
  const ranges = Array.isArray(editor?.selectionRanges) ? editor.selectionRanges : [];
  return ranges
    .map((range) => {
      const normalizedRange = makeEditorSelectionRange(range.start, range.end, editor);
      return normalizedRange ? { ...normalizedRange, locked: Boolean(range.locked) } : null;
    })
    .filter(Boolean);
}

function editorActiveSelectionRange(editor) {
  const ranges = editorSelectionRanges(editor);
  if (ranges.length) {
    const index = Math.min(Math.max(Number(editor?.activeSelectionIndex) || 0, 0), ranges.length - 1);
    return { ...ranges[index], index };
  }
  const fallback = makeEditorSelectionRange(editor?.selectionStart || 0, editor?.selectionEnd || 0, editor);
  return fallback ? { ...fallback, index: -1 } : null;
}

function editorPasteAnchorTime(editor) {
  const markerTime = Number(editor?.playbackMarkerTime);
  if (Number.isFinite(markerTime)) return snapEditorTimeToFrame(markerTime, editor);
  const currentTime = Number(editor?.currentTime);
  if (Number.isFinite(currentTime)) return snapEditorTimeToFrame(currentTime, editor);
  const active = editorActiveSelectionRange(editor);
  return snapEditorTimeToFrame(active?.start || 0, editor);
}

function editorWithActiveSelection(editor, range, index = null) {
  const nextRange = makeEditorSelectionRange(range?.start || 0, range?.end || 0, editor);
  if (!nextRange) return editor;
  const ranges = editorSelectionRanges(editor);
  let nextIndex = index;
  let nextRanges = ranges;
  if (nextIndex === null || nextIndex < 0 || nextIndex >= nextRanges.length) {
    nextRanges = [...nextRanges, nextRange];
    nextIndex = nextRanges.length - 1;
  } else {
    nextRanges = nextRanges.map((item, itemIndex) => (
      itemIndex === nextIndex ? { ...nextRange, locked: Boolean(item.locked) } : item
    ));
  }
  return {
    ...editor,
    selectionRanges: nextRanges,
    activeSelectionIndex: nextIndex,
    selectionStart: nextRange.start,
    selectionEnd: nextRange.end
  };
}

function editorWithoutSelection(editor, index) {
  const ranges = editorSelectionRanges(editor);
  if (index < 0 || index >= ranges.length) return editor;
  const nextRanges = ranges.filter((_, itemIndex) => itemIndex !== index);
  const nextIndex = Math.min(Math.max(0, index - 1), nextRanges.length - 1);
  const activeRange = nextRanges[nextIndex] || null;
  return {
    ...editor,
    selectionRanges: nextRanges,
    activeSelectionIndex: activeRange ? nextIndex : -1,
    selectionStart: activeRange?.start || 0,
    selectionEnd: activeRange?.end || 0,
    hoverSelectionIndex: null,
    hoverSelectionDeleteIndex: null,
    hoverSelectionEdge: null,
    dragSelectionEdge: null
  };
}

function editorWithoutUnlockedSelections(editor) {
  const lockedRanges = editorSelectionRanges(editor).filter((range) => range.locked);
  if (!lockedRanges.length) {
    return {
      ...editor,
      selectionStart: 0,
      selectionEnd: 0,
      selectionRanges: [],
      activeSelectionIndex: -1
    };
  }
  return editorWithSelectionRanges(editor, lockedRanges, 0);
}

function normalizeSilenceCutSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_SILENCE_CUT_SECONDS;
  return Math.min(MAX_SILENCE_CUT_SECONDS, Math.max(MIN_SILENCE_CUT_SECONDS, Math.round(seconds)));
}

function normalizeSilenceSensitivity(value) {
  const sensitivity = Number(value);
  if (!Number.isFinite(sensitivity)) return DEFAULT_SILENCE_SENSITIVITY;
  return Math.min(MAX_SILENCE_SENSITIVITY, Math.max(MIN_SILENCE_SENSITIVITY, Math.round(sensitivity)));
}

function normalizeSilenceReserveSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_SILENCE_RESERVE_SECONDS;
  return Math.min(MAX_SILENCE_RESERVE_SECONDS, Math.max(MIN_SILENCE_RESERVE_SECONDS, Math.round(seconds * 10) / 10));
}

function silenceThresholdFromSensitivity(value) {
  const sensitivity = normalizeSilenceSensitivity(value);
  return 0.002 + (sensitivity / 100) * 0.028;
}

function loadSilenceCutSeconds() {
  return normalizeSilenceCutSeconds(localStorage.getItem(EDITOR_SILENCE_SETTING_KEYS.seconds));
}

function loadSilenceSensitivity() {
  return normalizeSilenceSensitivity(localStorage.getItem(EDITOR_SILENCE_SETTING_KEYS.sensitivity));
}

function loadSilenceReserveSeconds() {
  return normalizeSilenceReserveSeconds(localStorage.getItem(EDITOR_SILENCE_SETTING_KEYS.reserve));
}

function mergeEditorRanges(ranges, editor, gapSeconds = 0.12) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .map((range) => {
      const normalizedRange = makeEditorSelectionRange(range.start, range.end, editor);
      return normalizedRange ? { ...normalizedRange, locked: Boolean(range.locked) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];

  const merged = [sorted[0]];
  sorted.slice(1).forEach((range) => {
    const last = merged[merged.length - 1];
    if (range.start <= last.end + gapSeconds) {
      last.end = Math.max(last.end, range.end);
      last.locked = Boolean(last.locked || range.locked);
      return;
    }
    merged.push({ ...range });
  });
  return merged;
}

function editorWithSelectionRanges(editor, ranges, activeIndex = 0) {
  const nextRanges = mergeEditorRanges(ranges, editor, 0).filter((range) => range.end > range.start);
  const nextIndex = nextRanges.length ? Math.min(Math.max(activeIndex, 0), nextRanges.length - 1) : -1;
  const activeRange = nextRanges[nextIndex] || null;
  return {
    ...editor,
    selectionRanges: nextRanges,
    activeSelectionIndex: nextIndex,
    selectionStart: activeRange?.start || 0,
    selectionEnd: activeRange?.end || 0,
    hoverSelectionIndex: null,
    hoverSelectionDeleteIndex: null,
    hoverSelectionEdge: null,
    dragSelectionEdge: null
  };
}

function lockedEditorSelectionRangesForDuration(editor, duration) {
  const targetEditor = { ...editor, duration };
  return editorSelectionRanges(editor)
    .filter((range) => range.locked)
    .map((range) => {
      const normalizedRange = makeEditorSelectionRange(
        clampEditorTime(range.start, duration),
        clampEditorTime(range.end, duration),
        targetEditor
      );
      return normalizedRange ? { ...normalizedRange, locked: true } : null;
    })
    .filter(Boolean);
}

function applySilenceReserveToRanges(ranges, reserveSeconds, editor) {
  const reserve = normalizeSilenceReserveSeconds(reserveSeconds);
  const frameStep = editorFrameDuration(editor);
  return (Array.isArray(ranges) ? ranges : [])
    .map((range) => makeEditorSelectionRange(
      (Number(range?.start) || 0) + reserve,
      Math.max((Number(range?.start) || 0) + reserve, (Number(range?.end) || 0) - reserve),
      editor
    ))
    .filter((range) => range && range.end - range.start >= frameStep);
}

function nativeWaveformLevelsByPoint(levels) {
  return (levels || []).reduce((map, level) => {
    const pointCount = Number(level?.point_count || level?.pointCount);
    if (pointCount > 0) map[pointCount] = level;
    return map;
  }, {});
}

function selectNativeWaveformLevel(levelsByPoint, targetPoints) {
  const points = Object.keys(levelsByPoint || {}).map(Number).filter(Boolean).sort((a, b) => a - b);
  if (!points.length) return null;
  return levelsByPoint[points.find((point) => point >= targetPoints) || points[points.length - 1]];
}

function floatSamplesToInt16(floatSamples) {
  const samples = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    samples[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return samples;
}

function audioBufferFrameFromTime(audioBuffer, value) {
  const sampleRate = audioBuffer.sampleRate;
  return Math.min(audioBuffer.length, Math.max(0, Math.round(clampEditorTime(value, audioBuffer.duration) * sampleRate)));
}

function audioBufferTimeFromFrame(audioBuffer, frame) {
  return Math.min(audioBuffer.duration, Math.max(0, Math.round(Number(frame) || 0) / audioBuffer.sampleRate));
}

function normalizeAudioBufferFrameRange(audioBuffer, startFrame, endFrame, minFrames = 1) {
  const start = Math.min(audioBuffer.length, Math.max(0, Math.round(Number(startFrame) || 0)));
  const end = Math.min(audioBuffer.length, Math.max(start + minFrames, Math.round(Number(endFrame) || 0)));
  return {
    start,
    end: Math.min(audioBuffer.length, end)
  };
}

function audioBufferSelectionToMonoByFrames(audioBuffer, startFrame, endFrame) {
  const range = normalizeAudioBufferFrameRange(audioBuffer, startFrame, endFrame);
  const sampleCount = Math.max(1, range.end - range.start);
  const output = new Float32Array(Math.max(1, sampleCount));
  const channels = Math.max(1, audioBuffer.numberOfChannels);

  for (let channel = 0; channel < channels; channel += 1) {
    const source = audioBuffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) {
      output[index] += source[range.start + index] / channels;
    }
  }

  return output;
}

function audioBufferSelectionToMono(audioBuffer, startSeconds, endSeconds) {
  return audioBufferSelectionToMonoByFrames(
    audioBuffer,
    audioBufferFrameFromTime(audioBuffer, startSeconds),
    audioBufferFrameFromTime(audioBuffer, endSeconds)
  );
}

function encodeMp3BlobFromSamples(floatSamples, sampleRate, bitrate) {
  if (!window.lamejs?.Mp3Encoder) throw new Error('MP3 编码器未加载');
  const encoder = new window.lamejs.Mp3Encoder(1, sampleRate, bitrate);
  const intSamples = floatSamplesToInt16(floatSamples);
  const chunks = [];
  const frameSize = 1152;

  for (let offset = 0; offset < intSamples.length; offset += frameSize) {
    const buffer = encoder.encodeBuffer(intSamples.subarray(offset, offset + frameSize));
    if (buffer.length > 0) chunks.push(new Int8Array(buffer));
  }

  const finalBuffer = encoder.flush();
  if (finalBuffer.length > 0) chunks.push(new Int8Array(finalBuffer));
  return new Blob(chunks, { type: 'audio/mp3' });
}

async function createAudioBufferFromChannels(channelData, sampleRate) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const channelCount = Math.max(1, channelData.length);
  const sampleCount = Math.max(1, channelData[0]?.length || 1);
  const audioBuffer = context.createBuffer(channelCount, sampleCount, sampleRate);
  channelData.forEach((data, channelIndex) => {
    audioBuffer.copyToChannel(data, channelIndex);
  });
  await context.close?.();
  return audioBuffer;
}

async function trimAudioBufferSelectionByFrames(audioBuffer, startFrame, endFrame) {
  const range = normalizeAudioBufferFrameRange(audioBuffer, startFrame, endFrame);
  const channels = [];

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel).slice(range.start, range.end));
  }

  return createAudioBufferFromChannels(channels, audioBuffer.sampleRate);
}

async function trimAudioBufferSelection(audioBuffer, startSeconds, endSeconds) {
  return trimAudioBufferSelectionByFrames(
    audioBuffer,
    audioBufferFrameFromTime(audioBuffer, startSeconds),
    audioBufferFrameFromTime(audioBuffer, endSeconds)
  );
}

async function deleteAudioBufferSelectionByFrames(audioBuffer, startFrame, endFrame) {
  const range = normalizeAudioBufferFrameRange(audioBuffer, startFrame, endFrame);
  const nextLength = audioBuffer.length - (range.end - range.start);
  if (nextLength < Math.floor(audioBuffer.sampleRate * 0.05)) {
    throw new Error('删除后音频太短');
  }

  const channels = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel);
    const next = new Float32Array(nextLength);
    next.set(source.slice(0, range.start), 0);
    next.set(source.slice(range.end), range.start);
    channels.push(next);
  }

  return createAudioBufferFromChannels(channels, audioBuffer.sampleRate);
}

async function deleteAudioBufferRangesByFrames(audioBuffer, frameRanges) {
  const ranges = (Array.isArray(frameRanges) ? frameRanges : [])
    .map((range) => normalizeAudioBufferFrameRange(audioBuffer, range.start, range.end))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return audioBuffer;

  const merged = [];
  ranges.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      return;
    }
    merged.push({ ...range });
  });

  const deletedLength = merged.reduce((total, range) => total + range.end - range.start, 0);
  const nextLength = audioBuffer.length - deletedLength;
  if (nextLength < Math.floor(audioBuffer.sampleRate * 0.05)) {
    throw new Error('删除后音频太短');
  }

  const channels = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel);
    const next = new Float32Array(nextLength);
    let sourceCursor = 0;
    let targetCursor = 0;
    merged.forEach((range) => {
      if (range.start > sourceCursor) {
        const kept = source.subarray(sourceCursor, range.start);
        next.set(kept, targetCursor);
        targetCursor += kept.length;
      }
      sourceCursor = Math.max(sourceCursor, range.end);
    });
    if (sourceCursor < source.length) {
      next.set(source.subarray(sourceCursor), targetCursor);
    }
    channels.push(next);
  }

  return createAudioBufferFromChannels(channels, audioBuffer.sampleRate);
}

async function deleteAudioBufferSelection(audioBuffer, startSeconds, endSeconds) {
  return deleteAudioBufferSelectionByFrames(
    audioBuffer,
    audioBufferFrameFromTime(audioBuffer, startSeconds),
    audioBufferFrameFromTime(audioBuffer, endSeconds)
  );
}

async function pasteAudioBufferSelectionByFrames(audioBuffer, insertBuffer, startFrame, endFrame) {
  const range = normalizeAudioBufferFrameRange(audioBuffer, startFrame, endFrame, 0);
  const insertLength = Math.max(1, insertBuffer.length);
  const nextLength = audioBuffer.length - (range.end - range.start) + insertLength;
  const channelCount = Math.max(audioBuffer.numberOfChannels, insertBuffer.numberOfChannels);
  const channels = [];

  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1));
    const insertSource = insertBuffer.getChannelData(Math.min(channel, insertBuffer.numberOfChannels - 1));
    const next = new Float32Array(nextLength);
    next.set(source.slice(0, range.start), 0);
    next.set(insertSource.slice(0, insertLength), range.start);
    next.set(source.slice(range.end), range.start + insertLength);
    channels.push(next);
  }

  return createAudioBufferFromChannels(channels, audioBuffer.sampleRate);
}

async function pasteAudioBufferSelection(audioBuffer, insertBuffer, startSeconds, endSeconds) {
  return pasteAudioBufferSelectionByFrames(
    audioBuffer,
    insertBuffer,
    audioBufferFrameFromTime(audioBuffer, startSeconds),
    audioBufferFrameFromTime(audioBuffer, endSeconds)
  );
}

function detectAudioBufferSilentRanges(audioBuffer, minSeconds, editor, threshold = silenceThresholdFromSensitivity(DEFAULT_SILENCE_SENSITIVITY)) {
  if (!audioBuffer?.length || !audioBuffer?.sampleRate) return [];
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.max(512, Math.round(sampleRate * 0.05));
  const channelData = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channelData.push(audioBuffer.getChannelData(channel));
  }

  const ranges = [];
  let silentStartFrame = null;
  let lastSilentEndFrame = 0;
  const closeSilentRange = () => {
    if (silentStartFrame === null) return;
    const start = silentStartFrame / sampleRate;
    const end = lastSilentEndFrame / sampleRate;
    if (end - start >= minSeconds) ranges.push({ start, end });
    silentStartFrame = null;
    lastSilentEndFrame = 0;
  };

  for (let frame = 0; frame < audioBuffer.length; frame += windowSize) {
    const endFrame = Math.min(audioBuffer.length, frame + windowSize);
    let peak = 0;
    for (let channel = 0; channel < channelData.length; channel += 1) {
      const data = channelData[channel];
      for (let index = frame; index < endFrame; index += 1) {
        const amplitude = Math.abs(data[index] || 0);
        if (amplitude > peak) peak = amplitude;
        if (peak > threshold) break;
      }
      if (peak > threshold) break;
    }
    if (peak <= threshold) {
      if (silentStartFrame === null) silentStartFrame = frame;
      lastSilentEndFrame = endFrame;
    } else {
      closeSilentRange();
    }
  }
  closeSilentRange();
  return mergeEditorRanges(ranges, editor, 0.2)
    .filter((range) => range.end - range.start >= minSeconds);
}

// Windows 文件名禁用字符统一过滤，避免保存文件时报错。
function sanitizePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textBaseWithoutAutoNumber(value, fallback) {
  const cleaned = sanitizePart(value).replace(/\d+$/g, '');
  return cleaned || fallback;
}

function loadTextPreference(key, type) {
  const saved = localStorage.getItem(key);
  if (!saved || LEGACY_TEXT_DEFAULTS[type]?.includes(saved)) return TEXT_DEFAULTS[type];
  return saved;
}

function normalizeMicrophoneSlots(value) {
  if (Array.isArray(value)) {
    return DEFAULT_MICROPHONE_SLOTS.map((fallback, index) => String(value[index] ?? fallback));
  }
  return [...DEFAULT_MICROPHONE_SLOTS];
}

function loadMicrophoneSlots(storageKey = STORAGE_KEYS.microphoneSlots) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return normalizeMicrophoneSlots(parsed);
  } catch {
    // 麦克风槽位配置损坏时回到默认：0 号系统默认，1-8 留空。
  }
  return [...DEFAULT_MICROPHONE_SLOTS];
}

function normalizeMicrophoneSlot(value) {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 0 && slot <= 8 ? slot : 0;
}

function normalizeTimeCopyStyle(value) {
  return TIME_COPY_OPTIONS.some((option) => option.value === value) ? value : 'plain';
}

// WebView2 兼容绘制圆角柱形，避免依赖 canvas.roundRect。
function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

// Tauri command 传参使用 base64，避免 Blob 直接跨边界传输。
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// 浏览器预览页没有 Tauri 元数据，调用窗口 API 前必须判断运行环境。
function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

async function resizeDesktopWindow(layoutMode, scalePercent = DEFAULT_WINDOW_SCALE) {
  if (!isTauriRuntime()) return;
  try {
    const scale = normalizeWindowScale(scalePercent);
    const size = scaledWindowSize(layoutMode, scale);
    const appWindow = getCurrentWindow();
    await getCurrentWebview().setZoom(scale / 100);
    await appWindow.setMinSize(size);
    await appWindow.setSize(size);
  } catch (error) {
    console.warn('调整 Tauri 窗口尺寸失败:', error);
  }
}

async function runWindowAction(action) {
  if (!isTauriRuntime()) return;
  try {
    const appWindow = getCurrentWindow();
    if (action === 'close') await invoke('close_main_window');
    if (action === 'minimize') await appWindow.minimize();
    if (action === 'toggleMaximize') await appWindow.toggleMaximize();
  } catch (error) {
    console.warn('执行窗口操作失败:', error);
  }
}

function PresetMenuWindow() {
  const [presets, setPresets] = useState(loadPresets);
  const [presetSearch, setPresetSearch] = useState('');
  const [editingPresetId, setEditingPresetId] = useState(null);
  const [presetContextMenu, setPresetContextMenu] = useState(null);
  const filteredPresets = presets.filter((preset) => {
    const keyword = presetSearch.trim().toLowerCase();
    if (!keyword) return true;
    return `${preset.icon} ${preset.title}`.toLowerCase().includes(keyword);
  });

  function commitPresets(updater) {
    setPresets((items) => {
      const nextPresets = typeof updater === 'function' ? updater(items) : updater;
      savePresetList(nextPresets);
      return nextPresets;
    });
  }

  async function hidePresetMenu() {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().hide().catch((error) => console.warn('隐藏预设菜单失败:', error));
  }

  useEffect(() => {
    const syncPresets = () => setPresets(loadPresets());
    const onStorage = (event) => {
      if (event.key === PRESETS_KEY) syncPresets();
    };
    window.addEventListener('storage', onStorage);

    let removePresetListener = null;
    let removeFocusListener = null;
    if (isTauriRuntime()) {
      listen(PRESETS_UPDATED_EVENT, syncPresets)
        .then((unlisten) => {
          removePresetListener = unlisten;
        })
        .catch((error) => console.warn('监听预设同步失败:', error));
      getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            window.setTimeout(async () => {
              const isFocused = await getCurrentWindow().isFocused().catch(() => false);
              if (!isFocused) hidePresetMenu();
            }, 180);
          }
        })
        .then((unlisten) => {
          removeFocusListener = unlisten;
        })
        .catch((error) => console.warn('监听预设菜单焦点失败:', error));
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      removePresetListener?.();
      removeFocusListener?.();
    };
  }, []);

  useEffect(() => {
    if (!presetContextMenu) return undefined;
    const closeContextMenu = () => setPresetContextMenu(null);
    const closeContextMenuByKey = (event) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('keydown', closeContextMenuByKey);
    return () => {
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('keydown', closeContextMenuByKey);
    };
  }, [presetContextMenu]);

  function togglePresetEnabled(presetId) {
    commitPresets((items) => items.map((preset) => (
      preset.id === presetId ? { ...preset, enabled: !preset.enabled } : preset
    )));
  }

  function createPreset() {
    const id = makePresetId();
    const nextIndex = presets.filter((preset) => preset.id !== DEFAULT_PRESET_ID).length + 1;
    const nextPreset = {
      id,
      title: `自定义预设${nextIndex}`,
      icon: '🟢',
      enabled: false
    };
    clonePresetStorage(DEFAULT_PRESET_ID, id);
    commitPresets((items) => [...items, nextPreset]);
    setEditingPresetId(id);
  }

  function renamePreset(presetId, title) {
    const nextTitle = sanitizePart(title);
    commitPresets((items) => items.map((preset) => (
      preset.id === presetId ? { ...preset, title: nextTitle } : preset
    )));
  }

  function updatePresetIcon(presetId, icon) {
    commitPresets((items) => items.map((preset) => (
      preset.id === presetId ? { ...preset, icon: String(icon).slice(0, 2) } : preset
    )));
  }

  function deletePreset(presetId) {
    if (presetId === DEFAULT_PRESET_ID) return;
    removePresetStorage(presetId);
    commitPresets((items) => items.filter((preset) => preset.id !== presetId));
  }

  function presetIndex(presetId) {
    return Math.max(0, presets.findIndex((preset) => preset.id === presetId));
  }

  async function openPresetFromMenu(presetId, index, openSettings = false) {
    await openRecorderPresetWindow(presetId, openSettings, index);
    await hidePresetMenu();
  }

  async function openPresetList(presetList, openSettings) {
    await Promise.all(
      presetList.map((preset, index) => openRecorderPresetWindow(preset.id, openSettings, index))
    );
    await hidePresetMenu();
  }

  function openPresetRowContextMenu(event, preset) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 152;
    const menuHeight = 300;
    setPresetContextMenu({
      presetId: preset.id,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  }

  function editContextPresetName() {
    if (!presetContextMenu) return;
    setEditingPresetId(presetContextMenu.presetId);
    setPresetContextMenu(null);
  }

  async function openContextPresetSettings() {
    if (!presetContextMenu) return;
    await openPresetFromMenu(presetContextMenu.presetId, presetIndex(presetContextMenu.presetId), true);
  }

  async function openCheckedPresetSettings() {
    const selectedPresets = presets.filter((preset) => preset.enabled);
    await openPresetList(selectedPresets.length ? selectedPresets : [DEFAULT_PRESET], true);
  }

  async function openAllPresetSettings() {
    await openPresetList(presets, true);
  }

  async function arrangeOpenedWindows(mode) {
    setPresetContextMenu(null);
    await emitArrangeRecorderWindows(mode);
  }

  return (
    <main className="preset-menu-shell" onContextMenu={(event) => event.preventDefault()}>
      <aside className="preset-manager menu-window" aria-label="预设菜单">
        <label className="preset-search">
          <Search size={15} />
          <input
            value={presetSearch}
            placeholder="搜索"
            onChange={(event) => setPresetSearch(event.target.value)}
          />
        </label>
        <div className="preset-list">
          {filteredPresets.map((preset, index) => (
            <div className="preset-row" key={preset.id} onContextMenu={(event) => openPresetRowContextMenu(event, preset)}>
              <label className="preset-enabled">
                <input
                  type="checkbox"
                  checked={preset.enabled}
                  onChange={() => togglePresetEnabled(preset.id)}
                />
                <i />
              </label>
              <input
                className="preset-icon-input"
                value={preset.icon}
                maxLength="2"
                aria-label={`${presetDisplayTitle(preset)} 图标`}
                onChange={(event) => updatePresetIcon(preset.id, event.target.value)}
              />
              {editingPresetId === preset.id ? (
                <input
                  className="preset-title-input"
                  value={preset.title}
                  autoFocus
                  onBlur={() => setEditingPresetId(null)}
                  onChange={(event) => renamePreset(preset.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === 'Escape') setEditingPresetId(null);
                  }}
                />
              ) : (
                <button
                  className="preset-title-button"
                  type="button"
                  onClick={() => openPresetFromMenu(preset.id, index, false)}
                  onDoubleClick={() => setEditingPresetId(preset.id)}
                >
                  {presetDisplayTitle(preset)}
                </button>
              )}
              <button
                className="preset-delete"
                type="button"
                aria-label={`删除 ${presetDisplayTitle(preset)}`}
                disabled={preset.id === DEFAULT_PRESET_ID}
                onClick={() => deletePreset(preset.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="preset-create-button" type="button" onClick={createPreset}>
          +创建预设
        </button>
        <button className="preset-close-button" type="button" aria-label="关闭预设菜单" onClick={hidePresetMenu}>
          <X size={17} />
        </button>
        {presetContextMenu && (
          <div
            className="preset-context-menu"
            style={{ left: `${presetContextMenu.x}px`, top: `${presetContextMenu.y}px` }}
            role="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button type="button" role="menuitem" onClick={editContextPresetName}>编辑名称</button>
            <button type="button" role="menuitem" onClick={openContextPresetSettings}>打开设置</button>
            <button type="button" role="menuitem" onClick={openCheckedPresetSettings}>打开选中窗口</button>
            <button type="button" role="menuitem" onClick={openAllPresetSettings}>打开全部窗口</button>
            <span className="preset-context-divider" />
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('grid')}>网格排列</button>
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('horizontal')}>横向排列</button>
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('vertical')}>纵向排列</button>
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('left')}>贴左侧</button>
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('right')}>贴右侧</button>
            <button type="button" role="menuitem" onClick={() => arrangeOpenedWindows('restore')}>恢复上次位置</button>
          </div>
        )}
      </aside>
    </main>
  );
}

export default function App() {
  if (new URLSearchParams(window.location.search).get('menu') === 'presets') {
    return <PresetMenuWindow />;
  }

  const [presets, setPresets] = useState(loadPresets);
  const [activePresetId] = useState(() => resolveInitialPresetId(loadPresets()));
  const presetKey = (key) => presetStorageKey(activePresetId, key);

  // UI 状态：录音、计时、布局、设置面板和播放器进度。
  const [isRecording, setIsRecording] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [status, setStatus] = useState('🟢准备录音');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [timeOffset, setTimeOffset] = useState(0);
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem(presetKey('layoutMode')) || 'mini');
  const [autoSave, setAutoSave] = useState(() => loadAutoSavePreference(presetKey('autoSave')));
  const [autoOpenEditor, setAutoOpenEditor] = useState(() => localStorage.getItem(presetKey('autoOpenEditor')) === 'true');
  const [autoCache, setAutoCache] = useState(() => localStorage.getItem(presetKey('autoCache')) === 'true');
  const [cacheIntervalSeconds, setCacheIntervalSeconds] = useState(() => normalizeCacheInterval(localStorage.getItem(presetKey('cacheInterval')) || DEFAULT_CACHE_INTERVAL));
  const [cacheDeleteOnSave, setCacheDeleteOnSave] = useState(() => localStorage.getItem(presetKey('cacheDeleteOnSave')) !== 'false');
  const [cacheRetentionDays, setCacheRetentionDays] = useState(() => normalizeCacheRetentionDays(localStorage.getItem(presetKey('cacheRetentionDays'))));
  const [cacheMenuOpen, setCacheMenuOpen] = useState(false);
  const [deleteLocalAfterUpload, setDeleteLocalAfterUpload] = useState(() => localStorage.getItem(presetKey('deleteLocalAfterUpload')) === 'true');
  const [uploadedLocalRetentionDays, setUploadedLocalRetentionDays] = useState(() => normalizeCacheRetentionDays(localStorage.getItem(presetKey('uploadedLocalRetentionDays'))));
  const [autoSaveMenuOpen, setAutoSaveMenuOpen] = useState(false);
  const [uploadedLocalCleanupHelpOpen, setUploadedLocalCleanupHelpOpen] = useState(false);
  const [bitrate, setBitrate] = useState(() => Number(localStorage.getItem(presetKey('bitrate')) || DEFAULT_BITRATE));
  const [globalWindowScale, setGlobalWindowScale] = useState(() => normalizeWindowScale(localStorage.getItem(GLOBAL_WINDOW_SCALE_KEY)));
  const [settingsOpen, setSettingsOpen] = useState(() => new URLSearchParams(window.location.search).get('settings') === '1');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [startupEnabled, setStartupEnabled] = useState(() => localStorage.getItem(STARTUP_ENABLED_KEY) !== 'false');
  const [windowReady, setWindowReady] = useState(() => !isTauriRuntime());
  const [launchActionChecked, setLaunchActionChecked] = useState(() => !isTauriRuntime());
  const [shellActionPresetInfo, setShellActionPresetInfo] = useState(null);
  const [titlePresetEditing, setTitlePresetEditing] = useState(false);
  const [titlePresetDraft, setTitlePresetDraft] = useState({ icon: '', title: '' });
  const [tokens, setTokens] = useState(() => loadTokensForPreset(activePresetId));
  const [recordingDate, setRecordingDate] = useState(() => dateKeyFromValue(localStorage.getItem(presetKey('date'))));
  const [namePart, setNamePart] = useState(() => loadTextPreference(presetKey('name'), 'name'));
  const [numberDigits, setNumberDigits] = useState(() => normalizeNumberDigits(localStorage.getItem(presetKey('numberDigits'))));
  const [customPart, setCustomPart] = useState(() => loadTextPreference(presetKey('custom'), 'custom'));
  const [defaultSaveDirectory, setDefaultSaveDirectory] = useState('系统下载目录\\AudioRecorder');
  const [saveDirectory, setSaveDirectory] = useState(() => localStorage.getItem(presetKey('saveDirectory')) || '');
  const [googleDriveAutoUpload, setGoogleDriveAutoUpload] = useState(() => localStorage.getItem(presetKey('googleDriveAutoUpload')) === 'true');
  const [googleDrivePublicShare, setGoogleDrivePublicShare] = useState(() => localStorage.getItem(presetKey('googleDrivePublicShare')) === 'true');
  const [googleDriveClientId, setGoogleDriveClientId] = useState(() => localStorage.getItem(presetKey('googleDriveClientId')) || '');
  const [googleDriveClientSecret, setGoogleDriveClientSecret] = useState(() => localStorage.getItem(presetKey('googleDriveClientSecret')) || '');
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState(() => localStorage.getItem(presetKey('googleDriveFolderId')) || '');
  const [googleDriveStatus, setGoogleDriveStatus] = useState({ connected: false, email: '' });
  const [googleDriveMessage, setGoogleDriveMessage] = useState('');
  const [googleDriveBusy, setGoogleDriveBusy] = useState(false);
  const [shellUploadSummary, setShellUploadSummary] = useState(null);
  const [microphoneSlots, setMicrophoneSlots] = useState(loadMicrophoneSlots);
  const [activeMicrophoneSlot, setActiveMicrophoneSlot] = useState(() => normalizeMicrophoneSlot(localStorage.getItem(presetKey('activeMicrophoneSlot'))));
  const [titleMicrophonePickerOpen, setTitleMicrophonePickerOpen] = useState(false);
  const [microphoneDevices, setMicrophoneDevices] = useState([]);
  const [timeCopyStyle, setTimeCopyStyle] = useState(() => normalizeTimeCopyStyle(localStorage.getItem(presetKey('timeCopyStyle'))));
  const [timeCopyMenu, setTimeCopyMenu] = useState(null);
  const [timeCopyNotice, setTimeCopyNotice] = useState(null);
  const [editorPlaybackRate, setEditorPlaybackRate] = useState(() => normalizeEditorPlaybackRate(localStorage.getItem(EDITOR_PLAYBACK_RATE_KEY)));
  const [editorPlaybackRateMenu, setEditorPlaybackRateMenu] = useState(null);
  const [editorPlaybackRateDraft, setEditorPlaybackRateDraft] = useState('');
  const [editorFrameRate, setEditorFrameRate] = useState(() => normalizeEditorFrameRate(localStorage.getItem(EDITOR_FRAME_RATE_KEY)));
  const [editorFrameRateMenu, setEditorFrameRateMenu] = useState(null);
  const [editorSelectionMenu, setEditorSelectionMenu] = useState(null);
  const [linksText, setLinksText] = useState(() => localStorage.getItem(presetKey('links')) || '');
  const [webmBlob, setWebmBlob] = useState(null);
  const [mp3Blob, setMp3Blob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [lastSavedPath, setLastSavedPath] = useState('');
  const [lastSavedAudio, setLastSavedAudio] = useState(null);
  const [lastUploadedAudio, setLastUploadedAudio] = useState(null);
  const [savePrompt, setSavePrompt] = useState(null);
  const [drivePrompt, setDrivePrompt] = useState(null);
  const [filenameMenu, setFilenameMenu] = useState(null);
  const [audioEditor, setAudioEditor] = useState(null);
  const [editorCanvasLayoutVersion, setEditorCanvasLayoutVersion] = useState(0);
  const [editorZoomNoticeVisible, setEditorZoomNoticeVisible] = useState(false);
  const [editorClipboard, setEditorClipboard] = useState(null);
  const [previewAllEditorSelections, setPreviewAllEditorSelections] = useState(false);
  const [silenceCutSeconds, setSilenceCutSeconds] = useState(loadSilenceCutSeconds);
  const [silenceSensitivity, setSilenceSensitivity] = useState(loadSilenceSensitivity);
  const [silenceReserveSeconds, setSilenceReserveSeconds] = useState(loadSilenceReserveSeconds);
  const [silenceCutPrompt, setSilenceCutPrompt] = useState(null);
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [quitAllPromptOpen, setQuitAllPromptOpen] = useState(false);
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [editingTextToken, setEditingTextToken] = useState(null);
  const [volume, setVolume] = useState(0.8);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [recordingStartedTimeText, setRecordingStartedTimeText] = useState('');

  // 录音相关对象不参与渲染，用 ref 保存可减少重复渲染和资源抖动。
  const mediaRecorderRef = useRef(null);
  const isRecordingRef = useRef(isRecording);
  const streamRef = useRef(null);
  const inputStreamsRef = useRef([]);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const sourceNodesRef = useRef([]);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const mp3EncoderRef = useRef(null);
  const mp3DataRef = useRef([]);
  const chunksRef = useRef([]);
  const processorRef = useRef(null);
  const timerRef = useRef(null);
  const timecodeRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const startDatePickerRef = useRef(null);
  const timeCopyMenuRef = useRef(null);
  const filenameMenuRef = useRef(null);
  const editorPlaybackRateMenuRef = useRef(null);
  const editorFrameRateMenuRef = useRef(null);
  const editorSelectionMenuRef = useRef(null);
  const editorAudioRef = useRef(null);
  const audioEditorRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const editorSelectionCanvasRef = useRef(null);
  const editorOverlayCanvasRef = useRef(null);
  const editorMiniCanvasRef = useRef(null);
  const editorMiniOverlayCanvasRef = useRef(null);
  const editorTransportTimeRef = useRef(null);
  const editorMiniDragRef = useRef(null);
  const editorZoomNoticeTimerRef = useRef(null);
  const editorPlaybackFollowAnimationRef = useRef(null);
  const editorPlaybackFrameRef = useRef(null);
  const editorPlaybackSnapshotRef = useRef({ currentTime: 0, playbackMarkerTime: null });
  const editorPlaybackStateSyncRef = useRef(0);
  const editorSelectionPreviewTimerRef = useRef(null);
  const silenceCutButtonRef = useRef(null);
  const timeCopyNoticeTimerRef = useRef(null);
  const autoSaveRef = useRef(autoSave);
  const autoOpenEditorRef = useRef(autoOpenEditor);
  const autoCacheRef = useRef(autoCache);
  const cacheIntervalRef = useRef(cacheIntervalSeconds);
  const cacheTimerRef = useRef(null);
  const cacheSaveInFlightRef = useRef(false);
  const cacheMimeTypeRef = useRef('audio/webm');
  const cacheFilenameRef = useRef('');
  const cacheFileReservedRef = useRef(false);
  const cacheSavedFilenameRef = useRef('');
  const cacheWrittenChunkCountRef = useRef(0);
  const cacheDeleteOnSaveRef = useRef(cacheDeleteOnSave);
  const cacheRetentionDaysRef = useRef(cacheRetentionDays);
  const cacheMenuRef = useRef(null);
  const deleteLocalAfterUploadRef = useRef(deleteLocalAfterUpload);
  const uploadedLocalRetentionDaysRef = useRef(uploadedLocalRetentionDays);
  const autoSaveMenuRef = useRef(null);
  const uploadedLocalCleanupHelpRef = useRef(null);
  const actionBubbleRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const uploadProgressTimerRef = useRef(null);
  const uploadProgressIdRef = useRef(0);
  const recordingStartedTimeRef = useRef('');
  const closeAfterRecordingStopRef = useRef(false);
  const quitAllAfterRecordingStopRef = useRef(false);
  const startupPresetWindowsOpenedRef = useRef(false);
  const recorderWindowShownRef = useRef(false);
  const editorWindowModeRef = useRef(false);
  const editorDecodeTokenRef = useRef(0);
  const launchActionHandledRef = useRef(false);
  const handledShellActionIdsRef = useRef(new Set());
  const shellActionInstanceRef = useRef(false);
  const shellActionLauncherHiddenRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let cancelled = false;
    const savedPreference = localStorage.getItem(STARTUP_ENABLED_KEY);

    async function syncStartupPreference() {
      try {
        if (savedPreference === null) {
          await invoke('set_startup_enabled', { enabled: true });
          localStorage.setItem(STARTUP_ENABLED_KEY, 'true');
          if (!cancelled) setStartupEnabled(true);
          return;
        }

        const enabled = await invoke('get_startup_enabled');
        if (!cancelled) setStartupEnabled(Boolean(enabled));
      } catch (error) {
        console.warn('同步开机自启状态失败:', error);
        if (!cancelled) setStartupEnabled(savedPreference !== 'false');
      }
    }

    syncStartupPreference();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    audioEditorRef.current = audioEditor;
    editorPlaybackSnapshotRef.current = {
      currentTime: Number(audioEditor?.currentTime) || 0,
      playbackMarkerTime: Number.isFinite(Number(audioEditor?.playbackMarkerTime)) ? Number(audioEditor.playbackMarkerTime) : null
    };
  }, [audioEditor]);

  useEffect(() => {
    const rate = normalizeEditorPlaybackRate(editorPlaybackRate);
    localStorage.setItem(EDITOR_PLAYBACK_RATE_KEY, String(rate));
    if (editorAudioRef.current) {
      editorAudioRef.current.playbackRate = rate;
    }
  }, [editorPlaybackRate]);

  useEffect(() => {
    localStorage.setItem(EDITOR_FRAME_RATE_KEY, normalizeEditorFrameRate(editorFrameRate));
  }, [editorFrameRate]);
  function numberForFilename(startDateKey) {
    return formatRecordingNumber(dayIndexFromStartDate(startDateKey), numberDigits);
  }

  function buildFilenameBase() {
    const dateKey = dateKeyFromValue(recordingDate);
    const values = {
      date: todayText(),
      time: recordingStartedTimeRef.current || recordingStartedTimeText || currentTimeText(),
      name: namePart,
      number: numberForFilename(dateKey),
      custom: customPart
    };
    const text = tokens
      .map((token) => {
        if (token.type === 'separator') return token.value || '_';
        if (token.type === 'name' || token.type === 'custom') {
          return sanitizePart(textTokenValue(token));
        }
        return sanitizePart(values[token.type]);
      })
      .join('')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return text || `AudioRecorder_${todayText()}`;
  }

  // 根据“命名规则 token + 输入值”实时生成文件名前缀。
  const filenameBase = useMemo(buildFilenameBase, [
    customPart,
    namePart,
    numberDigits,
    recordingStartedTimeText,
    recordingDate,
    tokens
  ]);

  const displayTime = formatTime(totalSeconds + timeOffset);
  const hasCurrentRecording = Boolean(webmBlob || mp3Blob || audioUrl);
  const currentPreset = presets.find((preset) => preset.id === activePresetId) || DEFAULT_PRESET;
  const isDefaultPresetWindow = activePresetId === DEFAULT_PRESET_ID;
  const titlePreset = shellActionPresetInfo || currentPreset;
  const usePresetTitleIdentity = Boolean(shellActionPresetInfo) || !isDefaultPresetWindow;
  const activeEditorSelection = editorActiveSelectionRange(audioEditor);
  const totalEditorSelectionDuration = editorSelectionRanges(audioEditor)
    .reduce((total, range) => total + Math.max(0, (range.end || 0) - (range.start || 0)), 0);
  const canOpenCurrentAudioEditor = Boolean(mp3Blob || lastSavedAudio?.path || lastSavedPath);

  // 系统任务栏/窗口预览标题使用预设名称，和页面内标题保持一致。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const nextTitle = sanitizePart(titlePreset.title) || DEFAULT_PRESET.title;
    getCurrentWindow().setTitle(nextTitle).catch((error) => console.warn('同步窗口标题失败:', error));
  }, [titlePreset.title]);

  // 桌面窗口先隐藏创建，等尺寸、位置、标题都准备好后再显示，避免启动时多个预设窗口闪动。
  useEffect(() => {
    if (!isTauriRuntime() || recorderWindowShownRef.current || !launchActionChecked) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const appWindow = getCurrentWindow();
      const defaultPreset = presets.find((preset) => preset.id === DEFAULT_PRESET_ID);
      const hasEnabledCustomPreset = presets.some((preset) => preset.enabled && preset.id !== DEFAULT_PRESET_ID);
      const shouldHideLauncherWindow =
        appWindow.label === 'main' &&
        activePresetId === DEFAULT_PRESET_ID &&
        (
          shellActionLauncherHiddenRef.current ||
          (defaultPreset?.enabled === false && hasEnabledCustomPreset)
        );
      try {
        if (editorWindowModeRef.current) {
          recorderWindowShownRef.current = true;
          if (!shouldHideLauncherWindow) {
            await appWindow.show().catch(() => {});
            await appWindow.setFocus().catch(() => {});
          }
          if (!cancelled) setWindowReady(true);
          return;
        }
        const scale = normalizeWindowScale(globalWindowScale);
        const size = scaledWindowSize(layoutMode, scale);
        const savedPosition = loadWindowPosition(activePresetId);
        await getCurrentWebview().setZoom(scale / 100).catch(() => {});
        await appWindow.setMinSize(size).catch(() => {});
        await appWindow.setSize(size).catch(() => {});
        if (savedPosition) {
          await appWindow.setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y)).catch(() => {});
        }
        if (cancelled) return;
        recorderWindowShownRef.current = true;
        if (shouldHideLauncherWindow) return;
        await appWindow.show().catch(() => {});
        if (appWindow.label === 'main') {
          await appWindow.setFocus().catch(() => {});
        }
        window.requestAnimationFrame(() => {
          if (!cancelled) setWindowReady(true);
        });
      } catch (error) {
        console.warn('显示录音窗口失败:', error);
        if (!shouldHideLauncherWindow) {
          await appWindow.show().catch(() => {});
        }
        if (!cancelled) setWindowReady(true);
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [launchActionChecked]);

  // 切换迷你/常规界面时，在桌面端同步调整窗口大小；浏览器调试页会自动跳过。
  useEffect(() => {
    localStorage.setItem(presetKey('layoutMode'), layoutMode);
    if (audioEditor?.open || editorWindowModeRef.current) return;
    resizeDesktopWindow(layoutMode, globalWindowScale);
  }, [layoutMode, globalWindowScale, audioEditor?.open]);

  useEffect(() => {
    localStorage.setItem(GLOBAL_WINDOW_SCALE_KEY, String(globalWindowScale));
  }, [globalWindowScale]);

  useEffect(() => {
    const syncScale = (nextScale) => setGlobalWindowScale(normalizeWindowScale(nextScale));
    const onStorage = (event) => {
      if (event.key === GLOBAL_WINDOW_SCALE_KEY) syncScale(event.newValue);
    };
    window.addEventListener('storage', onStorage);

    let removeScaleListener = null;
    if (isTauriRuntime()) {
      listen(GLOBAL_SCALE_UPDATED_EVENT, (event) => syncScale(event.payload?.scale))
        .then((unlisten) => {
          removeScaleListener = unlisten;
        })
        .catch((error) => console.warn('监听全局缩放失败:', error));
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      removeScaleListener?.();
    };
  }, []);

  // 每个预设窗口独立记住自己的桌面位置；使用物理坐标可避免高 DPI 缩放导致恢复偏移。
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const appWindow = getCurrentWindow();
    const savedPosition = loadWindowPosition(activePresetId);
    let active = true;
    let removeMovedListener = null;
    let saveTimer = null;

    const persistPosition = (position) => {
      if (!active) return;
      saveWindowPosition(activePresetId, position);
    };

    const schedulePositionSave = (position) => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => persistPosition(position), 180);
    };

    if (savedPosition) {
      appWindow
        .setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y))
        .catch((error) => console.warn('恢复窗口位置失败:', error));
    }

    appWindow
      .onMoved(({ payload }) => {
        schedulePositionSave(payload);
      })
      .then((unlisten) => {
        if (active) {
          removeMovedListener = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((error) => console.warn('监听窗口位置失败:', error));

    return () => {
      active = false;
      window.clearTimeout(saveTimer);
      removeMovedListener?.();
    };
  }, [activePresetId]);

  useEffect(() => {
    const syncPresets = () => setPresets(loadPresets());
    const onStorage = (event) => {
      if (event.key === PRESETS_KEY) syncPresets();
    };
    window.addEventListener('storage', onStorage);

    let removePresetListener = null;
    if (isTauriRuntime()) {
      listen(PRESETS_UPDATED_EVENT, syncPresets)
        .then((unlisten) => {
          removePresetListener = unlisten;
        })
        .catch((error) => console.warn('监听预设同步失败:', error));
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      removePresetListener?.();
    };
  }, []);

  // 自动保存开关需要给 mediaRecorder.onstop 使用，所以额外同步到 ref。
  useEffect(() => {
    autoSaveRef.current = autoSave;
    localStorage.setItem(presetKey('autoSave'), autoSave ? 'true' : 'false');
  }, [autoSave]);

  useEffect(() => {
    autoOpenEditorRef.current = autoOpenEditor;
    localStorage.setItem(presetKey('autoOpenEditor'), autoOpenEditor ? 'true' : 'false');
  }, [autoOpenEditor]);

  useEffect(() => {
    autoCacheRef.current = autoCache;
    localStorage.setItem(presetKey('autoCache'), autoCache ? 'true' : 'false');
  }, [autoCache]);

  useEffect(() => {
    cacheIntervalRef.current = cacheIntervalSeconds;
    localStorage.setItem(presetKey('cacheInterval'), String(cacheIntervalSeconds));
  }, [cacheIntervalSeconds]);

  useEffect(() => {
    cacheDeleteOnSaveRef.current = cacheDeleteOnSave;
    localStorage.setItem(presetKey('cacheDeleteOnSave'), cacheDeleteOnSave ? 'true' : 'false');
  }, [cacheDeleteOnSave]);

  useEffect(() => {
    cacheRetentionDaysRef.current = cacheRetentionDays;
    localStorage.setItem(presetKey('cacheRetentionDays'), String(cacheRetentionDays));
  }, [cacheRetentionDays]);

  useEffect(() => {
    deleteLocalAfterUploadRef.current = deleteLocalAfterUpload;
    localStorage.setItem(presetKey('deleteLocalAfterUpload'), deleteLocalAfterUpload ? 'true' : 'false');
  }, [deleteLocalAfterUpload]);

  useEffect(() => {
    uploadedLocalRetentionDaysRef.current = uploadedLocalRetentionDays;
    localStorage.setItem(presetKey('uploadedLocalRetentionDays'), String(uploadedLocalRetentionDays));
  }, [uploadedLocalRetentionDays]);

  useEffect(() => {
    if (!isRecording) return undefined;
    if (autoCache) {
      startAutoCacheTimer(cacheMimeTypeRef.current);
    } else {
      stopAutoCacheTimer();
    }
    return undefined;
  }, [autoCache, cacheIntervalSeconds, isRecording, saveDirectory, filenameBase]);

  useEffect(() => localStorage.setItem(presetKey('bitrate'), String(bitrate)), [bitrate]);
  useEffect(() => localStorage.setItem(presetKey('tokens'), JSON.stringify(tokens)), [tokens]);
  useEffect(() => localStorage.setItem(presetKey('date'), recordingDate), [recordingDate]);
  useEffect(() => localStorage.setItem(presetKey('name'), namePart), [namePart]);
  useEffect(() => localStorage.setItem(presetKey('numberDigits'), String(numberDigits)), [numberDigits]);
  useEffect(() => localStorage.setItem(presetKey('custom'), customPart), [customPart]);
  useEffect(() => localStorage.setItem(presetKey('saveDirectory'), saveDirectory), [saveDirectory]);
  useEffect(() => localStorage.setItem(presetKey('googleDriveAutoUpload'), googleDriveAutoUpload ? 'true' : 'false'), [googleDriveAutoUpload]);
  useEffect(() => localStorage.setItem(presetKey('googleDrivePublicShare'), googleDrivePublicShare ? 'true' : 'false'), [googleDrivePublicShare]);
  useEffect(() => localStorage.setItem(presetKey('googleDriveClientId'), googleDriveClientId), [googleDriveClientId]);
  useEffect(() => localStorage.setItem(presetKey('googleDriveClientSecret'), googleDriveClientSecret), [googleDriveClientSecret]);
  useEffect(() => localStorage.setItem(presetKey('googleDriveFolderId'), googleDriveFolderId), [googleDriveFolderId]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.microphoneSlots, JSON.stringify(microphoneSlots));
    if (isTauriRuntime()) {
      emit(MICROPHONE_SETTINGS_UPDATED_EVENT, {
        slots: microphoneSlots,
        source: getCurrentWindow().label
      }).catch((error) => console.warn('同步麦克风槽位失败:', error));
    }
  }, [microphoneSlots]);
  useEffect(() => localStorage.setItem(presetKey('activeMicrophoneSlot'), String(activeMicrophoneSlot)), [activeMicrophoneSlot]);
  useEffect(() => localStorage.setItem(presetKey('timeCopyStyle'), timeCopyStyle), [timeCopyStyle]);
  useEffect(() => localStorage.setItem(presetKey('links'), linksText), [linksText]);

  useEffect(() => {
    const applyMicrophoneSlots = (value) => {
      const nextSlots = normalizeMicrophoneSlots(value);
      setMicrophoneSlots((currentSlots) => (
        JSON.stringify(currentSlots) === JSON.stringify(nextSlots) ? currentSlots : nextSlots
      ));
    };
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEYS.microphoneSlots || !event.newValue) return;
      try {
        applyMicrophoneSlots(JSON.parse(event.newValue));
      } catch {
        applyMicrophoneSlots(DEFAULT_MICROPHONE_SLOTS);
      }
    };
    window.addEventListener('storage', onStorage);

    let unlistenMicrophoneSettings;
    if (isTauriRuntime()) {
      listen(MICROPHONE_SETTINGS_UPDATED_EVENT, (event) => {
        if (event.payload?.source === getCurrentWindow().label) return;
        applyMicrophoneSlots(event.payload?.slots);
      }).then((unlisten) => {
        unlistenMicrophoneSettings = unlisten;
      }).catch((error) => console.warn('监听麦克风槽位同步失败:', error));
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      unlistenMicrophoneSettings?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke('get_default_recordings_dir')
      .then((path) => setDefaultSaveDirectory(path))
      .catch((error) => console.warn('读取默认保存路径失败:', error));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke('google_drive_status')
      .then((nextStatus) => {
        setGoogleDriveStatus(nextStatus);
        setGoogleDriveMessage(nextStatus.connected ? `已连接：${nextStatus.email || 'Google 用户'}` : '');
      })
      .catch((error) => {
        console.warn('读取 Google Drive 状态失败:', error);
        setGoogleDriveMessage(`读取连接状态失败：${error?.message || error}`);
      });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let unlistenUploadProgress;
    listen(GOOGLE_DRIVE_UPLOAD_PROGRESS_EVENT, (event) => {
      const uploadId = Number(event.payload?.upload_id || event.payload?.uploadId || 0);
      if (!uploadId || uploadId !== uploadProgressIdRef.current) return;
      const percent = Math.max(0, Math.min(100, Number(event.payload?.percent || 0)));
      setUploadProgress((current) => {
        if (!current || current.id !== uploadId) return current;
        return { ...current, percent, state: percent >= 100 ? 'done' : current.state };
      });
    })
      .then((unlisten) => {
        unlistenUploadProgress = unlisten;
      })
      .catch((error) => console.warn('监听 Google Drive 上传进度失败:', error));

    return () => {
      unlistenUploadProgress?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== 'main') return;
    syncMp3ContextMenu(presets);
  }, [presets]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let unlistenShellAction = null;
    getCurrentWindow()
      .listen(SHELL_ACTION_EVENT, ({ payload }) => {
        const targetPresetId = payload?.presetId || payload?.preset_id || activePresetId;
        if (targetPresetId === activePresetId) {
          localStorage.removeItem(shellActionStorageKey(activePresetId));
        }
        handleShellActionOnce(payload).catch((error) => {
          console.warn('执行右键菜单动作失败:', error);
          setStatus(`右键菜单动作失败：${error?.message || error}`);
        });
      })
      .then((unlisten) => {
        unlistenShellAction = unlisten;
      })
      .catch((error) => console.warn('监听右键菜单动作失败:', error));

    return () => unlistenShellAction?.();
  }, [activePresetId, presets, googleDriveFolderId, googleDrivePublicShare]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const storageKey = shellActionStorageKey(activePresetId);
    let consumedCreatedAt = 0;

    const consumePendingShellAction = () => {
      const text = localStorage.getItem(storageKey);
      if (!text) return;
      try {
        const action = JSON.parse(text);
        const createdAt = Number(action?.createdAt || 0);
        if (createdAt && createdAt === consumedCreatedAt) return;
        consumedCreatedAt = createdAt;
        shellActionInstanceRef.current = true;
        localStorage.removeItem(storageKey);
        handleShellActionOnce(action).catch((error) => {
          console.warn('执行待处理右键菜单动作失败:', error);
          setStatus(`右键菜单动作失败：${error?.message || error}`);
        });
      } catch (error) {
        localStorage.removeItem(storageKey);
        console.warn('读取待处理右键菜单动作失败:', error);
      }
    };

    const timer = window.setTimeout(consumePendingShellAction, 450);
    const onStorage = (event) => {
      if (event.key === storageKey) consumePendingShellAction();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, [activePresetId, presets, googleDriveFolderId, googleDrivePublicShare]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== 'main') {
      setLaunchActionChecked(true);
      return;
    }
    if (launchActionHandledRef.current) return;
    launchActionHandledRef.current = true;
    invoke('get_launch_action')
      .then((action) => {
        if (action?.actionType || action?.action_type) {
          shellActionInstanceRef.current = true;
          startupPresetWindowsOpenedRef.current = true;
          setLaunchActionChecked(true);
          return handleShellActionOnce(action);
        }
        return undefined;
      })
      .catch((error) => {
        console.warn('读取右键菜单启动动作失败:', error);
      })
      .finally(() => setLaunchActionChecked(true));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || startupPresetWindowsOpenedRef.current || !launchActionChecked) return;
    if (getCurrentWindow().label !== 'main') return;
    startupPresetWindowsOpenedRef.current = true;
    const enabledCustomPresets = presets.filter((preset) => preset.enabled && preset.id !== DEFAULT_PRESET_ID);
    const defaultPreset = presets.find((preset) => preset.id === DEFAULT_PRESET_ID);
    Promise.all(enabledCustomPresets.map((preset, index) => openRecorderPresetWindow(preset.id, false, index + 1)))
      .finally(() => {
        if (defaultPreset?.enabled === false && enabledCustomPresets.length) {
          window.setTimeout(() => runWindowAction('close'), 300);
        }
      });
  }, [launchActionChecked]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    const loadDevicesTimer = window.setTimeout(() => {
      refreshMicrophoneDevices(false);
    }, 300);
    const handleDeviceChange = () => {
      if (isRecordingRef.current) return;
      refreshMicrophoneDevices(false);
    };
    navigator.mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      window.clearTimeout(loadDevicesTimer);
      navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen || !navigator.mediaDevices?.enumerateDevices) return;
    refreshMicrophoneDevices(false);
  }, [settingsOpen]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let removeArrangeListener = null;
    listen(ARRANGE_WINDOWS_EVENT, async ({ payload }) => {
      const mode = typeof payload === 'string' ? payload : payload?.mode || 'grid';
      const currentWindow = getCurrentWindow();
      const label = currentWindow.label;
      if (label === PRESET_MENU_LABEL) return;

      if (mode === 'restore') {
        const savedPosition = loadArrangeBackupPosition(activePresetId) || loadWindowPosition(activePresetId);
        if (savedPosition) {
          await currentWindow.setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y)).catch((error) => {
            console.warn('恢复窗口排列位置失败:', error);
          });
          clearArrangeBackupPosition(activePresetId);
        }
        return;
      }

      const openedItems = await openedRecorderWindowLayoutItems(loadPresets());
      const currentIndex = openedItems.findIndex((item) => windowLabelForPreset(item.preset.id) === label);
      if (currentIndex < 0) return;

      const positions = arrangeVariableWindowPositions(mode, openedItems, await arrangementBounds(currentWindow));
      const position = positions.get(activePresetId);
      if (!position) return;
      if (!loadArrangeBackupPosition(activePresetId)) {
        const currentPosition = await currentWindow.outerPosition().catch(() => null);
        if (currentPosition) saveArrangeBackupPosition(activePresetId, currentPosition);
      }
      await currentWindow.unminimize().catch(() => {});
      await currentWindow.show().catch(() => {});
      await currentWindow.setPosition(new PhysicalPosition(position.x, position.y)).catch((error) => {
        console.warn('排列窗口失败:', error);
      });
    })
      .then((unlisten) => {
        removeArrangeListener = unlisten;
      })
      .catch((error) => console.warn('监听窗口排列失败:', error));

    return () => removeArrangeListener?.();
  }, [activePresetId, globalWindowScale, layoutMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let removeListener = null;
    getCurrentWindow()
      .listen('open-preset-settings', () => {
        setLayoutMode('regular');
        setSettingsOpen(true);
      })
      .then((unlisten) => {
        removeListener = unlisten;
      })
      .catch((error) => console.warn('监听预设窗口打开事件失败:', error));

    return () => removeListener?.();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let active = true;
    let removeCloseListener = null;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (closeAfterRecordingStopRef.current || !isRecording) return;
        event.preventDefault();
        requestCloseWindow();
      })
      .then((unlisten) => {
        if (active) {
          removeCloseListener = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((error) => console.warn('监听窗口关闭事件失败:', error));

    return () => {
      active = false;
      removeCloseListener?.();
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    invoke('set_recording_state', { recording: isRecording })
      .catch((error) => console.warn('同步录音状态失败:', error));

    return () => {
      invoke('set_recording_state', { recording: false })
        .catch((error) => console.warn('清理录音状态失败:', error));
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let removeListener = null;
    getCurrentWindow()
      .listen('request-quit-all-while-recording', () => {
        setSavePrompt(null);
        setRestartPromptOpen(false);
        setClosePromptOpen(false);
        setQuitAllPromptOpen(true);
      })
      .then((unlisten) => {
        removeListener = unlisten;
      })
      .catch((error) => console.warn('监听退出全部提示失败:', error));

    return () => removeListener?.();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let removeListener = null;
    listen(NATIVE_WAVEFORM_PROGRESS_EVENT, (event) => {
      const payload = event.payload || {};
      setAudioEditor((current) => {
        if (!current?.nativeWaveformOnly) return current;
        if (payload.request_id && payload.request_id !== current.nativeWaveformRequestId) return current;
        if (payload.path && current.sourcePath && payload.path !== current.sourcePath) return current;

        const progress = {
          percent: Math.max(0, Math.min(100, Number(payload.percent) || 0)),
          stage: String(payload.stage || '正在生成波形缓存')
        };
        const preview = payload.preview;
        if (!preview?.mins?.length || !preview?.maxs?.length) {
          return { ...current, waveformProgress: progress };
        }

        const previewLevel = createNativeEditorSegment(current.sourcePath, preview);
        const nextLevels = {
          ...(current.nativeWaveformLevels || {}),
          [previewLevel.wavePeaks.pointCount]: preview
        };
        return {
          ...current,
          duration: current.segments?.length
            ? nativeEditorDurationFromSegments(current.segments)
            : previewLevel.duration || current.duration,
          segments: current.segments?.length ? current.segments.map((segment) => ({
            ...segment,
            wavePeaks: sliceNativeEditorSegment({
              ...previewLevel,
              duration: previewLevel.duration || current.playbackDuration || current.duration
            }, segment.sourceStart || 0, segment.sourceEnd || segment.duration || 0)?.wavePeaks || segment.wavePeaks
          })) : [previewLevel],
          nativeWaveformActivePointCount: previewLevel.wavePeaks.pointCount,
          nativeWaveformLevels: nextLevels,
          waveformProgress: progress
        };
      });
    })
      .then((unlisten) => {
        removeListener = unlisten;
      })
      .catch((error) => console.warn('监听原生波形进度失败:', error));

    return () => removeListener?.();
  }, []);

  // 频谱绘制：空闲时只画一条静态基线；录音时约 30fps 单向向上刷新。
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    let timeoutId = 0;
    let stopped = false;

    const drawFlatLine = () => {
      const width = canvas.width;
      const height = canvas.height;
      const baseline = height - 12;
      context.clearRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(37, 99, 235, 0.22)');
      gradient.addColorStop(0.5, 'rgba(32, 197, 92, 0.52)');
      gradient.addColorStop(1, 'rgba(236, 72, 153, 0.22)');
      context.shadowBlur = 0;
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, baseline);
      context.lineTo(width, baseline);
      context.stroke();
    };

    // 只绘制从底部基线向上的柱子，不做上下镜像。
    const drawRecordingFrame = () => {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#8b5cf6');
      gradient.addColorStop(0.18, '#ec5899');
      gradient.addColorStop(0.32, '#f97316');
      gradient.addColorStop(0.52, '#facc15');
      gradient.addColorStop(0.68, '#22c55e');
      gradient.addColorStop(0.82, '#06b6d2');
      gradient.addColorStop(1, '#2563eb');

      const analyser = analyserRef.current;
      const data = dataArrayRef.current;
      if (analyser && data) analyser.getByteFrequencyData(data);

      const peak = data ? Math.max(...data) : 0;
      if (peak < 10) {
        drawFlatLine();
        return;
      }

      const bars = layoutMode === 'mini' ? 60 : 90;
      const barGap = layoutMode === 'mini' ? 5 : 5;
      const barWidth = Math.max(12, (width - bars * barGap) / bars);
      const baseline = height - 12;
      for (let i = 0; i < bars; i += 1) {
        const liveValue = data ? data[Math.floor((i / bars) * data.length)] / 255 : 0;
        const energy = Math.max(0, liveValue - 0.03);
        const barHeight = Math.max(3, energy * (height - 16));
        const x = i * (barWidth + barGap);
        context.fillStyle = gradient;
        context.shadowColor = 'rgba(56, 206, 113, 0.26)';
        context.shadowBlur = 5;
        drawRoundedRect(context, x, baseline - barHeight, barWidth, barHeight, 6);
        context.fill();
      }
    };

    const drawLoop = () => {
      if (stopped) return;
      if (!isRecording) {
        drawFlatLine();
        return;
      }
      drawRecordingFrame();
      timeoutId = window.setTimeout(drawLoop, 33);
    };

    drawLoop();
    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
    };
  }, [isRecording, layoutMode]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!audioEditor) return undefined;

    const resizeCanvasGroup = (canvases, width, height) => {
      let changed = false;
      canvases.filter(Boolean).forEach((canvas) => {
        if (canvas.width !== width) {
          canvas.width = width;
          changed = true;
        }
        if (canvas.height !== height) {
          canvas.height = height;
          changed = true;
        }
      });
      return changed;
    };

    const syncEditorCanvasSize = () => {
      const mainStack = editorCanvasRef.current?.parentElement;
      const miniStack = editorMiniCanvasRef.current?.parentElement;
      let changed = false;

      if (mainStack) {
        const rect = mainStack.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        changed = resizeCanvasGroup([
          editorCanvasRef.current,
          editorSelectionCanvasRef.current,
          editorOverlayCanvasRef.current
        ], width, height) || changed;
      }

      if (miniStack) {
        const rect = miniStack.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        changed = resizeCanvasGroup([
          editorMiniCanvasRef.current,
          editorMiniOverlayCanvasRef.current
        ], width, height) || changed;
      }

      if (changed) {
        setEditorCanvasLayoutVersion((value) => value + 1);
        window.requestAnimationFrame(() => drawEditorRealtimeOverlay(audioEditorRef.current));
      }
    };

    let frameId = 0;
    const scheduleSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncEditorCanvasSize);
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSync) : null;
    const mainStack = editorCanvasRef.current?.parentElement;
    const miniStack = editorMiniCanvasRef.current?.parentElement;
    if (mainStack && observer) observer.observe(mainStack);
    if (miniStack && observer) observer.observe(miniStack);
    window.addEventListener('resize', scheduleSync);
    scheduleSync();

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleSync);
      observer?.disconnect();
    };
  }, [Boolean(audioEditor)]);

  useEffect(() => {
    if (!audioEditor || !editorCanvasRef.current) return;
    const canvas = editorCanvasRef.current;
    const context = canvas.getContext('2d');
    const miniCanvas = editorMiniCanvasRef.current;
    const miniContext = miniCanvas?.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const duration = Math.max(0, Number(audioEditor.duration) || 0);
    const visible = editorVisibleRange(audioEditor);
    const rulerHeight = 32;
    const waveTop = rulerHeight + 8;
    const waveHeight = height - waveTop - 10;
    const centerY = waveTop + waveHeight / 2;

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(250, 253, 255, 0.84)';
    context.fillRect(0, 0, width, height);

    const drawRuler = () => {
      context.fillStyle = '#7f90aa';
      context.font = '700 12px system-ui';
      context.textAlign = 'center';
      context.strokeStyle = 'rgba(127, 153, 187, 0.92)';
      // context.lineWidth = 1.5;
      const majorTicks = 10;
      const subTicksPerMajor = 10;
      for (let tick = 0; tick <= majorTicks; tick += 1) {
        const x = (tick / majorTicks) * width;
        const time = visible.start + visible.duration * (tick / majorTicks);
        const label = visible.duration <= 0.05
          ? formatEditorFrameTime(time, audioEditor)
          : formatEditorTime(time).replace(/^00:/, '');
        if (width / majorTicks >= 76 || tick % 2 === 0 || tick === majorTicks) {
          context.fillText(label, x, 14);
        }
        context.lineWidth = 1.8;  //大刻度
        context.beginPath();
        context.moveTo(x + 0.5, 21);
        context.lineTo(x + 0.5, 32);
        context.stroke();
        if (tick < majorTicks) {
          for (let sub = 1; sub < subTicksPerMajor; sub += 1) {
            const subX = x + (width / majorTicks) * (sub / subTicksPerMajor);
            context.lineWidth = 1;  //小刻度
            context.beginPath();
            context.moveTo(subX + 0.5, 25);
            context.lineTo(subX + 0.5, 32);
            context.stroke();
          }
        }
      }
    };

    const drawPeakWaveform = (peaks, targetContext, targetWidth, targetHeight, rangeStart, rangeEnd, options = {}) => {
      const pointCount = Math.min(peaks?.mins?.length || 0, peaks?.maxs?.length || 0);
      const peakDuration = Math.max(0, Number(options.duration) || duration);
      if (!pointCount || !peakDuration) return false;
      const top = options.top || 0;
      const drawHeight = options.height || targetHeight;
      const localCenterY = top + drawHeight / 2;
      const safeStart = clampEditorTime(rangeStart, peakDuration);
      const safeEnd = Math.max(safeStart + editorFrameDuration(audioEditor), clampEditorTime(rangeEnd, peakDuration));
      const startPoint = Math.min(pointCount - 1, Math.max(0, (safeStart / peakDuration) * pointCount));
      const endPoint = Math.min(pointCount, Math.max(startPoint + 1, (safeEnd / peakDuration) * pointCount));
      const pointsPerPixel = Math.max(Number.EPSILON, (endPoint - startPoint) / targetWidth);
      const gradient = targetContext.createLinearGradient(0, top, targetWidth, top);
      gradient.addColorStop(0, options.faint ? 'rgba(145, 195, 255, 0.36)' : 'rgba(145, 195, 255, 0.54)');
      gradient.addColorStop(0.5, options.faint ? 'rgba(37, 99, 235, 0.44)' : 'rgba(37, 99, 235, 0.94)');
      gradient.addColorStop(1, options.faint ? 'rgba(145, 195, 255, 0.36)' : 'rgba(145, 195, 255, 0.54)');
      const drawCenterLine = () => {
        if (options.faint) return;
        const centerLineOpacity = Math.max(0, Math.min(1, ((audioEditor?.zoom || 0) - 50) / 18));
        if (centerLineOpacity <= 0) return;
        targetContext.save();
        targetContext.strokeStyle = `rgba(239, 68, 68, ${0.72 * centerLineOpacity})`;
        targetContext.lineWidth = 1;
        targetContext.beginPath();
        targetContext.moveTo(0, localCenterY + 0.5);
        targetContext.lineTo(targetWidth, localCenterY + 0.5);
        targetContext.stroke();
        targetContext.restore();
      };

      const samplePeakAt = (pointPosition) => {
        const center = Math.min(pointCount - 1, Math.max(0, pointPosition));
        const radius = Math.max(0, Math.floor(pointsPerPixel / 2));
        const start = Math.max(0, Math.floor(center) - radius);
        const end = Math.min(pointCount, Math.max(start + 1, Math.ceil(center) + radius + 1));
        let min = 1;
        let max = -1;
        for (let index = start; index < end; index += 1) {
          min = Math.min(min, peaks.mins[index] || 0);
          max = Math.max(max, peaks.maxs[index] || 0);
        }
        if (min === 1 && max === -1) {
          min = 0;
          max = 0;
        }
        return { min, max };
      };

      if (!options.faint && pointsPerPixel < 1.25) {
        const displayPoints = Math.min(pointCount, Math.max(2, Math.ceil(endPoint - startPoint)));
        const xScale = targetWidth / Math.max(1, displayPoints - 1);
        const upper = [];
        const lower = [];
        for (let point = 0; point < displayPoints; point += 1) {
          const pointPosition = startPoint + point * ((endPoint - startPoint) / Math.max(1, displayPoints - 1));
          const peak = samplePeakAt(pointPosition);
          const x = point * xScale;
          upper.push({ x, y: localCenterY + peak.max * drawHeight * 0.45 });
          lower.push({ x, y: localCenterY + peak.min * drawHeight * 0.45 });
        }
        const drawSmoothPath = (points) => {
          if (!points.length) return;
          for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];
            const middleX = (previous.x + current.x) / 2;
            const middleY = (previous.y + current.y) / 2;
            targetContext.quadraticCurveTo(previous.x, previous.y, middleX, middleY);
          }
          const last = points[points.length - 1];
          targetContext.lineTo(last.x, last.y);
        };
        targetContext.save();
        targetContext.fillStyle = gradient;
        targetContext.strokeStyle = 'rgba(37, 99, 235, 0.18)';
        targetContext.lineWidth = 0.8;
        targetContext.lineCap = 'round';
        targetContext.lineJoin = 'round';
        targetContext.beginPath();
        targetContext.moveTo(upper[0].x, upper[0].y);
        drawSmoothPath(upper);
        for (let index = lower.length - 1; index >= 0; index -= 1) {
          const current = lower[index];
          if (index === lower.length - 1) {
            targetContext.lineTo(current.x, current.y);
          } else {
            const next = lower[index + 1];
            const middleX = (next.x + current.x) / 2;
            const middleY = (next.y + current.y) / 2;
            targetContext.quadraticCurveTo(next.x, next.y, middleX, middleY);
          }
        }
        targetContext.closePath();
        targetContext.fill();
        targetContext.stroke();
        targetContext.restore();
        drawCenterLine();
        return true;
      }

      targetContext.strokeStyle = gradient;
      targetContext.lineWidth = options.lineWidth || 1;
      targetContext.beginPath();
      for (let x = 0; x < targetWidth; x += 1) {
        const bucketStart = Math.min(pointCount - 1, Math.max(0, Math.floor(startPoint + x * pointsPerPixel)));
        const bucketEnd = Math.min(pointCount, Math.max(bucketStart + 1, Math.ceil(startPoint + (x + 1) * pointsPerPixel)));
        let min = 1;
        let max = -1;
        for (let index = bucketStart; index < bucketEnd; index += 1) {
          min = Math.min(min, peaks.mins[index] || 0);
          max = Math.max(max, peaks.maxs[index] || 0);
        }
        if (min === 1 && max === -1) {
          min = 0;
          max = 0;
        }
        targetContext.moveTo(x + 0.5, localCenterY + min * drawHeight * 0.45);
        targetContext.lineTo(x + 0.5, localCenterY + max * drawHeight * 0.45);
      }
      targetContext.stroke();
      drawCenterLine();
      return true;
    };

    const drawNativeSegmentWaveform = (segments, targetContext, targetWidth, targetHeight, rangeStart, rangeEnd, options = {}) => {
      const sourceSegments = Array.isArray(segments) ? segments : [];
      if (!sourceSegments.length || !duration || rangeEnd <= rangeStart) return false;
      const top = options.top || 0;
      const drawHeight = options.height || targetHeight;
      const visibleForDraw = {
        start: rangeStart,
        duration: Math.max(editorFrameDuration(audioEditor), rangeEnd - rangeStart)
      };
      const timelineSampleRate = editorSampleRate(audioEditor);
      let cursorFrame = 0;
      let rendered = false;

      sourceSegments.forEach((segment) => {
        const segmentFrameCount = nativeSegmentFrameCount(segment);
        const segmentDuration = nativeFrameToSeconds(segmentFrameCount, nativeSegmentSampleRate(segment, timelineSampleRate));
        const segmentStart = nativeFrameToSeconds(cursorFrame, timelineSampleRate);
        const segmentEnd = nativeFrameToSeconds(cursorFrame + segmentFrameCount, timelineSampleRate);
        cursorFrame += segmentFrameCount;
        if (segmentDuration <= 0 || segmentEnd <= rangeStart || segmentStart >= rangeEnd) return;

        const visibleStart = Math.max(rangeStart, segmentStart);
        const visibleEnd = Math.min(rangeEnd, segmentEnd);
        if (visibleEnd <= visibleStart) return;

        const xStart = editorTimeToVisibleRatio(visibleStart, visibleForDraw) * targetWidth;
        const xEnd = editorTimeToVisibleRatio(visibleEnd, visibleForDraw) * targetWidth;
        const segmentWidth = Math.max(1, xEnd - xStart);

        targetContext.save();
        targetContext.beginPath();
        targetContext.rect(xStart, top, segmentWidth, drawHeight);
        targetContext.clip();
        targetContext.translate(xStart, 0);
        rendered = drawPeakWaveform(
          segment.wavePeaks,
          targetContext,
          segmentWidth,
          targetHeight,
          visibleStart - segmentStart,
          visibleEnd - segmentStart,
          { ...options, duration: segmentDuration }
        ) || rendered;
        targetContext.restore();
      });

      return rendered;
    };

    const drawBufferWaveform = (audioBuffer, targetContext, targetWidth, targetHeight, rangeStart, rangeEnd, options = {}) => {
      if (!audioBuffer || !duration) return false;
      const data = audioBuffer.getChannelData(0);
      const top = options.top || 0;
      const drawHeight = options.height || targetHeight;
      const localCenterY = top + drawHeight / 2;
      const safeStart = clampEditorTime(rangeStart, duration);
      const safeEnd = Math.max(safeStart + editorFrameDuration(audioEditor), clampEditorTime(rangeEnd, duration));
      const startSample = Math.min(data.length - 1, Math.max(0, (safeStart / duration) * data.length));
      const endSample = Math.min(data.length, Math.max(startSample + 1, (safeEnd / duration) * data.length));
      const samplesPerPixel = Math.max(Number.EPSILON, (endSample - startSample) / targetWidth);
      targetContext.strokeStyle = options.faint ? 'rgba(145, 195, 255, 0.42)' : 'rgba(37, 99, 235, 0.9)';
      targetContext.lineWidth = options.lineWidth || 1;
      targetContext.beginPath();
      for (let x = 0; x < targetWidth; x += 1) {
        let min = 1;
        let max = -1;
        const sampleStart = Math.min(data.length - 1, Math.max(0, Math.floor(startSample + x * samplesPerPixel)));
        const sampleEnd = Math.min(data.length, Math.max(sampleStart + 1, Math.ceil(startSample + (x + 1) * samplesPerPixel)));
        for (let index = sampleStart; index < sampleEnd; index += 1) {
          const sample = data[index];
          if (sample < min) min = sample;
          if (sample > max) max = sample;
        }
        if (min === 1 && max === -1) {
          min = 0;
          max = 0;
        }
        targetContext.moveTo(x + 0.5, localCenterY + min * drawHeight * 0.45);
        targetContext.lineTo(x + 0.5, localCenterY + max * drawHeight * 0.45);
      }
      targetContext.stroke();
      return true;
    };

    drawRuler();
    const hasWaveform = audioEditor.nativeWaveformOnly
      ? drawNativeSegmentWaveform(audioEditor.segments, context, width, height, visible.start, visible.end, { top: waveTop, height: waveHeight })
      : drawBufferWaveform(audioEditor.audioBuffer, context, width, height, visible.start, visible.end, { top: waveTop, height: waveHeight });

    if (!hasWaveform) {
      context.fillStyle = '#8da0bb';
      context.font = '700 18px system-ui';
      context.textAlign = 'center';
      context.fillText(audioEditor.loading ? '正在解析音频...' : (audioEditor.waveformProgress?.stage || '暂无波形数据'), width / 2, height / 2);
    }

    if (miniContext && miniCanvas) {
      const miniWidth = miniCanvas.width;
      const miniHeight = miniCanvas.height;
      miniContext.clearRect(0, 0, miniWidth, miniHeight);
      miniContext.fillStyle = 'rgba(255, 255, 255, 0.72)';
      miniContext.fillRect(0, 0, miniWidth, miniHeight);
      if (audioEditor.nativeWaveformOnly) {
        drawNativeSegmentWaveform(audioEditor.segments, miniContext, miniWidth, miniHeight, 0, duration || 1, { faint: true, top: 2, height: miniHeight - 8 });
      } else {
        drawBufferWaveform(audioEditor.audioBuffer, miniContext, miniWidth, miniHeight, 0, duration || 1, { faint: true, top: 2, height: miniHeight - 8 });
      }
      if (duration) {
        const viewportX = (visible.start / duration) * miniWidth;
        const viewportWidth = Math.max(2, (visible.duration / duration) * miniWidth);
        miniContext.fillStyle = 'rgba(37, 99, 235, 0.11)';
        miniContext.fillRect(viewportX, 1, viewportWidth, miniHeight - 2);
        miniContext.strokeStyle = '#2572ff';
        miniContext.lineWidth = 2;
        drawRoundedRect(miniContext, viewportX + 1, 1, Math.max(1, viewportWidth - 2), miniHeight - 2, 8);
        miniContext.stroke();
      }
    }
  }, [audioEditor?.audioBuffer, audioEditor?.segments, audioEditor?.loading, audioEditor?.duration, audioEditor?.zoom, audioEditor?.visibleStart, audioEditor?.waveformProgress, editorCanvasLayoutVersion]);

  useEffect(() => {
    const selectionCanvas = editorSelectionCanvasRef.current;
    const selectionContext = selectionCanvas?.getContext('2d');
    if (!selectionCanvas || !selectionContext) return;

    selectionContext.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    if (!audioEditor) return;

    const width = selectionCanvas.width;
    const height = selectionCanvas.height;
    const duration = Math.max(0, Number(audioEditor.duration) || 0);
    if (!duration) return;

    const visible = editorVisibleRange(audioEditor);
    const rulerHeight = 32;
    const waveTop = rulerHeight + 8;
    const waveHeight = height - waveTop - 10;
    const ranges = editorSelectionRanges(audioEditor);
    const activeIndex = Math.min(Math.max(Number(audioEditor.activeSelectionIndex) || 0, 0), Math.max(0, ranges.length - 1));
    const hoveredRangeIndex = audioEditor.dragSelectionEdge?.rangeIndex
      ?? audioEditor.hoverSelectionDeleteIndex
      ?? audioEditor.hoverSelectionEdge?.rangeIndex
      ?? audioEditor.hoverSelectionIndex;

    const drawSelectionTimeLabel = (text, x, y, options = {}) => {
      selectionContext.save();
      selectionContext.font = options.font || '800 11px system-ui';
      selectionContext.textAlign = 'center';
      selectionContext.textBaseline = 'middle';
      const paddingX = options.paddingX || 7;
      const labelWidth = Math.ceil(selectionContext.measureText(text).width + paddingX * 2);
      const labelHeight = options.height || 21;
      const safeX = Math.min(width - labelWidth / 2 - 4, Math.max(labelWidth / 2 + 4, x));
      const safeY = Math.min(height - labelHeight / 2 - 3, Math.max(labelHeight / 2 + 3, y));
      drawRoundedRect(selectionContext, safeX - labelWidth / 2, safeY - labelHeight / 2, labelWidth, labelHeight, 8);
      selectionContext.fillStyle = options.background || 'rgba(255, 255, 255, 0.92)';
      selectionContext.fill();
      selectionContext.strokeStyle = options.border || 'rgba(37, 99, 235, 0.34)';
      selectionContext.lineWidth = 1;
      selectionContext.stroke();
      selectionContext.fillStyle = options.color || '#1d4ed8';
      selectionContext.fillText(text, safeX, safeY + 0.5);
      selectionContext.restore();
    };

    let hoveredSelectionLabels = null;
    ranges.forEach((range, rangeIndex) => {
      const selectionStart = Math.max(range.start, visible.start);
      const selectionEnd = Math.min(range.end, visible.end);
      if (selectionEnd <= selectionStart) return;

      const startX = editorTimeToVisibleRatio(selectionStart, visible) * width;
      const endX = editorTimeToVisibleRatio(selectionEnd, visible) * width;
      const activeEdge = audioEditor.dragSelectionEdge?.rangeIndex === rangeIndex
        ? audioEditor.dragSelectionEdge.edge
        : audioEditor.hoverSelectionEdge?.rangeIndex === rangeIndex
          ? audioEditor.hoverSelectionEdge.edge
          : null;
      const isActive = rangeIndex === activeIndex;
      const isLocked = Boolean(range.locked);

      selectionContext.fillStyle = isLocked ? 'rgba(32, 198, 90, 0.13)' : 'rgba(37, 99, 235, 0.16)';
      selectionContext.fillRect(startX, waveTop, Math.max(2, endX - startX), waveHeight);
      selectionContext.strokeStyle = isActive ? '#f97316' : isLocked ? 'rgba(22, 163, 74, 0.72)' : 'rgba(37, 99, 235, 0.58)';
      selectionContext.lineWidth = isActive ? 1.2 : 1;
      selectionContext.strokeRect(startX, waveTop, Math.max(2, endX - startX), waveHeight);
      selectionContext.lineCap = 'round';
      selectionContext.lineWidth = activeEdge === 'start' ? 4 : 1;
      selectionContext.beginPath();
      selectionContext.moveTo(startX, waveTop);
      selectionContext.lineTo(startX, waveTop + waveHeight);
      selectionContext.stroke();
      selectionContext.lineWidth = activeEdge === 'end' ? 4 : 1;
      selectionContext.beginPath();
      selectionContext.moveTo(endX, waveTop);
      selectionContext.lineTo(endX, waveTop + waveHeight);
      selectionContext.stroke();
      selectionContext.lineCap = 'butt';

      if (audioEditor.hoverSelectionIndex === rangeIndex || audioEditor.hoverSelectionDeleteIndex === rangeIndex) {
        const deleteX = (startX + endX) / 2;
        const deleteY = waveTop - 13;
        selectionContext.strokeStyle = '#ef1111';
        selectionContext.lineWidth = 2;
        selectionContext.lineCap = 'round';
        selectionContext.beginPath();
        selectionContext.moveTo(deleteX - 4, deleteY - 4);
        selectionContext.lineTo(deleteX + 4, deleteY + 4);
        selectionContext.moveTo(deleteX + 4, deleteY - 4);
        selectionContext.lineTo(deleteX - 4, deleteY + 4);
        selectionContext.stroke();
        selectionContext.lineCap = 'butt';
      }

      if (hoveredRangeIndex === rangeIndex) {
        const narrowSelection = endX - startX < 148;
        hoveredSelectionLabels = {
          startText: formatEditorTime(range.start),
          endText: formatEditorTime(range.end),
          durationText: formatEditorTime(Math.max(0, range.end - range.start)),
          startX: narrowSelection ? startX - 42 : startX,
          endX: narrowSelection ? endX + 42 : endX,
          centerX: (startX + endX) / 2
        };
      }
    });

    if (hoveredSelectionLabels) {
      drawSelectionTimeLabel(hoveredSelectionLabels.startText, hoveredSelectionLabels.startX, waveTop + 18, {
        background: 'rgba(255, 247, 237, 0.96)',
        border: 'rgba(249, 115, 22, 0.48)',
        color: '#c2410c'
      });
      drawSelectionTimeLabel(hoveredSelectionLabels.endText, hoveredSelectionLabels.endX, waveTop + 18, {
        background: 'rgba(255, 247, 237, 0.96)',
        border: 'rgba(249, 115, 22, 0.48)',
        color: '#c2410c'
      });
      drawSelectionTimeLabel(hoveredSelectionLabels.durationText, hoveredSelectionLabels.centerX, waveTop + waveHeight - 18, {
        background: 'rgba(239, 246, 255, 0.96)',
        border: 'rgba(37, 99, 235, 0.42)',
        color: '#1d4ed8'
      });
    }
  }, [audioEditor?.duration, audioEditor?.selectionStart, audioEditor?.selectionEnd, audioEditor?.selectionRanges, audioEditor?.activeSelectionIndex, audioEditor?.zoom, audioEditor?.visibleStart, audioEditor?.hoverSelectionEdge, audioEditor?.hoverSelectionIndex, audioEditor?.hoverSelectionDeleteIndex, audioEditor?.dragSelectionEdge, editorCanvasLayoutVersion]);

  function drawEditorRealtimeOverlay(sourceEditor = audioEditorRef.current, playheadTime = editorPlaybackSnapshotRef.current.currentTime) {
    const overlayCanvas = editorOverlayCanvasRef.current;
    const overlayContext = overlayCanvas?.getContext('2d');
    const miniOverlayCanvas = editorMiniOverlayCanvasRef.current;
    const miniOverlayContext = miniOverlayCanvas?.getContext('2d');

    if (overlayContext && overlayCanvas) {
      overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    if (miniOverlayContext && miniOverlayCanvas) {
      miniOverlayContext.clearRect(0, 0, miniOverlayCanvas.width, miniOverlayCanvas.height);
    }
    if (!sourceEditor) return;

    const duration = Math.max(0, Number(sourceEditor.duration) || 0);
    const visible = editorVisibleRange(sourceEditor);

    if (overlayContext && overlayCanvas && duration) {
      const width = overlayCanvas.width;
      const height = overlayCanvas.height;
      const rulerHeight = 32;
      const waveTop = rulerHeight + 8;
      const waveHeight = height - waveTop - 10;
      const snapshotMarkerTime = editorPlaybackSnapshotRef.current.playbackMarkerTime;
      const markerTime = Number.isFinite(Number(snapshotMarkerTime))
        ? Number(snapshotMarkerTime)
        : Number.isFinite(Number(sourceEditor.playbackMarkerTime))
          ? Number(sourceEditor.playbackMarkerTime)
          : null;

      if (markerTime !== null && markerTime >= visible.start && markerTime <= visible.end) {
        const markerX = editorTimeToVisibleRatio(markerTime, visible) * width;
        overlayContext.strokeStyle = '#8b5cf6';
        overlayContext.lineWidth = 1.5;
        overlayContext.beginPath();
        overlayContext.moveTo(markerX, waveTop - 1);
        overlayContext.lineTo(markerX, waveTop + waveHeight);
        overlayContext.stroke();
      }

      const nextPlayheadTime = Math.min(duration, Math.max(0, Number(playheadTime) || 0));
      if (nextPlayheadTime >= visible.start && nextPlayheadTime <= visible.end) {
        const playheadX = editorTimeToVisibleRatio(nextPlayheadTime, visible) * width;
        overlayContext.strokeStyle = '#E81D1D';
        overlayContext.lineWidth = 1.5;
        overlayContext.beginPath();
        overlayContext.moveTo(playheadX, waveTop - 1);
        overlayContext.lineTo(playheadX, waveTop + waveHeight);
        overlayContext.stroke();
        overlayContext.fillStyle = '#E81D1D';
        overlayContext.beginPath();
        overlayContext.moveTo(playheadX, waveTop - 1);
        overlayContext.lineTo(playheadX - 6, waveTop - 10);
        overlayContext.lineTo(playheadX + 6, waveTop - 10);
        overlayContext.closePath();
        overlayContext.fill();
      }
    }

    if (miniOverlayContext && miniOverlayCanvas && duration) {
      const miniWidth = miniOverlayCanvas.width;
      const miniHeight = miniOverlayCanvas.height;
      const miniPlayheadTime = Math.min(duration, Math.max(0, Number(playheadTime) || 0));
      const miniPlayheadX = (miniPlayheadTime / duration) * miniWidth;
      miniOverlayContext.strokeStyle = '#ef4444';
      miniOverlayContext.lineWidth = 1.5;
      miniOverlayContext.beginPath();
      miniOverlayContext.moveTo(miniPlayheadX + 0.5, 1);
      miniOverlayContext.lineTo(miniPlayheadX + 0.5, miniHeight - 1);
      miniOverlayContext.stroke();
    }
  }

  function updateEditorTransportReadout(playheadTime, sourceEditor = audioEditorRef.current) {
    if (!editorTransportTimeRef.current) return;
    editorTransportTimeRef.current.textContent = formatEditorTime(snapEditorTimeToFrame(playheadTime || 0, sourceEditor));
  }

  function commitEditorPlaybackPosition(playheadTime, sourceEditor = audioEditorRef.current, extra = {}) {
    if (!sourceEditor) return 0;
    const normalizedTime = snapEditorTimeToFrame(playheadTime || 0, sourceEditor);
    const nextEditor = { ...sourceEditor, ...extra, currentTime: normalizedTime };
    editorPlaybackSnapshotRef.current = {
      currentTime: normalizedTime,
      playbackMarkerTime: Number.isFinite(Number(nextEditor.playbackMarkerTime)) ? Number(nextEditor.playbackMarkerTime) : null
    };
    drawEditorRealtimeOverlay(nextEditor, normalizedTime);
    updateEditorTransportReadout(normalizedTime, nextEditor);
    editorPlaybackStateSyncRef.current = performance.now();
    setAudioEditor((current) => current ? editorWithPlaybackFollow(current, normalizedTime, extra) : current);
    return normalizedTime;
  }

  useEffect(() => {
    drawEditorRealtimeOverlay(audioEditor, editorPlaybackSnapshotRef.current.currentTime);
    updateEditorTransportReadout(editorPlaybackSnapshotRef.current.currentTime, audioEditor);
  }, [audioEditor?.duration, audioEditor?.zoom, audioEditor?.visibleStart, audioEditor?.currentTime, audioEditor?.playbackMarkerTime]);

  useEffect(() => {
    if (!audioEditor?.nativeWaveformOnly || !audioEditor.sourcePath) return;
    const targetPoints = nativeWaveformPointsForZoom(audioEditor.zoom);
    const level = selectNativeWaveformLevel(audioEditor.nativeWaveformLevels, targetPoints);
    if (!level) return;
    const nextPointCount = Number(level.point_count || level.pointCount) || 0;
    if (!nextPointCount || audioEditor.nativeWaveformActivePointCount === nextPointCount) return;
    const nextSegment = createNativeEditorSegment(audioEditor.sourcePath, level);
    setAudioEditor((current) => current?.sourcePath === audioEditor.sourcePath
      ? {
        ...current,
        segments: current.segments?.length ? current.segments.map((segment) => ({
          ...segment,
          wavePeaks: sliceNativeEditorSegment(nextSegment, segment.sourceStart || 0, segment.sourceEnd || segment.duration || 0)?.wavePeaks || segment.wavePeaks
        })) : [nextSegment],
        duration: current.segments?.length ? nativeEditorDurationFromSegments(current.segments) : nextSegment.duration || current.duration,
        nativeWaveformActivePointCount: nextPointCount
      }
      : current);
  }, [audioEditor?.nativeWaveformOnly, audioEditor?.sourcePath, audioEditor?.zoom, audioEditor?.nativeWaveformLevels, audioEditor?.segments]);

  useEffect(() => {
    if (!audioEditor) return undefined;
    const handleShortcut = (event) => {
      if (isEditorInputTarget(event.target)) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        jumpEditorHistory(-1);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        jumpEditorHistory(1);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyEditorSelection();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteEditorSelection();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectEditorFullRange();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteEditorSelection();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        toggleEditorPlayback();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [audioEditor, editorClipboard]);

  useEffect(() => {
    localStorage.setItem(EDITOR_SILENCE_SETTING_KEYS.seconds, String(normalizeSilenceCutSeconds(silenceCutSeconds)));
  }, [silenceCutSeconds]);

  useEffect(() => {
    localStorage.setItem(EDITOR_SILENCE_SETTING_KEYS.sensitivity, String(normalizeSilenceSensitivity(silenceSensitivity)));
  }, [silenceSensitivity]);

  useEffect(() => {
    localStorage.setItem(EDITOR_SILENCE_SETTING_KEYS.reserve, String(normalizeSilenceReserveSeconds(silenceReserveSeconds)));
  }, [silenceReserveSeconds]);

  useEffect(() => {
    if (!savePrompt && !drivePrompt && !silenceCutPrompt && !restartPromptOpen && !closePromptOpen && !quitAllPromptOpen && !timeCopyMenu && !filenameMenu && !editorPlaybackRateMenu && !editorFrameRateMenu && !editorSelectionMenu && !cacheMenuOpen && !autoSaveMenuOpen && !uploadedLocalCleanupHelpOpen && !settingsMenuOpen) return undefined;
    const closeBubble = (event) => {
      if (actionBubbleRef.current?.contains(event.target)) return;
      if (settingsButtonRef.current?.contains(event.target)) return;
      if (settingsMenuRef.current?.contains(event.target)) return;
      if (timeCopyMenuRef.current?.contains(event.target)) return;
      if (filenameMenuRef.current?.contains(event.target)) return;
      if (editorPlaybackRateMenuRef.current?.contains(event.target)) return;
      if (editorFrameRateMenuRef.current?.contains(event.target)) return;
      if (editorSelectionMenuRef.current?.contains(event.target)) return;
      if (cacheMenuRef.current?.contains(event.target)) return;
      if (autoSaveMenuRef.current?.contains(event.target)) return;
      if (uploadedLocalCleanupHelpRef.current?.contains(event.target)) return;
      setSavePrompt(null);
      setSilenceCutPrompt(null);
      setRestartPromptOpen(false);
      setClosePromptOpen(false);
      setQuitAllPromptOpen(false);
      setTimeCopyMenu(null);
      setFilenameMenu(null);
      setEditorPlaybackRateMenu(null);
      setEditorFrameRateMenu(null);
      setEditorSelectionMenu(null);
      setCacheMenuOpen(false);
      setAutoSaveMenuOpen(false);
      setUploadedLocalCleanupHelpOpen(false);
      setSettingsMenuOpen(false);
      closeAfterRecordingStopRef.current = false;
      quitAllAfterRecordingStopRef.current = false;
    };
    document.addEventListener('pointerdown', closeBubble);
    return () => document.removeEventListener('pointerdown', closeBubble);
  }, [savePrompt, drivePrompt, silenceCutPrompt, restartPromptOpen, closePromptOpen, quitAllPromptOpen, timeCopyMenu, filenameMenu, editorPlaybackRateMenu, editorFrameRateMenu, editorSelectionMenu, cacheMenuOpen, autoSaveMenuOpen, uploadedLocalCleanupHelpOpen, settingsMenuOpen]);

  useEffect(() => {
    if (!timeCopyMenu) return undefined;
    const closeTimeCopyMenu = (event) => {
      if (event.key === 'Escape') setTimeCopyMenu(null);
    };
    document.addEventListener('keydown', closeTimeCopyMenu);
    return () => document.removeEventListener('keydown', closeTimeCopyMenu);
  }, [timeCopyMenu]);

  useEffect(() => {
    if (!editorPlaybackRateMenu && !editorFrameRateMenu) return undefined;
    const closeEditorTimeMenus = (event) => {
      if (event.key === 'Escape') {
        setEditorPlaybackRateMenu(null);
        setEditorFrameRateMenu(null);
      }
    };
    document.addEventListener('keydown', closeEditorTimeMenus);
    return () => document.removeEventListener('keydown', closeEditorTimeMenus);
  }, [editorPlaybackRateMenu, editorFrameRateMenu]);

  useEffect(() => {
    if (!filenameMenu) return undefined;
    const closeFilenameMenu = (event) => {
      if (event.key === 'Escape') setFilenameMenu(null);
    };
    document.addEventListener('keydown', closeFilenameMenu);
    return () => document.removeEventListener('keydown', closeFilenameMenu);
  }, [filenameMenu]);

  useEffect(() => {
    if (!editorSelectionMenu) return undefined;
    const closeEditorSelectionMenu = (event) => {
      if (event.key === 'Escape') setEditorSelectionMenu(null);
    };
    document.addEventListener('keydown', closeEditorSelectionMenu);
    return () => document.removeEventListener('keydown', closeEditorSelectionMenu);
  }, [editorSelectionMenu]);

  useEffect(() => () => {
    window.clearTimeout(timeCopyNoticeTimerRef.current);
    stopUploadProgressTimer();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    stopEverything();
  }, [audioUrl]);

  function generateFilename(extension) {
    return `${buildFilenameBase()}.${extension}`;
  }

  function generateCacheFilename(extension = 'webm') {
    const presetIndex = Math.max(0, presets.findIndex((preset) => preset.id === activePresetId));
    const presetName = (sanitizePart(currentPreset.title) || DEFAULT_PRESET.title).slice(0, 8);
    const presetCode = activePresetId === DEFAULT_PRESET_ID ? 'D' : `P${presetIndex}`;
    return `${presetCode}_${presetName}_${generateFilename(extension)}`;
  }

  function selectedMicrophoneEntries() {
    const activeDeviceId = microphoneSlots[activeMicrophoneSlot];
    return [{
      slot: activeMicrophoneSlot,
      deviceId: activeMicrophoneSlot === 0 ? (activeDeviceId || 'default') : activeDeviceId
    }].filter((entry) => entry.deviceId);
  }

  async function refreshMicrophoneDevices(requestPermission = false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatus('当前环境无法读取麦克风设备列表');
      return;
    }
    let permissionStream = null;
    try {
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophoneDevices(devices.filter((device) => device.kind === 'audioinput'));
    } catch (error) {
      console.warn('读取麦克风设备失败:', error);
      setStatus(`读取麦克风设备失败: ${error?.message || error}`);
    } finally {
      permissionStream?.getTracks?.().forEach((track) => track.stop());
    }
  }

  function updateMicrophoneSlot(slotIndex, deviceId) {
    setMicrophoneSlots((items) => items.map((item, index) => {
      if (index !== slotIndex) return item;
      return slotIndex === 0 ? (deviceId || 'default') : deviceId;
    }));
  }

  function openStartDatePicker() {
    const picker = startDatePickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
      return;
    }
    picker.click();
  }

  function microphoneLabel(device, index) {
    return device.label || `麦克风设备 ${index + 1}`;
  }

  function compactMicrophoneName(name) {
    return String(name || '')
      .replace(/\s*[\(（][^\)）]*[\)）]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function microphoneSlotDeviceName(slotIndex) {
    const deviceId = microphoneSlots[slotIndex];
    if (slotIndex === 0 && (!deviceId || deviceId === 'default')) return '系统默认麦克风';
    if (!deviceId) return '空';
    if (deviceId === 'default') return '系统默认麦克风';
    const deviceIndex = microphoneDevices.findIndex((device) => device.deviceId === deviceId);
    if (deviceIndex >= 0) return compactMicrophoneName(microphoneLabel(microphoneDevices[deviceIndex], deviceIndex));
    return '已绑定麦克风';
  }

  function microphoneSlotTooltip(slotIndex) {
    return `${slotIndex}号：${microphoneSlotDeviceName(slotIndex)}`;
  }

  function isMicrophoneSlotMissing(slotIndex) {
    const deviceId = microphoneSlots[slotIndex];
    if (slotIndex === 0 && (!deviceId || deviceId === 'default')) return false;
    if (!deviceId) return true;
    if (deviceId === 'default') return false;
    if (!microphoneDevices.length) return false;
    return !microphoneDevices.some((device) => device.deviceId === deviceId);
  }

  function microphoneSlotStateClass(slotIndex) {
    return `${microphoneSlots[slotIndex] ? 'filled' : ''} ${isMicrophoneSlotMissing(slotIndex) ? 'missing' : ''}`.trim();
  }

  function openMicrophoneSlot(slotIndex) {
    setActiveMicrophoneSlot(slotIndex);
    refreshMicrophoneDevices(true);
  }

  function selectTitleMicrophoneSlot(slotIndex) {
    setActiveMicrophoneSlot(slotIndex);
    setTitleMicrophonePickerOpen(false);
  }

  // lamejs 接收 Int16 PCM；麦克风 Float32 采样需要先转换。
  function encodeMp3Samples(floatSamples) {
    const encoder = mp3EncoderRef.current;
    if (!encoder || !floatSamples?.length) return;
    const samples = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
      samples[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    const buffer = encoder.encodeBuffer(samples);
    if (buffer.length > 0) mp3DataRef.current.push(new Int8Array(buffer));
  }

  // 优先使用 AudioWorklet 收集 PCM；旧环境退回 ScriptProcessor。
  async function createMp3Processor(audioContext, source) {
    if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await audioContext.audioWorklet.addModule('/AudioRecorderWorklet.js');
        const node = new AudioWorkletNode(audioContext, 'audio-recorder-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        });
        let flushResolver = null;
        node.port.onmessage = (event) => {
          if (event.data?.type === 'samples') encodeMp3Samples(event.data.samples);
          if (event.data?.type === 'flushed' && flushResolver) {
            flushResolver();
            flushResolver = null;
          }
        };
        const mutedGain = audioContext.createGain();
        mutedGain.gain.value = 0;
        source.connect(node);
        node.connect(mutedGain);
        mutedGain.connect(audioContext.destination);
        return {
          async flush() {
            if (flushResolver) return;
            await new Promise((resolve) => {
              flushResolver = resolve;
              node.port.postMessage({ type: 'flush' });
              setTimeout(resolve, 250);
            });
          },
          disconnect() {
            node.disconnect();
            mutedGain.disconnect();
          }
        };
      } catch (error) {
        console.warn('AudioWorklet 加载失败，已回退到 ScriptProcessor。', error);
      }
    }

    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    const mutedGain = audioContext.createGain();
    mutedGain.gain.value = 0;
    processor.onaudioprocess = (event) => encodeMp3Samples(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    processor.connect(mutedGain);
    mutedGain.connect(audioContext.destination);
    return {
      flush: async () => {},
      disconnect() {
        processor.disconnect();
        mutedGain.disconnect();
      }
    };
  }

  async function captureMicrophoneStream(entry) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: entry.deviceId === 'default' ? true : { deviceId: { exact: entry.deviceId } }
      });
    } catch (error) {
      throw new Error(`${entry.slot} 号麦克风启动失败: ${error?.message || error}`);
    }
  }

  function startTimer() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setTotalSeconds((value) => value + 1), 1000);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function stopAutoCacheTimer() {
    clearInterval(cacheTimerRef.current);
    cacheTimerRef.current = null;
    cacheSaveInFlightRef.current = false;
  }

  function startAutoCacheTimer(mimeType = 'audio/webm') {
    stopAutoCacheTimer();
    cacheMimeTypeRef.current = mimeType;
    if (!autoCacheRef.current) return;
    const intervalMs = Math.max(1, cacheIntervalRef.current || DEFAULT_CACHE_INTERVAL) * 1000;
    cacheTimerRef.current = window.setInterval(saveRecordingCache, intervalMs);
  }

  async function saveRecordingCache() {
    const recorder = mediaRecorderRef.current;
    if (!autoCacheRef.current || !recorder || recorder.state !== 'recording' || cacheSaveInFlightRef.current) return;

    try {
      recorder.requestData?.();
    } catch (error) {
      console.warn('请求缓存录音数据失败:', error);
    }

    window.setTimeout(async () => {
      if (cacheSaveInFlightRef.current || !chunksRef.current.length) return;
      cacheSaveInFlightRef.current = true;
      try {
        const startIndex = cacheWrittenChunkCountRef.current;
        const endIndex = chunksRef.current.length;
        const newChunks = chunksRef.current.slice(startIndex, endIndex);
        if (!newChunks.length) return;
        const cacheBlob = new Blob(newChunks, { type: cacheMimeTypeRef.current || 'audio/webm' });
        const base64Data = await blobToBase64(cacheBlob);
        const saveDir = saveDirectory.trim() || null;
        const savedCachePath = await invoke('save_cache_file_chunk', {
          filename: cacheFilenameRef.current || generateFilename('webm'),
          base64Data,
          saveDir,
          appendExisting: cacheFileReservedRef.current
        });
        cacheWrittenChunkCountRef.current = Math.max(cacheWrittenChunkCountRef.current, endIndex);
        if (!cacheFileReservedRef.current) {
          cacheFileReservedRef.current = true;
          cacheFilenameRef.current = String(savedCachePath).split(/[\\/]/).pop() || cacheFilenameRef.current;
          cacheSavedFilenameRef.current = cacheFilenameRef.current;
        }
      } catch (error) {
        console.warn('自动缓存失败:', error);
        setStatus(`自动缓存失败: ${error?.message || error}`);
      } finally {
        cacheSaveInFlightRef.current = false;
      }
    }, 250);
  }

  async function deleteCurrentRecordingCache() {
    const filename = cacheSavedFilenameRef.current;
    if (!filename || !isTauriRuntime()) return false;
    try {
      const deleted = await invoke('delete_cache_file', {
        filename,
        saveDir: saveDirectory.trim() || null
      });
      if (deleted) {
        cacheSavedFilenameRef.current = '';
        cacheFilenameRef.current = '';
        cacheFileReservedRef.current = false;
        cacheWrittenChunkCountRef.current = 0;
      }
      return Boolean(deleted);
    } catch (error) {
      console.warn('删除本次缓存失败:', error);
      return false;
    }
  }

  async function cleanupExpiredRecordingCache(showResult = false) {
    if (!isTauriRuntime()) return;
    if (cacheRetentionDaysRef.current === 0) {
      if (showResult) setStatus('当前设置为不自动清理缓存');
      return;
    }
    const sourcePaths = [
      audioEditor?.originalSourcePath,
      audioEditor?.sourcePath,
      audioEditor?.playbackPath,
      lastSavedAudio?.path
    ].filter(Boolean);
    try {
      const deletedCount = await invoke('cleanup_cache_files', {
        saveDir: saveDirectory.trim() || null,
        retentionDays: cacheRetentionDaysRef.current,
        protectedFilename: cacheSavedFilenameRef.current || null,
        sourcePaths
      });
      if (showResult) setStatus(`已清理 ${deletedCount} 个过期缓存`);
    } catch (error) {
      console.warn('清理过期缓存失败:', error);
      if (showResult) setStatus(`清理过期缓存失败: ${error?.message || error}`);
    }
  }

  async function cleanExpiredCacheNow() {
    await cleanupExpiredRecordingCache(true);
    setCacheMenuOpen(false);
  }

  async function clearWaveformCacheNow() {
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法清空音波缓存');
      setCacheMenuOpen(false);
      return;
    }
    try {
      const deletedCount = await invoke('clear_editor_waveform_cache', {
        saveDir: saveDirectory.trim() || null
      });
      setStatus(`已清空音波缓存，共删除 ${deletedCount} 个文件`);
    } catch (error) {
      console.warn('清空音波缓存失败:', error);
      setStatus(`清空音波缓存失败: ${error?.message || error}`);
    } finally {
      setCacheMenuOpen(false);
    }
  }

  async function connectGoogleDrive() {
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法连接 Google Drive');
      return;
    }
    if (!googleDriveClientId.trim()) {
      setStatus('请先填写 Google OAuth Client ID');
      return;
    }
    setGoogleDriveBusy(true);
    setGoogleDriveMessage('正在等待 Google 授权...');
    setStatus('正在连接 Google Drive');
    try {
      const nextStatus = await invoke('google_drive_connect', {
        clientId: googleDriveClientId.trim(),
        clientSecret: googleDriveClientSecret.trim() || null
      });
      setGoogleDriveStatus(nextStatus);
      setGoogleDriveMessage(`已连接：${nextStatus.email || 'Google 用户'}`);
      setStatus(`Google Drive 已连接：${nextStatus.email || 'Google 用户'}`);
    } catch (error) {
      const message = `连接失败：${error?.message || error}`;
      setGoogleDriveMessage(message);
      setStatus(`Google Drive ${message}`);
    } finally {
      setGoogleDriveBusy(false);
    }
  }

  async function cancelGoogleDriveConnect() {
    if (!isTauriRuntime()) return;
    setGoogleDriveMessage('正在取消 Google 授权...');
    setStatus('正在取消 Google Drive 授权');
    try {
      await invoke('google_drive_cancel_connect');
    } catch (error) {
      const message = `取消授权失败：${error?.message || error}`;
      setGoogleDriveMessage(message);
      setStatus(`Google Drive ${message}`);
    }
  }

  async function importGoogleDriveClientJson() {
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法导入 OAuth JSON');
      return;
    }
    try {
      const config = await invoke('select_google_oauth_client_file');
      if (!config) return;
      setGoogleDriveClientId(config.client_id || '');
      setGoogleDriveClientSecret(config.client_secret || '');
      const secretText = config.client_secret ? '已自动填入 Client Secret' : 'JSON 中没有 Client Secret';
      const typeText = config.client_type === 'web' ? 'Web 客户端' : '桌面客户端';
      setGoogleDriveMessage(`已导入 ${typeText}：${secretText}`);
      setStatus('已导入 Google OAuth JSON');
    } catch (error) {
      const message = `导入失败：${error?.message || error}`;
      setGoogleDriveMessage(message);
      setStatus(`Google OAuth JSON ${message}`);
    }
  }

  async function disconnectGoogleDrive() {
    if (!isTauriRuntime()) return;
    setGoogleDriveBusy(true);
    try {
      await invoke('google_drive_disconnect');
      setGoogleDriveStatus({ connected: false, email: '' });
      setGoogleDriveMessage('已断开连接');
      setStatus('Google Drive 已断开');
    } catch (error) {
      const message = `断开失败：${error?.message || error}`;
      setGoogleDriveMessage(message);
      setStatus(`Google Drive ${message}`);
    } finally {
      setGoogleDriveBusy(false);
    }
  }

  function stopUploadProgressTimer() {
    window.clearTimeout(uploadProgressTimerRef.current);
    uploadProgressTimerRef.current = null;
  }

  function startUploadProgress(filename) {
    stopUploadProgressTimer();
    const uploadId = uploadProgressIdRef.current + 1;
    uploadProgressIdRef.current = uploadId;
    setUploadProgress({ id: uploadId, filename, percent: 0, state: 'uploading' });
    return uploadId;
  }

  function finishUploadProgress(uploadId, state) {
    stopUploadProgressTimer();
    setUploadProgress((current) => {
      if (!current || current.id !== uploadId) return current;
      return { ...current, percent: state === 'done' ? 100 : current.percent, state };
    });
    uploadProgressTimerRef.current = window.setTimeout(() => {
      setUploadProgress((current) => (current?.id === uploadId ? null : current));
      uploadProgressTimerRef.current = null;
    }, state === 'done' ? 1600 : 2800);
  }

  function currentMp3Filename() {
    return generateFilename('mp3');
  }

  function matchesCurrentAudio(record) {
    const currentFilename = currentMp3Filename();
    return Boolean(record && (record.displayFilename === currentFilename || record.filename === currentFilename));
  }

  function currentUploadedAudio() {
    return matchesCurrentAudio(lastUploadedAudio) ? lastUploadedAudio : null;
  }

  function openFilenameMenu(event) {
    event.preventDefault();
    setTimeCopyMenu(null);
    setCacheMenuOpen(false);
    setFilenameMenu({
      x: event.clientX,
      y: event.clientY
    });
  }

  function uploadSavedAudioToGoogleDrive(savedPath, filename, displayFilename = filename, options = {}) {
    if ((!googleDriveAutoUpload && !options.force) || !savedPath || !isTauriRuntime()) return;
    if (!googleDriveStatus.connected) {
      setStatus('本地已保存，Google Drive 未连接');
      return;
    }
    const uploadId = startUploadProgress(filename);
    setStatus(`已保存本地，后台上传 Google Drive：${filename}`);
    const folderId = googleDriveFolderIdFromInput(googleDriveFolderId);
    const folderLink = googleDriveFolderLinkFromInput(googleDriveFolderId);
    invoke('upload_google_drive_file', {
        path: savedPath,
        filename,
        folderId: folderId || null,
        sharePublic: googleDrivePublicShare,
        uploadId
      })
      .then((uploadResult) => {
        const fileLink = normalizeDriveUploadLink(uploadResult);
        const uploaded = { filename, displayFilename, savedPath, fileLink, folderLink };
        setLastUploadedAudio(uploaded);
        setSavePrompt(null);
        setDrivePrompt(uploaded);
        finishUploadProgress(uploadId, 'done');
        setStatus(`已上传到 Google Drive：${filename}`);
        handleUploadedLocalAudioCleanup(uploaded, options);
      })
      .catch((error) => {
        finishUploadProgress(uploadId, 'failed');
        setStatus(`本地已保存，Google Drive 上传失败: ${error?.message || error}`);
      });
  }

  function uploadedLocalFilesStorageKey() {
    return presetKey('uploadedLocalFiles');
  }

  function readUploadedLocalFilesLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(uploadedLocalFilesStorageKey()) || '[]');
      return Array.isArray(parsed)
        ? parsed
          .map((entry) => ({
            path: String(entry?.path || '').trim(),
            uploadedAt: Number(entry?.uploadedAt) || 0
          }))
          .filter((entry) => entry.path && entry.uploadedAt)
        : [];
    } catch {
      return [];
    }
  }

  function writeUploadedLocalFilesLog(entries) {
    const seen = new Set();
    const cleaned = [];
    entries
      .filter((entry) => entry?.path)
      .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
      .forEach((entry) => {
        const key = entry.path.toLocaleLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        cleaned.push({ path: entry.path, uploadedAt: entry.uploadedAt || Date.now() });
      });
    localStorage.setItem(uploadedLocalFilesStorageKey(), JSON.stringify(cleaned.slice(0, UPLOADED_LOCAL_FILES_LOG_LIMIT)));
  }

  function rememberUploadedLocalFile(path) {
    if (!path) return;
    writeUploadedLocalFilesLog([
      { path, uploadedAt: Date.now() },
      ...readUploadedLocalFilesLog()
    ]);
  }

  async function deleteUploadedLocalAudioFile(path) {
    if (!path || !isTauriRuntime()) return false;
    try {
      return Boolean(await invoke('delete_uploaded_local_audio_file', {
        path,
        saveDir: saveDirectory.trim() || null
      }));
    } catch (error) {
      console.warn('删除已上传本地音频失败:', error);
      return false;
    }
  }

  async function cleanupExpiredUploadedLocalFiles(showResult = false) {
    if (!isTauriRuntime()) return;
    const retentionDays = uploadedLocalRetentionDaysRef.current;
    if (retentionDays === 0) {
      if (showResult) setStatus('当前设置为不自动清理已上传本地文件');
      return;
    }
    const maxAge = retentionDays * 86_400_000;
    const now = Date.now();
    const entries = readUploadedLocalFilesLog();
    let deletedCount = 0;
    const kept = [];
    for (const entry of entries) {
      if (now - entry.uploadedAt <= maxAge) {
        kept.push(entry);
        continue;
      }
      const deleted = await deleteUploadedLocalAudioFile(entry.path);
      if (deleted) {
        deletedCount += 1;
      } else {
        kept.push(entry);
      }
    }
    writeUploadedLocalFilesLog(kept);
    if (showResult) setStatus(`已清理 ${deletedCount} 个过期已上传本地文件`);
  }

  async function handleUploadedLocalAudioCleanup(uploaded, options = {}) {
    if (!uploaded?.savedPath || options.allowLocalFileCleanup === false) return;
    rememberUploadedLocalFile(uploaded.savedPath);
    if (deleteLocalAfterUploadRef.current) {
      const deleted = await deleteUploadedLocalAudioFile(uploaded.savedPath);
      if (deleted) {
        writeUploadedLocalFilesLog(readUploadedLocalFilesLog().filter((entry) => entry.path.toLocaleLowerCase() !== uploaded.savedPath.toLocaleLowerCase()));
        if (lastSavedAudio?.path === uploaded.savedPath) {
          setLastSavedAudio(null);
          setLastSavedPath('');
        }
        setStatus(`已上传到 Google Drive，并删除本地文件：${uploaded.filename}`);
        return;
      }
      setStatus(`已上传到 Google Drive，本地文件未删除：${uploaded.filename}`);
      return;
    }
    cleanupExpiredUploadedLocalFiles(false);
  }

  async function cleanExpiredUploadedLocalFilesNow() {
    await cleanupExpiredUploadedLocalFiles(true);
    setAutoSaveMenuOpen(false);
  }

  async function uploadCurrentAudioFromMenu() {
    setFilenameMenu(null);
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法上传 Google Drive');
      return;
    }
    if (!googleDriveStatus.connected) {
      setStatus('请先连接 Google Drive');
      setSettingsOpen(true);
      return;
    }

    const displayFilename = currentMp3Filename();
    const savedAudio = matchesCurrentAudio(lastSavedAudio) ? lastSavedAudio : null;
    let uploadPath = savedAudio?.path || '';
    let uploadFilename = savedAudio?.filename || displayFilename;
    if (!uploadPath) {
      if (!mp3Blob) {
        setStatus('当前没有可上传的 MP3 音频');
        return;
      }
      uploadPath = await saveBlob(mp3Blob, displayFilename, { autoUpload: false });
      const savedFilename = String(uploadPath).split(/[\\/]/).pop() || displayFilename;
      uploadFilename = savedFilename;
    }
    if (!uploadPath) return;

    uploadSavedAudioToGoogleDrive(uploadPath, uploadFilename, displayFilename, { force: true });
  }

  async function uploadExternalAudioPath(filePath, options = {}) {
    if (!filePath || !isTauriRuntime()) return false;
    const filename = filenameFromPath(filePath);
    const targetPresetId = options.presetId || activePresetId;
    const targetFolderInput = localStorage.getItem(presetStorageKey(targetPresetId, 'googleDriveFolderId')) || '';
    const targetPublicShare = localStorage.getItem(presetStorageKey(targetPresetId, 'googleDrivePublicShare')) === 'true';
    const targetPreset = presets.find((preset) => preset.id === targetPresetId);
    const targetPresetTitle = targetPreset ? presetDisplayTitle(targetPreset) : '';
    let uploadId = 0;
    try {
      const nextStatus = await invoke('google_drive_status');
      setGoogleDriveStatus(nextStatus);
      if (!nextStatus.connected) {
        setStatus('请先连接 Google Drive 后再上传音频');
        setSettingsOpen(true);
        return false;
      }
      uploadId = startUploadProgress(filename);
      const folderId = googleDriveFolderIdFromInput(targetFolderInput);
      const folderLink = googleDriveFolderLinkFromInput(targetFolderInput);
      const queuePrefix = options.totalCount > 1 ? ` (${options.queueIndex + 1}/${options.totalCount})` : '';
      options.onUploadStart?.({ filename, presetTitle: targetPresetTitle, filePath });
      setStatus(`${targetPresetTitle ? `${targetPresetTitle} · ` : ''}正在后台上传 Google Drive${queuePrefix}：${filename}`);
      const uploadResult = await invoke('upload_google_drive_file', {
        path: filePath,
        filename,
        folderId: folderId || null,
        sharePublic: targetPublicShare,
        uploadId
      });
      const fileLink = normalizeDriveUploadLink(uploadResult);
      const uploaded = { filename, displayFilename: filename, savedPath: filePath, fileLink, folderLink };
      setLastUploadedAudio(uploaded);
      setDrivePrompt(uploaded);
      finishUploadProgress(uploadId, 'done');
      options.onUploadDone?.(uploaded);
      setStatus(`已上传到 Google Drive${queuePrefix}：${filename}`);
      return uploaded;
    } catch (error) {
      if (uploadId) finishUploadProgress(uploadId, 'failed');
      setStatus(`Google Drive 上传失败：${error?.message || error}`);
      return false;
    }
  }

  async function showWindowForShellAction() {
    if (!isTauriRuntime()) return;
    try {
      recorderWindowShownRef.current = true;
      setWindowReady(true);
      const appWindow = getCurrentWindow();
      await appWindow.unminimize().catch(() => {});
      await appWindow.show().catch(() => {});
      await appWindow.setFocus().catch(() => {});
    } catch (error) {
      console.warn('显示右键菜单动作窗口失败:', error);
    }
  }

  function shellActionIdentifier(action) {
    const paths = shellActionFilePaths(action);
    return action?.actionId || action?.action_id || [
      action?.actionType || action?.action_type || '',
      action?.presetId || action?.preset_id || activePresetId,
      paths.join('|')
    ].join('|');
  }

  async function handleShellActionOnce(action) {
    const id = shellActionIdentifier(action);
    if (!id || handledShellActionIdsRef.current.has(id)) return;
    shellActionInstanceRef.current = true;
    handledShellActionIdsRef.current.add(id);
    await handleShellAction(action);
  }

  function mergeUniqueFilePaths(basePaths, nextPaths) {
    const seen = new Set();
    const merged = [];
    [...basePaths, ...nextPaths].forEach((path) => {
      const cleaned = String(path || '').trim();
      const key = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(key)) return;
      seen.add(key);
      merged.push(cleaned);
    });
    return merged;
  }

  async function readShellUploadQueuePaths(targetPresetId) {
    if (!isTauriRuntime()) return [];
    try {
      const paths = await invoke('read_shell_upload_queue', { presetId: targetPresetId });
      return Array.isArray(paths) ? paths.map((path) => String(path || '').trim()).filter(Boolean) : [];
    } catch (error) {
      console.warn('读取右键上传队列失败:', error);
      return [];
    }
  }

  async function clearShellUploadQueue(targetPresetId) {
    if (!isTauriRuntime()) return;
    try {
      await invoke('clear_shell_upload_queue', { presetId: targetPresetId });
    } catch (error) {
      console.warn('清空右键上传队列失败:', error);
    }
  }

  async function handleShellAction(action) {
    const actionType = action?.actionType || action?.action_type;
    const filePaths = shellActionFilePaths(action);
    const filePath = filePaths[0] || '';
    const targetPresetId = action?.presetId || action?.preset_id || activePresetId;
    const actionId = action?.actionId || action?.action_id || makeShellActionId(actionType, targetPresetId, filePath);
    if (!actionType || !filePath) return;

    if (actionType === 'upload') {
      const targetPreset = presets.find((preset) => preset.id === targetPresetId) || DEFAULT_PRESET;
      const nextTitle = presetDisplayTitle(targetPreset);
      setShellActionPresetInfo({
        icon: targetPreset.icon || DEFAULT_PRESET.icon,
        title: nextTitle
      });
      getCurrentWindow().setTitle(nextTitle).catch((error) => console.warn('同步右键上传窗口标题失败:', error));
    }

    if (actionType === 'edit') {
      await showWindowForShellAction();
      await openAudioEditor(null, {
        path: filePath,
        filename: editorMp3FilenameFromPath(filePath)
      });
      return;
    }

    if (actionType === 'upload') {
      await showWindowForShellAction();
      await delay(900);

      const targetPreset = presets.find((preset) => preset.id === targetPresetId) || DEFAULT_PRESET;
      const targetPresetTitle = presetDisplayTitle(targetPreset);
      let queuedPaths = mergeUniqueFilePaths(filePaths, await readShellUploadQueuePaths(targetPresetId));
      const processedPaths = new Set();
      let successCount = 0;
      let idleReads = 0;
      let cursor = 0;
      let lastUploaded = null;

      setShellUploadSummary({
        presetTitle: targetPresetTitle,
        currentFilename: queuedPaths[0] ? filenameFromPath(queuedPaths[0]) : '等待上传...',
        completed: 0,
        total: queuedPaths.length,
        uploadItems: queuedPaths.map((path) => ({
          filePath: path,
          filename: filenameFromPath(path),
          link: '',
          state: 'pending'
        }))
      });

      while (cursor < queuedPaths.length || idleReads < 2) {
        if (cursor < queuedPaths.length) {
          const currentPath = queuedPaths[cursor];
          const currentKey = currentPath.toLocaleLowerCase();
          cursor += 1;
          if (processedPaths.has(currentKey)) continue;
          processedPaths.add(currentKey);

          const queueIndex = processedPaths.size - 1;
          const currentFilename = filenameFromPath(currentPath);
          setShellUploadSummary((current) => ({
            ...current,
            presetTitle: targetPresetTitle,
            currentFilename,
            completed: successCount,
            total: Math.max(queuedPaths.length, current?.total || 0),
            uploadItems: (current?.uploadItems || []).map((item) => (
              item.filePath === currentPath ? { ...item, state: 'uploading' } : item
            ))
          }));

          const uploaded = await uploadExternalAudioPath(currentPath, {
            presetId: targetPresetId,
            actionId: `${actionId}:${queueIndex}`,
            queueIndex,
            totalCount: queuedPaths.length,
            onUploadStart: ({ filename }) => {
              setShellUploadSummary((current) => ({
                ...current,
                presetTitle: targetPresetTitle,
                currentFilename: filename,
                completed: successCount,
                total: Math.max(queuedPaths.length, current?.total || 0)
              }));
            },
            onUploadDone: (uploadedAudio) => {
              lastUploaded = uploadedAudio;
              setShellUploadSummary((current) => ({
                ...current,
                completed: successCount + 1,
                uploadItems: (current?.uploadItems || []).map((item) => (
                  item.filePath === currentPath
                    ? { ...item, link: uploadedAudio?.fileLink || '', state: uploadedAudio?.fileLink ? 'done' : 'uploaded' }
                    : item
                ))
              }));
            }
          });
          if (uploaded) {
            successCount += 1;
            lastUploaded = uploaded;
          } else {
            setShellUploadSummary((current) => ({
              ...current,
              uploadItems: (current?.uploadItems || []).map((item) => (
                item.filePath === currentPath ? { ...item, state: 'failed' } : item
              ))
            }));
          }
          idleReads = 0;
          continue;
        }

        await delay(650);
        const latestQueuedPaths = await readShellUploadQueuePaths(targetPresetId);
        const mergedPaths = mergeUniqueFilePaths(queuedPaths, latestQueuedPaths);
        if (mergedPaths.length > queuedPaths.length) {
          queuedPaths = mergedPaths;
          idleReads = 0;
          setShellUploadSummary((current) => ({
            ...current,
            total: queuedPaths.length,
            uploadItems: queuedPaths.map((path) => {
              const existing = (current?.uploadItems || []).find((item) => item.filePath === path);
              return existing || {
                filePath: path,
                filename: filenameFromPath(path),
                link: '',
                state: 'pending'
              };
            })
          }));
        } else {
          idleReads += 1;
        }
      }

      await clearShellUploadQueue(targetPresetId);
      setShellUploadSummary((current) => ({
        ...current,
        currentFilename: lastUploaded?.filename || current?.currentFilename || '',
        completed: successCount,
        total: processedPaths.size
      }));
      if (processedPaths.size > 1) {
        setStatus(`右键上传完成：成功 ${successCount}/${processedPaths.size}`);
      }
    }
  }

  function revokeAudioEditorUrls(editor) {
    if (!editor) return;
    const urls = new Set([
      editor.url,
      ...(editor.history || []).map((entry) => entry.url)
    ].filter(Boolean));
    urls.forEach((url) => URL.revokeObjectURL(url));
  }

  async function resizeAudioEditorWindow() {
    if (!isTauriRuntime()) return;
    editorWindowModeRef.current = true;
    try {
      const appWindow = getCurrentWindow();
      await getCurrentWebview().setZoom(1);
      await appWindow.setMinSize(editorWindowSize);
      await appWindow.setSize(editorWindowSize);
      await appWindow.setFocus();
      window.setTimeout(async () => {
        if (!editorWindowModeRef.current) return;
        await appWindow.setMinSize(editorWindowSize).catch(() => {});
        await appWindow.setSize(editorWindowSize).catch(() => {});
      }, 180);
    } catch (error) {
      console.warn('打开音频编辑窗口尺寸失败:', error);
    }
  }

  async function restoreRecorderWindowSize() {
    editorWindowModeRef.current = false;
    await resizeDesktopWindow(layoutMode, globalWindowScale);
  }

  async function openAudioEditor(sourceBlob = mp3Blob, options = {}) {
    setFilenameMenu(null);
    if (isRecordingRef.current && !options.fromRecordingStop) {
      setStatus('录音中暂不能打开音频编辑');
      return;
    }

    const matchedSavedAudio = matchesCurrentAudio(lastSavedAudio) ? lastSavedAudio : null;
    const fallbackSavedAudio = !sourceBlob && lastSavedAudio?.path ? lastSavedAudio : null;
    const savedAudio = options.path ? null : (matchedSavedAudio || fallbackSavedAudio);
    const sourcePath = options.path || savedAudio?.path || (!sourceBlob ? lastSavedPath : '');
    let playbackPath = options.playbackPath || '';
    if (!sourceBlob && !sourcePath) {
      setStatus('没有可编辑的录音');
      return;
    }
    if (!sourcePath && !window.AudioContext && !window.webkitAudioContext) {
      setStatus('当前环境不支持音频编辑');
      return;
    }

    const token = editorDecodeTokenRef.current + 1;
    editorDecodeTokenRef.current = token;
    editorWindowModeRef.current = true;
    revokeAudioEditorUrls(audioEditor);
    const editorFilenameSource = options.filename
      || savedAudio?.displayFilename
      || savedAudio?.filename
      || (sourcePath ? filenameFromPath(sourcePath) : '')
      || generateFilename('mp3');
    const filename = editorMp3FilenameFromPath(editorFilenameSource);
    await resizeAudioEditorWindow();

    if (isTauriRuntime() && sourcePath) {
      const editorCacheSaveDir = saveDirectory.trim() || null;
      if (!playbackPath) {
        const prepared = await invoke('prepare_audio_editor_file', { path: sourcePath, saveDir: editorCacheSaveDir });
        playbackPath = prepared?.playback_path || prepared?.playbackPath || sourcePath;
      }
      const analysisPath = playbackPath || sourcePath;
      const sourceUrl = convertFileSrc(playbackPath);
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setAudioEditor({
        open: true,
        sourceBlob: null,
        sourcePath: analysisPath,
        originalSourcePath: sourcePath,
        playbackPath,
        url: sourceUrl,
        filename,
        autoSaveAfterEdit: Boolean(options.autoSaveAfterEdit),
        loading: false,
        busy: false,
        error: '',
        audioBuffer: null,
        nativeWaveformOnly: true,
        nativeWaveformRequestId: requestId,
        nativeWaveformLevels: {},
        nativeWaveformActivePointCount: 0,
        segments: [createEmptyNativeEditorSegment(analysisPath, 0)],
        waveformProgress: { percent: 0, stage: '正在读取音频元数据' },
        duration: 0,
        selectionStart: 0,
        selectionEnd: 0,
        selectionRanges: [],
        activeSelectionIndex: -1,
        playbackMarkerTime: 0,
        previewMode: 'full',
        zoom: DEFAULT_EDITOR_ZOOM,
        visibleStart: 0,
        currentTime: 0,
        editorPlaying: false,
        history: [],
        historyIndex: -1
      });
      setStatus('已打开音频编辑界面，正在后台生成波形');

      try {
        const metadata = await invoke('read_native_audio_metadata', { path: analysisPath });
        if (editorDecodeTokenRef.current !== token) return;
        const durationValue = Math.max(0, Number(metadata?.duration_seconds || metadata?.durationSeconds) || 0);
        setAudioEditor((current) => current?.sourcePath === analysisPath
          ? {
              ...current,
              duration: durationValue,
              selectionStart: 0,
              selectionEnd: 0,
              selectionRanges: [],
              activeSelectionIndex: -1,
              segments: [createEmptyNativeEditorSegment(analysisPath, durationValue)],
              nativeWaveformActivePointCount: 0,
              waveformProgress: { percent: 1, stage: '正在检查波形缓存' }
            }
          : current);

        const firstResult = await invoke('load_native_audio_waveform_levels', {
          path: analysisPath,
          levels: [NATIVE_WAVEFORM_PREVIEW_POINTS],
          requestId,
          saveDir: editorCacheSaveDir
        });
        if (editorDecodeTokenRef.current !== token) return;
        const firstLevels = nativeWaveformLevelsByPoint(firstResult?.levels);
        const firstLevel = selectNativeWaveformLevel(firstLevels, NATIVE_WAVEFORM_PREVIEW_POINTS);
        if (firstLevel) {
          const firstSegment = createNativeEditorSegment(analysisPath, firstLevel);
          setAudioEditor((current) => current?.sourcePath === analysisPath
            ? (() => {
              const nextState = {
                ...current,
                duration: firstSegment.duration,
                segments: [firstSegment],
                nativeWaveformActivePointCount: firstSegment.wavePeaks.pointCount,
                nativeWaveformLevels: { ...(current.nativeWaveformLevels || {}), ...firstLevels },
                waveformProgress: { percent: 100, stage: firstLevel.cache_hit ? '已读取波形缓存' : '波形缓存完成' },
                history: [],
                historyIndex: -1
              };
              return {
                ...nextState,
                history: [nativeEditorHistoryEntry(nextState)],
                historyIndex: 0
              };
            })()
            : current);
        }

        // 长音频先只生成一层可用预览，避免同一文件被后台重复长扫造成卡顿。
      } catch (error) {
        console.warn('原生音频编辑打开失败:', error);
        setAudioEditor((current) => current?.sourcePath === analysisPath
          ? { ...current, error: `音频打开失败：${error?.message || error}`, waveformProgress: { percent: 100, stage: '波形生成失败' } }
          : current);
        setStatus(`音频编辑打开失败：${error?.message || error}`);
      }
      return;
    }

    const sourceUrl = URL.createObjectURL(sourceBlob);
    setAudioEditor({
      open: true,
      sourceBlob,
      sourcePath: '',
      url: sourceUrl,
      filename,
      autoSaveAfterEdit: Boolean(options.autoSaveAfterEdit),
      loading: true,
      busy: false,
      error: '',
      audioBuffer: null,
      duration: 0,
      selectionStart: 0,
      selectionEnd: 0,
      selectionRanges: [],
      activeSelectionIndex: -1,
      playbackMarkerTime: 0,
      previewMode: 'full',
      zoom: DEFAULT_EDITOR_ZOOM,
      visibleStart: 0,
      currentTime: 0,
      editorPlaying: false,
      history: [],
      historyIndex: -1
    });
    setStatus('正在打开音频编辑界面');

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const decodeContext = new AudioContextClass();
      const arrayBuffer = await sourceBlob.arrayBuffer();
      const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      await decodeContext.close?.();
      if (editorDecodeTokenRef.current !== token) {
        URL.revokeObjectURL(sourceUrl);
        return;
      }
      setAudioEditor((current) => current?.url === sourceUrl
        ? {
            ...current,
            loading: false,
            audioBuffer,
            sourceBlob,
            url: sourceUrl,
            duration: audioBuffer.duration,
            selectionStart: 0,
            selectionEnd: 0,
            selectionRanges: [],
            activeSelectionIndex: -1,
            history: [{ audioBuffer, blob: sourceBlob, url: sourceUrl }],
            historyIndex: 0
          }
        : current);
      setStatus(options.autoSaveAfterEdit ? '录音完成，请编辑后保存' : '已打开音频编辑界面');
    } catch (error) {
      console.warn('音频解码失败:', error);
      setAudioEditor((current) => current?.url === sourceUrl
        ? { ...current, loading: false, error: `音频解码失败：${error?.message || error}` }
        : current);
      setStatus(`音频编辑打开失败：${error?.message || error}`);
    }
  }

  async function closeAudioEditor() {
    editorDecodeTokenRef.current += 1;
    window.clearTimeout(editorZoomNoticeTimerRef.current);
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    setEditorZoomNoticeVisible(false);
    setAudioEditor((current) => {
      revokeAudioEditorUrls(current);
      return null;
    });
    await restoreRecorderWindowSize();
  }

  async function deleteEditorTemporaryAudioFiles(editor = audioEditor) {
    if (!editor || !isTauriRuntime()) return;
    const saveDir = saveDirectory.trim() || null;
    const temporaryPaths = Array.from(new Set([
      editor.sourcePath,
      editor.originalSourcePath,
      editor.playbackPath
    ].filter(Boolean)));

    await Promise.all(temporaryPaths.map((path) => invoke('delete_editor_audio_cache_file', { path, saveDir })
      .catch((error) => console.warn('删除编辑器临时音频缓存失败:', error))));
  }

  async function importAudioFileIntoEditor() {
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页暂不支持导入本地长音频');
      return;
    }
    if (isRecordingRef.current) {
      setStatus('录音中暂不能导入音频');
      return;
    }
    try {
      const imported = await invoke('select_audio_editor_file', { saveDir: saveDirectory.trim() || null });
      if (!imported) return;
      const path = imported.source_path || imported.sourcePath;
      const playbackPath = imported.playback_path || imported.playbackPath || path;
      await openAudioEditor(null, {
        path,
        playbackPath,
        filename: editorMp3FilenameFromPath(imported.filename || path)
      });
    } catch (error) {
      console.warn('导入音频失败:', error);
      setStatus(`导入音频失败：${error?.message || error}`);
      setAudioEditor((current) => current ? { ...current, error: `导入音频失败：${error?.message || error}` } : current);
    }
  }

  function updateEditorSelection(part, value) {
    setAudioEditor((current) => {
      if (!current) return current;
      const durationValue = current.duration || 0;
      const frameStep = editorFrameDuration(current);
      const nextValue = snapEditorTimeToFrame(value, current);
      const active = editorActiveSelectionRange(current);
      if (!active) return current;
      if (part === 'start') {
        return editorWithActiveSelection(current, {
          start: snapEditorTimeToFrame(Math.min(nextValue, Math.max(0, active.end - frameStep)), current),
          end: active.end
        }, active.index);
      }
      return editorWithActiveSelection(current, {
        start: active.start,
        end: snapEditorTimeToFrame(Math.max(nextValue, Math.min(durationValue, active.start + frameStep)), current)
      }, active.index);
    });
  }

  async function applyEditorAudioBuffer(nextAudioBuffer, actionLabel) {
    if (!audioEditor || audioEditor.busy) return;
    setAudioEditor((current) => current ? { ...current, busy: true, error: '' } : current);
    setStatus(`正在${actionLabel}`);
    try {
      const nextBlob = encodeMp3BlobFromSamples(
        audioBufferSelectionToMonoByFrames(nextAudioBuffer, 0, nextAudioBuffer.length),
        nextAudioBuffer.sampleRate,
        bitrate
      );
      const nextUrl = URL.createObjectURL(nextBlob);
      setAudioEditor((current) => {
        if (!current) {
          URL.revokeObjectURL(nextUrl);
          return current;
        }
        const keptHistory = current.history.slice(0, current.historyIndex + 1);
        const discardedHistory = current.history.slice(current.historyIndex + 1);
        discardedHistory.forEach((entry) => URL.revokeObjectURL(entry.url));
        const nextHistory = [...keptHistory, { audioBuffer: nextAudioBuffer, blob: nextBlob, url: nextUrl }];
        const overflow = Math.max(0, nextHistory.length - AUDIO_EDITOR_HISTORY_LIMIT);
        const limitedHistory = overflow ? nextHistory.slice(overflow) : nextHistory;
        nextHistory.slice(0, overflow).forEach((entry) => URL.revokeObjectURL(entry.url));
        const nextIndex = limitedHistory.length - 1;

        return {
          ...current,
          sourceBlob: nextBlob,
          url: nextUrl,
          audioBuffer: nextAudioBuffer,
          duration: nextAudioBuffer.duration,
          selectionStart: 0,
          selectionEnd: 0,
          selectionRanges: [],
          activeSelectionIndex: -1,
          previewMode: 'full',
          currentTime: 0,
          playbackSegmentIndex: null,
          history: limitedHistory,
          historyIndex: nextIndex,
          busy: false,
          error: ''
        };
      });
      setStatus(`${actionLabel}完成`);
    } catch (error) {
      console.warn(`${actionLabel}失败:`, error);
      setAudioEditor((current) => current ? { ...current, busy: false, error: `${actionLabel}失败：${error?.message || error}` } : current);
      setStatus(`${actionLabel}失败：${error?.message || error}`);
    }
  }

  function ensureDecodedEditorAudio(actionLabel) {
    if (audioEditor?.nativeWaveformOnly) {
      setStatus(`${actionLabel}需要下一步流式编辑支持，当前长音频模式先只支持预览和选区定位`);
      return false;
    }
    return true;
  }

  async function trimEditorSelection() {
    if (!ensureDecodedEditorAudio('裁剪选区')) return;
    if (!audioEditor?.audioBuffer || audioEditor.loading || audioEditor.busy) return;
    const active = editorActiveSelectionRange(audioEditor);
    const start = snapEditorTimeToFrame(active?.start || 0, audioEditor);
    const end = snapEditorTimeToFrame(active?.end || 0, audioEditor);
    if (end - start < editorFrameDuration(audioEditor)) {
      setStatus('选区太短，无法裁剪');
      return;
    }
    const startFrame = audioBufferFrameFromTime(audioEditor.audioBuffer, start);
    const endFrame = audioBufferFrameFromTime(audioEditor.audioBuffer, end);
    const nextAudioBuffer = await trimAudioBufferSelectionByFrames(audioEditor.audioBuffer, startFrame, endFrame);
    await applyEditorAudioBuffer(nextAudioBuffer, '裁剪选区');
  }

  function silenceCutPopoverPosition() {
    const rect = silenceCutButtonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const width = Math.min(450, Math.max(330, window.innerWidth - 32));
    return {
      x: Math.min(window.innerWidth - width / 2 - 12, Math.max(width / 2 + 12, rect.left + rect.width / 2)),
      y: Math.min(window.innerHeight - 120, Math.max(12, rect.bottom + 14))
    };
  }

  function scanEditorSilenceRanges(editor = audioEditor, seconds = silenceCutSeconds, sensitivity = silenceSensitivity, reserve = silenceReserveSeconds) {
    if (!editor || editor.loading || editor.busy) return [];
    const minSeconds = normalizeSilenceCutSeconds(seconds);
    const threshold = silenceThresholdFromSensitivity(sensitivity);
    const rawRanges = editor.nativeWaveformOnly
      ? detectNativeSilentRanges(editor, minSeconds, threshold)
      : detectAudioBufferSilentRanges(editor.audioBuffer, minSeconds, editor, threshold);
    return applySilenceReserveToRanges(rawRanges, reserve, editor);
  }

  function applySilenceCutRanges(ranges, seconds = silenceCutSeconds, sensitivity = silenceSensitivity, reserve = silenceReserveSeconds) {
    const nextRanges = mergeEditorRanges(ranges, audioEditor, 0.2);
    if (nextRanges.length) {
      setAudioEditor((current) => current ? editorWithSelectionRanges(current, nextRanges, 0) : current);
    }
    setSilenceCutPrompt({
      count: nextRanges.length,
      seconds: normalizeSilenceCutSeconds(seconds),
      sensitivity: normalizeSilenceSensitivity(sensitivity),
      reserve: normalizeSilenceReserveSeconds(reserve),
      position: silenceCutPopoverPosition(),
      totalDuration: nextRanges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0)
    });
    setStatus(nextRanges.length
      ? `已选出 ${nextRanges.length} 段无声选区`
      : `未找到超过 ${normalizeSilenceCutSeconds(seconds)} 秒且预留后可删除的无声选区，可调整参数重新检测`);
  }

  function scanSilenceForCut() {
    if (!audioEditor || audioEditor.loading || audioEditor.busy) return;
    const seconds = normalizeSilenceCutSeconds(silenceCutSeconds);
    const sensitivity = normalizeSilenceSensitivity(silenceSensitivity);
    const reserve = normalizeSilenceReserveSeconds(silenceReserveSeconds);
    setSilenceCutSeconds(seconds);
    setSilenceSensitivity(sensitivity);
    setSilenceReserveSeconds(reserve);
    setStatus(`正在检测超过 ${seconds} 秒的无声片段`);
    const ranges = scanEditorSilenceRanges(audioEditor, seconds, sensitivity, reserve);
    applySilenceCutRanges(ranges, seconds, sensitivity, reserve);
  }

  function rescanSilenceForCut(nextSeconds = silenceCutSeconds, nextSensitivity = silenceSensitivity, nextReserve = silenceReserveSeconds) {
    const seconds = normalizeSilenceCutSeconds(nextSeconds);
    const sensitivity = normalizeSilenceSensitivity(nextSensitivity);
    const reserve = normalizeSilenceReserveSeconds(nextReserve);
    setSilenceCutSeconds(seconds);
    setSilenceSensitivity(sensitivity);
    setSilenceReserveSeconds(reserve);
    const ranges = scanEditorSilenceRanges(audioEditor, seconds, sensitivity, reserve);
    applySilenceCutRanges(ranges, seconds, sensitivity, reserve);
  }

  async function deleteEditorSelection() {
    const ranges = editorSelectionRanges(audioEditor);
    if (!ranges.length) {
      setStatus('选区太短，无法删除');
      return;
    }
    const normalizedRanges = mergeEditorRanges(ranges, audioEditor, 0);
    if (audioEditor?.nativeWaveformOnly) {
      const nextEditorState = deleteNativeEditorRanges(audioEditor, normalizedRanges);
      setAudioEditor((current) => {
        if (!current || current.loading || current.busy) return current;
        return editorWithNativeHistory(current, deleteNativeEditorRanges(current, normalizedRanges));
      });
      const player = editorAudioRef.current;
      if (player) {
        player.pause();
        player.currentTime = editorWaveTimeToPlaybackTime(nextEditorState.currentTime, nextEditorState);
      }
      setSilenceCutPrompt(null);
      setStatus(`已从编辑时间线删除 ${normalizedRanges.length} 个选区`);
      return;
    }
    if (!ensureDecodedEditorAudio('删除选区')) return;
    if (!audioEditor?.audioBuffer || audioEditor.loading || audioEditor.busy) return;
    try {
      const frameRanges = normalizedRanges.map((range) => ({
        start: audioBufferFrameFromTime(audioEditor.audioBuffer, range.start),
        end: audioBufferFrameFromTime(audioEditor.audioBuffer, range.end)
      }));
      const nextAudioBuffer = await deleteAudioBufferRangesByFrames(audioEditor.audioBuffer, frameRanges);
      await applyEditorAudioBuffer(nextAudioBuffer, '删除选区');
      setSilenceCutPrompt(null);
    } catch (error) {
      setStatus(`删除选区失败：${error?.message || error}`);
      setAudioEditor((current) => current ? { ...current, error: `删除选区失败：${error?.message || error}` } : current);
    }
  }

  async function copyEditorSelection() {
    const active = editorActiveSelectionRange(audioEditor);
    const start = snapEditorTimeToFrame(active?.start || 0, audioEditor);
    const end = snapEditorTimeToFrame(active?.end || 0, audioEditor);
    if (end - start < editorFrameDuration(audioEditor)) {
      setStatus('选区太短，无法复制');
      return;
    }
    if (audioEditor?.nativeWaveformOnly) {
      const copiedSelection = copyNativeEditorSelection(audioEditor, start, end);
      if (!copiedSelection.segments.length) {
        setStatus('选区没有可复制的音频片段');
        return;
      }
      setEditorClipboard(copiedSelection);
      setStatus(`已复制选区 ${formatEditorTime(copiedSelection.duration)}`);
      return;
    }
    if (!ensureDecodedEditorAudio('复制选区')) return;
    if (!audioEditor?.audioBuffer || audioEditor.loading || audioEditor.busy) return;
    try {
      const startFrame = audioBufferFrameFromTime(audioEditor.audioBuffer, start);
      const endFrame = audioBufferFrameFromTime(audioEditor.audioBuffer, end);
      const copiedBuffer = await trimAudioBufferSelectionByFrames(audioEditor.audioBuffer, startFrame, endFrame);
      setEditorClipboard(copiedBuffer);
      setStatus(`已复制选区 ${formatEditorTime(copiedBuffer.duration)}`);
    } catch (error) {
      setStatus(`复制选区失败：${error?.message || error}`);
    }
  }

  async function pasteEditorSelection() {
    if (!editorClipboard || audioEditor?.loading || audioEditor?.busy) return;
    const start = editorPasteAnchorTime(audioEditor);
    const end = start;
    const player = editorAudioRef.current;
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    if (player) player.pause();
    if (audioEditor?.nativeWaveformOnly) {
      if (!editorClipboard?.native) {
        setStatus('长音频模式只能粘贴从长音频复制的选区');
        return;
      }
      const nextEditorState = pasteNativeEditorSelection(audioEditor, editorClipboard, start, end);
      setAudioEditor((current) => {
        if (!current || current.loading || current.busy) return current;
        return editorWithNativeHistory(current, pasteNativeEditorSelection(current, editorClipboard, start, end));
      });
      if (player) player.currentTime = editorWaveTimeToPlaybackTime(start, nextEditorState);
      setStatus(`已粘贴选区 ${formatEditorTime(editorClipboard.duration || 0)}`);
      return;
    }
    if (!ensureDecodedEditorAudio('粘贴选区')) return;
    if (!audioEditor?.audioBuffer) return;
    try {
      const startFrame = audioBufferFrameFromTime(audioEditor.audioBuffer, start);
      const endFrame = startFrame;
      const nextAudioBuffer = await pasteAudioBufferSelectionByFrames(audioEditor.audioBuffer, editorClipboard, startFrame, endFrame);
      await applyEditorAudioBuffer(nextAudioBuffer, '粘贴选区');
      const pastedEnd = audioBufferTimeFromFrame(nextAudioBuffer, Math.min(startFrame + editorClipboard.length, nextAudioBuffer.length));
      setAudioEditor((current) => current
        ? {
          ...editorWithActiveSelection(current, { start, end: pastedEnd }, null),
          currentTime: start,
          playbackMarkerTime: start,
          editorPlaying: false,
          previewMode: 'full'
        }
        : current);
      if (player) player.currentTime = start;
    } catch (error) {
      setStatus(`粘贴选区失败：${error?.message || error}`);
      setAudioEditor((current) => current ? { ...current, error: `粘贴选区失败：${error?.message || error}` } : current);
    }
  }

  function selectEditorFullRange() {
    setAudioEditor((current) => current
      ? editorWithActiveSelection(current, { start: 0, end: snapEditorTimeToFrame(current.duration || 0, current) }, null)
      : current);
    setStatus('已选择整段音频');
  }

  function jumpEditorHistory(direction) {
    const player = editorAudioRef.current;
    if (player) player.pause();
    setAudioEditor((current) => {
      if (!current) return current;
      const nextIndex = current.historyIndex + direction;
      const entry = current.history[nextIndex];
      if (!entry) return current;
      if (current.nativeWaveformOnly && entry.native) {
        const nextDuration = nativeEditorDurationFromSegments(entry.segments);
        const nextEditor = {
          ...current,
          segments: entry.segments.map(cloneNativeEditorSegment),
          duration: nextDuration,
          previewMode: 'full',
          visibleStart: clampEditorVisibleStart(entry.visibleStart || 0, nextDuration, editorVisibleRange({ ...current, duration: nextDuration }).duration),
          currentTime: Math.min(entry.currentTime || 0, nextDuration),
          playbackSegmentIndex: null,
          editorPlaying: false,
          historyIndex: nextIndex,
          error: ''
        };
        return editorWithSelectionRanges(nextEditor, lockedEditorSelectionRangesForDuration(current, nextDuration), 0);
      }
      const nextDuration = entry.audioBuffer.duration;
      const nextEditor = {
        ...current,
        sourceBlob: entry.blob,
        url: entry.url,
        audioBuffer: entry.audioBuffer,
        duration: nextDuration,
        previewMode: 'full',
        visibleStart: 0,
        currentTime: 0,
        playbackSegmentIndex: null,
        editorPlaying: false,
        historyIndex: nextIndex,
        error: ''
      };
      return editorWithSelectionRanges(nextEditor, lockedEditorSelectionRangesForDuration(current, nextDuration), 0);
    });
  }

  function editorTimeFromPointer(event) {
    if (!audioEditor?.duration || !editorCanvasRef.current) return 0;
    const visible = editorVisibleRange(audioEditor);
    return editorVisibleRatioToTime(pointerRatioInElement(event), visible, audioEditor);
  }

  function editorCanvasPointFromPointer(event) {
    const canvas = editorCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect?.width || !rect?.height) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function editorSelectionIndexFromPointer(event, editor = audioEditor) {
    if (!editor?.duration || !editorCanvasRef.current) return null;
    const visible = editorVisibleRange(editor);
    const ranges = editorSelectionRanges(editor);
    if (!ranges.length || visible.duration <= 0) return null;
    const canvas = editorCanvasRef.current;
    const point = editorCanvasPointFromPointer(event);
    const waveTop = 42;
    const waveBottom = canvas.height - 10;
    if (point.y < waveTop || point.y > waveBottom) return null;

    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const range = ranges[index];
      const selectionStart = Math.max(range.start, visible.start);
      const selectionEnd = Math.min(range.end, visible.end);
      if (selectionEnd <= selectionStart) continue;
      const startX = editorTimeToVisibleRatio(selectionStart, visible) * canvas.width;
      const endX = editorTimeToVisibleRatio(selectionEnd, visible) * canvas.width;
      if (point.x >= startX && point.x <= endX) return index;
    }
    return null;
  }

  function editorSelectionDeleteIndexFromPointer(event, editor = audioEditor) {
    if (!editor?.duration || !editorCanvasRef.current) return null;
    const visible = editorVisibleRange(editor);
    const ranges = editorSelectionRanges(editor);
    if (!ranges.length || visible.duration <= 0) return null;
    const canvas = editorCanvasRef.current;
    const point = editorCanvasPointFromPointer(event);
    const waveTop = 42;
    if (point.y < waveTop - 28 || point.y > waveTop - 2) return null;

    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const range = ranges[index];
      const selectionStart = Math.max(range.start, visible.start);
      const selectionEnd = Math.min(range.end, visible.end);
      if (selectionEnd <= selectionStart) continue;
      const startX = editorTimeToVisibleRatio(selectionStart, visible) * canvas.width;
      const endX = editorTimeToVisibleRatio(selectionEnd, visible) * canvas.width;
      const deleteX = (startX + endX) / 2;
      if (Math.abs(point.x - deleteX) <= 12) return index;
    }
    return null;
  }

  function editorSelectionEdgeFromPointer(event, editor = audioEditor) {
    if (!editor?.duration || !editorCanvasRef.current) return null;
    const visible = editorVisibleRange(editor);
    const ranges = editorSelectionRanges(editor);
    if (!ranges.length || visible.duration <= 0) return null;

    const rect = editorCanvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const edgeTolerance = 8;
    const candidates = [];
    ranges.forEach((range, rangeIndex) => {
      if (range.start >= visible.start && range.start <= visible.end) {
        candidates.push({
          rangeIndex,
          edge: 'start',
          distance: Math.abs(pointerX - editorTimeToVisibleRatio(range.start, visible) * rect.width)
        });
      }
      if (range.end >= visible.start && range.end <= visible.end) {
        candidates.push({
          rangeIndex,
          edge: 'end',
          distance: Math.abs(pointerX - editorTimeToVisibleRatio(range.end, visible) * rect.width)
        });
      }
    });
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0];
    return closest?.distance <= edgeTolerance ? closest : null;
  }

  function startEditorSelectionDrag(event) {
    if (!audioEditor || audioEditor.loading || audioEditor.busy) return;
    if (event.button !== 0) return;
    setEditorSelectionMenu(null);
    const deleteIndex = editorSelectionDeleteIndexFromPointer(event);
    if (deleteIndex !== null) {
      setAudioEditor((current) => current ? editorWithoutSelection(current, deleteIndex) : current);
      setStatus('已删除选区');
      return;
    }
    const edge = editorSelectionEdgeFromPointer(event);
    if (edge) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setAudioEditor((current) => current ? {
        ...current,
        activeSelectionIndex: edge.rangeIndex,
        selectionStart: editorSelectionRanges(current)[edge.rangeIndex]?.start || current.selectionStart,
        selectionEnd: editorSelectionRanges(current)[edge.rangeIndex]?.end || current.selectionEnd,
        dragAnchor: null,
        dragSelectionEdge: edge,
        hoverSelectionEdge: edge
      } : current);
      return;
    }
    const anchor = editorTimeFromPointer(event);
    const player = editorAudioRef.current;
    if (player) player.currentTime = editorWaveTimeToPlaybackTime(anchor, audioEditor);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setAudioEditor((current) => current ? {
      ...current,
      dragAnchor: anchor,
      dragStartX: event.clientX,
      dragSelectionIndex: null,
      dragAppendSelection: event.ctrlKey,
      dragSelectionEdge: null,
      hoverSelectionEdge: null,
      hoverSelectionIndex: null,
      hoverSelectionDeleteIndex: null,
      playbackMarkerTime: anchor,
      currentTime: anchor
    } : current);
  }

  function moveEditorSelectionDrag(event) {
    if (!audioEditor) return;
    const nextTime = editorTimeFromPointer(event);
    setAudioEditor((current) => {
      if (!current) return current;
      const frameStep = editorFrameDuration(current);
      if (current.dragSelectionEdge?.edge === 'start') {
        const rangeIndex = current.dragSelectionEdge.rangeIndex;
        const ranges = editorSelectionRanges(current);
        const active = ranges[rangeIndex] || editorActiveSelectionRange(current);
        if (!active) {
          return {
            ...current,
            dragSelectionEdge: null,
            hoverSelectionEdge: null
          };
        }
        const nextRange = {
          start: snapEditorTimeToFrame(Math.min(nextTime, active.end - frameStep), current),
          end: active.end
        };
        return {
          ...editorWithActiveSelection(current, nextRange, rangeIndex),
          hoverSelectionEdge: current.dragSelectionEdge
        };
      }
      if (current.dragSelectionEdge?.edge === 'end') {
        const rangeIndex = current.dragSelectionEdge.rangeIndex;
        const ranges = editorSelectionRanges(current);
        const active = ranges[rangeIndex] || editorActiveSelectionRange(current);
        if (!active) {
          return {
            ...current,
            dragSelectionEdge: null,
            hoverSelectionEdge: null
          };
        }
        const nextRange = {
          start: active.start,
          end: snapEditorTimeToFrame(Math.max(nextTime, active.start + frameStep), current)
        };
        return {
          ...editorWithActiveSelection(current, nextRange, rangeIndex),
          hoverSelectionEdge: current.dragSelectionEdge
        };
      }
      if (current.dragAnchor !== 0 && !current.dragAnchor) {
        const hoverSelectionEdge = editorSelectionEdgeFromPointer(event, current);
        const hoverSelectionDeleteIndex = editorSelectionDeleteIndexFromPointer(event, current);
        const hoverSelectionIndex = hoverSelectionDeleteIndex ?? editorSelectionIndexFromPointer(event, current);
        return {
          ...current,
          hoverSelectionEdge,
          hoverSelectionIndex,
          hoverSelectionDeleteIndex
        };
      }
      if (Math.abs(event.clientX - (current.dragStartX || event.clientX)) < 4 && current.dragSelectionIndex === null) {
        return current;
      }
      const selectionStart = snapEditorTimeToFrame(Math.min(current.dragAnchor, nextTime), current);
      const rawSelectionEnd = Math.max(current.dragAnchor, nextTime);
      const selectionEnd = rawSelectionEnd - selectionStart < frameStep
        ? snapEditorTimeToFrame(Math.min(current.duration, selectionStart + frameStep), current)
        : snapEditorTimeToFrame(rawSelectionEnd, current);
      let baseEditor = current;
      let nextIndex = current.dragSelectionIndex === null ? null : current.dragSelectionIndex;
      if (!current.dragAppendSelection && current.dragSelectionIndex === null) {
        baseEditor = editorWithoutUnlockedSelections(current);
        nextIndex = null;
      }
      const updated = editorWithActiveSelection(baseEditor, { start: selectionStart, end: selectionEnd }, nextIndex);
      return {
        ...updated,
        dragSelectionIndex: updated.activeSelectionIndex
      };
    });
  }

  function endEditorSelectionDrag(event) {
    if (event.type !== 'pointercancel' && event.button !== 0) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setAudioEditor((current) => {
      if (!current) return current;
      const isSingleClickSelectionAction = current.dragAnchor != null && current.dragSelectionIndex === null && !current.dragSelectionEdge;
      if (isSingleClickSelectionAction) {
        return {
          ...editorWithoutUnlockedSelections(current),
          dragAnchor: null,
          dragStartX: null,
          dragSelectionIndex: null,
          dragAppendSelection: false,
          dragSelectionEdge: null,
          hoverSelectionEdge: null,
          hoverSelectionDeleteIndex: null,
          hoverSelectionIndex: null
        };
      }
      return {
        ...current,
        dragAnchor: null,
        dragStartX: null,
        dragSelectionIndex: null,
        dragAppendSelection: false,
        dragSelectionEdge: null,
        hoverSelectionEdge: editorSelectionEdgeFromPointer(event, current),
        hoverSelectionDeleteIndex: editorSelectionDeleteIndexFromPointer(event, current),
        hoverSelectionIndex: editorSelectionDeleteIndexFromPointer(event, current) ?? editorSelectionIndexFromPointer(event, current)
      };
    });
  }

  function clearEditorSelectionHover() {
    setAudioEditor((current) => (
      current && !current.dragSelectionEdge && (current.hoverSelectionEdge || current.hoverSelectionIndex != null || current.hoverSelectionDeleteIndex != null)
        ? { ...current, hoverSelectionEdge: null, hoverSelectionIndex: null, hoverSelectionDeleteIndex: null }
        : current
    ));
  }

  function openEditorSelectionContextMenu(event) {
    event.preventDefault();
    if (!audioEditor || audioEditor.loading || audioEditor.busy) {
      setEditorSelectionMenu(null);
      return;
    }
    const rangeIndex = editorSelectionIndexFromPointer(event);
    const ranges = editorSelectionRanges(audioEditor);
    const range = ranges[rangeIndex];
    if (rangeIndex == null || !range) {
      setEditorSelectionMenu(null);
      return;
    }
    setAudioEditor((current) => current ? {
      ...current,
      activeSelectionIndex: rangeIndex,
      selectionStart: range.start,
      selectionEnd: range.end,
      hoverSelectionIndex: rangeIndex,
      hoverSelectionDeleteIndex: null,
      hoverSelectionEdge: null
    } : current);
    setEditorSelectionMenu({
      rangeIndex,
      locked: Boolean(range.locked),
      allLocked: ranges.length > 0 && ranges.every((item) => item.locked),
      x: Math.max(8, Math.min(event.clientX, Math.max(8, window.innerWidth - 164))),
      y: Math.max(8, Math.min(event.clientY, Math.max(8, window.innerHeight - 132)))
    });
  }

  function setAllEditorSelectionsLocked(locked) {
    setAudioEditor((current) => {
      if (!current) return current;
      const ranges = editorSelectionRanges(current);
      if (!ranges.length) return current;
      const activeIndex = Math.max(0, Math.min(Number(current.activeSelectionIndex) || 0, ranges.length - 1));
      const nextRanges = ranges.map((range) => ({ ...range, locked }));
      return {
        ...current,
        selectionRanges: nextRanges,
        activeSelectionIndex: activeIndex,
        selectionStart: nextRanges[activeIndex].start,
        selectionEnd: nextRanges[activeIndex].end
      };
    });
    setEditorSelectionMenu(null);
    setStatus(locked ? '已标记全部选区' : '已取消全部标记');
  }

  function setEditorSelectionLocked(rangeIndex, locked) {
    setAudioEditor((current) => {
      if (!current) return current;
      const ranges = editorSelectionRanges(current);
      if (rangeIndex < 0 || rangeIndex >= ranges.length) return current;
      const nextRanges = ranges.map((range, index) => (
        index === rangeIndex ? { ...range, locked } : range
      ));
      return {
        ...current,
        selectionRanges: nextRanges,
        activeSelectionIndex: rangeIndex,
        selectionStart: nextRanges[rangeIndex].start,
        selectionEnd: nextRanges[rangeIndex].end
      };
    });
    setEditorSelectionMenu(null);
    setStatus(locked ? '已标记选区' : '已取消选区标记');
  }

  function isEditorInputTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  }

  function cancelEditorPlaybackFollowAnimation() {
    const currentAnimation = editorPlaybackFollowAnimationRef.current;
    if (currentAnimation?.frameId) {
      window.cancelAnimationFrame(currentAnimation.frameId);
    }
    editorPlaybackFollowAnimationRef.current = null;
  }

  function updateEditorZoom(nextZoom, centerTime = null) {
    cancelEditorPlaybackFollowAnimation();
    setAudioEditor((current) => {
      if (!current) return current;
      const durationValue = current.duration || 0;
      const oldVisible = editorVisibleRange(current);
      const anchorTime = centerTime ?? (oldVisible.start + oldVisible.duration / 2);
      const nextZoomValue = Math.max(0, Math.min(100, Number(nextZoom) || 0));
      const nextVisibleDuration = editorVisibleDurationForZoom(durationValue || 1, nextZoomValue, editorSampleRate(current));
      const anchorRatio = oldVisible.duration > 0 ? (anchorTime - oldVisible.start) / oldVisible.duration : 0.5;
      const nextVisibleStart = clampEditorVisibleStart(
        snapEditorTimeToFrame(anchorTime - nextVisibleDuration * Math.min(Math.max(anchorRatio, 0), 1), current),
        durationValue,
        nextVisibleDuration
      );
      return {
        ...current,
        zoom: nextZoomValue,
        visibleStart: nextVisibleStart
      };
    });
  }

  function animateEditorVisibleStart(targetStart, durationMs = 260, sourceEditor = audioEditor) {
    const currentAnimation = editorPlaybackFollowAnimationRef.current;
    if (currentAnimation?.frameId) {
      window.cancelAnimationFrame(currentAnimation.frameId);
    }

    const startedAt = performance.now();
    const startVisible = Number(sourceEditor?.visibleStart) || 0;
    const targetVisible = Number(targetStart) || 0;
    if (Math.abs(targetVisible - startVisible) < editorFrameDuration(sourceEditor)) return;

    const step = (timestamp) => {
      const progress = Math.min(1, (timestamp - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextVisibleStart = startVisible + (targetVisible - startVisible) * eased;
      setAudioEditor((current) => current ? {
        ...current,
        visibleStart: clampEditorVisibleStart(nextVisibleStart, current.duration || 0, editorVisibleRange(current).duration)
      } : current);

      if (progress < 1) {
        editorPlaybackFollowAnimationRef.current = {
          target: targetVisible,
          frameId: window.requestAnimationFrame(step)
        };
      } else {
        editorPlaybackFollowAnimationRef.current = null;
      }
    };

    editorPlaybackFollowAnimationRef.current = {
      target: targetVisible,
      frameId: window.requestAnimationFrame(step)
    };
  }

  function editorWithPlaybackFollow(editor, nextTime, extra = {}) {
    if (!editor) return editor;
    const visible = editorVisibleRange(editor);
    const duration = Number(editor.duration) || 0;
    const previousTime = Number(editor.currentTime) || 0;
    const wasPlayheadVisible = previousTime >= visible.start && previousTime <= visible.end;
    const rightEdgeGuard = Math.max(editorFrameDuration(editor) * 2, visible.duration * 0.02);
    let nextVisibleStart = editor.visibleStart;

    if (
      editor.editorPlaying
      && wasPlayheadVisible
      && duration > visible.duration
      && nextTime >= visible.end - rightEdgeGuard
    ) {
      nextVisibleStart = clampEditorVisibleStart(nextTime - visible.duration * 0.12, duration, visible.duration);
      const activeAnimation = editorPlaybackFollowAnimationRef.current;
      if (!activeAnimation || Math.abs((Number(activeAnimation.target) || 0) - nextVisibleStart) > editorFrameDuration(editor) * 4) {
        animateEditorVisibleStart(nextVisibleStart, 960, editor);
      }
      nextVisibleStart = editor.visibleStart;
    }

    return {
      ...editor,
      ...extra,
      currentTime: nextTime,
      visibleStart: nextVisibleStart
    };
  }

  function handleEditorWaveWheel(event) {
    if (!audioEditor?.duration) return;
    event.preventDefault();
    const ratio = pointerRatioInElement(event);
    const visible = editorVisibleRange(audioEditor);
    const centerTime = event.currentTarget === editorMiniCanvasRef.current
      ? editorOverviewRatioToTime(ratio, audioEditor)
      : editorVisibleRatioToTime(ratio, visible, audioEditor);
    const step = event.deltaY < 0 ? 1 : -1;
    window.clearTimeout(editorZoomNoticeTimerRef.current);
    setEditorZoomNoticeVisible(true);
    editorZoomNoticeTimerRef.current = window.setTimeout(() => setEditorZoomNoticeVisible(false), 3000);
    updateEditorZoom((audioEditor.zoom || 0) + step, centerTime);
  }

  useEffect(() => {
    const waveCanvas = editorCanvasRef.current;
    const miniCanvas = editorMiniCanvasRef.current;
    if (!waveCanvas && !miniCanvas) return undefined;

    const handleNativeWheel = (event) => {
      handleEditorWaveWheel(event);
    };

    waveCanvas?.addEventListener('wheel', handleNativeWheel, { passive: false });
    miniCanvas?.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      waveCanvas?.removeEventListener('wheel', handleNativeWheel);
      miniCanvas?.removeEventListener('wheel', handleNativeWheel);
    };
  }, [audioEditor]);

  function startEditorMiniDrag(event) {
    if (!audioEditor?.duration) return;
    cancelEditorPlaybackFollowAnimation();
    const ratio = pointerRatioInElement(event);
    const visible = editorVisibleRange(audioEditor);
    editorMiniDragRef.current = {
      pointerId: event.pointerId,
      ratio,
      offset: ratio * audioEditor.duration - visible.start
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setAudioEditor((current) => current ? { ...current, miniDragging: true } : current);
  }

  function moveEditorMiniDrag(event) {
    const drag = editorMiniDragRef.current;
    if (!drag || !audioEditor?.duration) return;
    const ratio = pointerRatioInElement(event);
    const visible = editorVisibleRange(audioEditor);
    const nextStart = clampEditorVisibleStart(ratio * audioEditor.duration - drag.offset, audioEditor.duration, visible.duration);
    setAudioEditor((current) => current ? { ...current, visibleStart: nextStart } : current);
  }

  function endEditorMiniDrag(event) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    editorMiniDragRef.current = null;
    setAudioEditor((current) => current ? { ...current, miniDragging: false } : current);
  }

  function cancelEditorPlaybackFrame() {
    if (editorPlaybackFrameRef.current) {
      window.cancelAnimationFrame(editorPlaybackFrameRef.current);
      editorPlaybackFrameRef.current = null;
    }
  }

  function setEditorPlaybackState(isPlaying) {
    if (!isPlaying) {
      window.clearTimeout(editorSelectionPreviewTimerRef.current);
      cancelEditorPlaybackFrame();
      commitEditorPlaybackPosition(editorPlaybackSnapshotRef.current.currentTime, audioEditorRef.current, { editorPlaying: false, playbackSegmentIndex: null });
    }
    setAudioEditor((current) => {
      if (!current) return current;
      const activeSegment = isPlaying && current.nativeWaveformOnly
        ? nativeEditorSegmentAtWaveTime(current, current.currentTime || 0)
        : null;
      return {
        ...current,
        editorPlaying: isPlaying,
        playbackSegmentIndex: activeSegment?.index ?? null
      };
    });
  }

  function stopEditorSelectionPreview(player, editor, range) {
    if (!player || !editor || !range) return;
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    cancelEditorPlaybackFrame();
    const start = snapEditorTimeToFrame(range.start, editor);
    player.pause();
    player.currentTime = editorWaveTimeToPlaybackTime(start, editor);
    commitEditorPlaybackPosition(start, editor, {
      playbackSegmentIndex: null,
      editorPlaying: false,
      previewMode: 'selection',
      previewSelectionRanges: [],
      previewSelectionIndex: 0
    });
    setAudioEditor((current) => current ? {
      ...current,
      currentTime: start,
      playbackSegmentIndex: null,
      editorPlaying: false,
      previewMode: 'selection',
      previewSelectionRanges: [],
      previewSelectionIndex: 0
    } : current);
  }

  function playEditorSelectionRange(player, editor, ranges, index) {
    const range = ranges[index];
    if (!player || !editor || !range) return false;
    const start = snapEditorTimeToFrame(range.start, editor);
    const end = snapEditorTimeToFrame(range.end, editor);
    if (end <= start + editorFrameDuration(editor)) return false;
    const activeSegment = nativeEditorSegmentAtWaveTime(editor, start);
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    commitEditorPlaybackPosition(start, editor, {
      previewMode: ranges.length > 1 ? 'all-selections' : 'selection',
      previewSelectionRanges: ranges,
      previewSelectionIndex: index,
      playbackSegmentIndex: activeSegment?.index ?? null,
      editorPlaying: true
    });
    setAudioEditor((current) => current ? {
      ...current,
      previewMode: ranges.length > 1 ? 'all-selections' : 'selection',
      previewSelectionRanges: ranges,
      previewSelectionIndex: index,
      currentTime: start,
      playbackSegmentIndex: activeSegment?.index ?? null,
      editorPlaying: true
    } : current);
    player.currentTime = editorWaveTimeToPlaybackTime(start, editor);
    player.play()
      .then(() => {
        if (ranges.length <= 1) {
          editorSelectionPreviewTimerRef.current = window.setTimeout(() => {
            stopEditorSelectionPreview(player, editor, { start, end });
          }, Math.max(1, (end - start) * 1000));
        }
      })
      .catch((error) => {
        console.warn('选区预览失败:', error);
        setEditorPlaybackState(false);
        setStatus(`播放失败：${error?.message || error}`);
      });
    return true;
  }

  function advanceEditorSelectionPreview(player, editor, currentRange) {
    const ranges = Array.isArray(editor?.previewSelectionRanges) ? editor.previewSelectionRanges : [];
    const currentIndex = Number(editor?.previewSelectionIndex) || 0;
    if (editor?.previewMode === 'all-selections' && currentIndex < ranges.length - 1) {
      playEditorSelectionRange(player, editor, ranges, currentIndex + 1);
      return true;
    }
    stopEditorSelectionPreview(player, editor, currentRange);
    return true;
  }

  function toggleEditorPlayback() {
    const player = editorAudioRef.current;
    if (!player || !audioEditor) return;
    if (!player.paused) {
      window.clearTimeout(editorSelectionPreviewTimerRef.current);
      syncEditorPlaybackTime(player, audioEditorRef.current, { forceStateSync: true });
      player.pause();
      setEditorPlaybackState(false);
      return;
    }
    const startTime = snapEditorTimeToFrame(editorPlaybackSnapshotRef.current.currentTime || audioEditor.currentTime || 0, audioEditor);
    commitEditorPlaybackPosition(startTime, audioEditor);
    player.currentTime = editorWaveTimeToPlaybackTime(startTime, audioEditor);
    player.play()
      .then(() => setEditorPlaybackState(true))
      .catch((error) => {
        console.warn('编辑器播放失败:', error);
        setEditorPlaybackState(false);
        setStatus(`播放失败：${error?.message || error}`);
      });
  }

  function resetEditorToStart() {
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    cancelEditorPlaybackFrame();
    const player = editorAudioRef.current;
    if (player) {
      player.pause();
      player.currentTime = editorWaveTimeToPlaybackTime(0, audioEditor);
    }
    commitEditorPlaybackPosition(0, audioEditor, { visibleStart: 0, editorPlaying: false, playbackSegmentIndex: null });
    setAudioEditor((current) => current ? {
      ...current,
      currentTime: 0,
      visibleStart: 0,
      editorPlaying: false
    } : current);
  }

  function previewEditorFull() {
    const player = editorAudioRef.current;
    if (!player || !audioEditor) return;
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    commitEditorPlaybackPosition(0, audioEditor, { previewMode: 'full', playbackSegmentIndex: 0, editorPlaying: true });
    setAudioEditor((current) => current ? { ...current, previewMode: 'full', currentTime: 0, playbackSegmentIndex: 0, editorPlaying: true } : current);
    player.currentTime = editorWaveTimeToPlaybackTime(0, audioEditor);
    player.play().catch((error) => {
      console.warn('完整预览音频失败:', error);
      setEditorPlaybackState(false);
      setStatus(`播放失败：${error?.message || error}`);
    });
  }

  function previewEditorSelection() {
    const player = editorAudioRef.current;
    if (!player || !audioEditor) return;
    const ranges = previewAllEditorSelections
      ? editorSelectionRanges(audioEditor).sort((a, b) => a.start - b.start)
      : [editorActiveSelectionRange(audioEditor)].filter(Boolean);
    const validRanges = ranges
      .map((range) => makeEditorSelectionRange(range.start, range.end, audioEditor))
      .filter(Boolean)
      .filter((range) => range.end > range.start + editorFrameDuration(audioEditor));
    if (!validRanges.length) {
      setStatus('请先选择要预览的音频范围');
      return;
    }
    playEditorSelectionRange(player, audioEditor, validRanges, 0);
  }

  function syncEditorPlaybackTime(player, sourceEditor = audioEditorRef.current, options = {}) {
    if (!player || !sourceEditor) return;
    const syncRealtimePlayback = (nextTime, extra = {}, syncOptions = {}) => {
      const normalizedTime = snapEditorTimeToFrame(nextTime, sourceEditor);
      editorPlaybackSnapshotRef.current = {
        currentTime: normalizedTime,
        playbackMarkerTime: Number.isFinite(Number(sourceEditor.playbackMarkerTime)) ? Number(sourceEditor.playbackMarkerTime) : editorPlaybackSnapshotRef.current.playbackMarkerTime
      };
      drawEditorRealtimeOverlay({ ...sourceEditor, ...extra }, normalizedTime);
      updateEditorTransportReadout(normalizedTime, { ...sourceEditor, ...extra });

      const now = performance.now();
      const shouldSyncState = options.forceStateSync || syncOptions.forceStateSync || now - editorPlaybackStateSyncRef.current >= 120;
      if (shouldSyncState) {
        editorPlaybackStateSyncRef.current = now;
        setAudioEditor((current) => current ? editorWithPlaybackFollow(current, normalizedTime, extra) : current);
      }
    };
    const active = editorActiveSelectionRange(sourceEditor);
    const previewRanges = Array.isArray(sourceEditor?.previewSelectionRanges) ? sourceEditor.previewSelectionRanges : [];
    const previewIndex = Math.min(Math.max(Number(sourceEditor?.previewSelectionIndex) || 0, 0), Math.max(0, previewRanges.length - 1));
    const previewRange = sourceEditor?.previewMode === 'all-selections'
      ? previewRanges[previewIndex]
      : active;
    const selectionEnd = previewRange ? snapEditorTimeToFrame(previewRange.end, sourceEditor) : null;
    if (sourceEditor?.nativeWaveformOnly && sourceEditor.editorPlaying) {
      const frameStep = editorFrameDuration(sourceEditor);
      const lockedSegment = nativeEditorSegmentByIndex(sourceEditor, sourceEditor.playbackSegmentIndex);
      const currentWaveTime = Number(editorPlaybackSnapshotRef.current.currentTime) || sourceEditor.currentTime || 0;
      const activeSegment = lockedSegment
        && currentWaveTime >= lockedSegment.start - frameStep
        && currentWaveTime <= lockedSegment.end + frameStep
        ? lockedSegment
        : nativeEditorSegmentAtWaveTime(sourceEditor, currentWaveTime);
      const playbackTime = player.currentTime || 0;
      const segmentSampleRate = nativeSegmentSampleRate(activeSegment?.segment, editorSampleRate(sourceEditor));
      const playbackFrame = nativeSecondsToFrame(playbackTime, segmentSampleRate);
      const sourceStartFrame = activeSegment ? nativeSegmentSourceStartFrame(activeSegment.segment) : 0;
      const sourceEndFrame = activeSegment ? nativeSegmentSourceEndFrame(activeSegment.segment) : 0;

      if (activeSegment && playbackFrame >= sourceEndFrame - Math.max(1, Math.round(segmentSampleRate * 0.015))) {
        const nextWaveTime = activeSegment.end;
        if ((sourceEditor.previewMode === 'selection' || sourceEditor.previewMode === 'all-selections') && previewRange && nextWaveTime >= selectionEnd - editorFrameDuration(sourceEditor)) {
          advanceEditorSelectionPreview(player, sourceEditor, previewRange);
          return;
        }
        if (activeSegment.index < (sourceEditor.segments?.length || 0) - 1) {
          player.currentTime = editorWaveTimeToPlaybackTime(nextWaveTime, sourceEditor);
          syncRealtimePlayback(nextWaveTime, {
            playbackSegmentIndex: activeSegment.index + 1
          }, { forceStateSync: true });
          return;
        }
      }

      if (activeSegment) {
        const segmentFrameCount = nativeSegmentFrameCount(activeSegment.segment);
        const nextTimelineFrame = activeSegment.startFrame + Math.min(segmentFrameCount, Math.max(0, playbackFrame - sourceStartFrame));
        const nextWaveTime = nativeEditorFrameToTime(nextTimelineFrame, sourceEditor);
        if ((sourceEditor.previewMode === 'selection' || sourceEditor.previewMode === 'all-selections') && previewRange && nextWaveTime >= selectionEnd - editorFrameDuration(sourceEditor)) {
          advanceEditorSelectionPreview(player, sourceEditor, previewRange);
          return;
        }
        syncRealtimePlayback(nextWaveTime, {
          playbackSegmentIndex: activeSegment.index
        });
        return;
      }
    }
    const nextTime = editorPlaybackTimeToWaveTime(player.currentTime || 0, sourceEditor);
    syncRealtimePlayback(nextTime);
    if ((sourceEditor?.previewMode === 'selection' || sourceEditor?.previewMode === 'all-selections') && previewRange && nextTime >= snapEditorTimeToFrame(previewRange.end, sourceEditor)) {
      advanceEditorSelectionPreview(player, sourceEditor, previewRange);
    }
  }

  function handleEditorTimeUpdate(event) {
    syncEditorPlaybackTime(event.currentTarget, audioEditorRef.current);
  }

  useEffect(() => {
    if (!audioEditor?.editorPlaying) {
      cancelEditorPlaybackFrame();
      return undefined;
    }

    const tick = () => {
      const player = editorAudioRef.current;
      const editor = audioEditorRef.current;
      if (!player || !editor?.editorPlaying || player.paused || player.ended) {
        cancelEditorPlaybackFrame();
        return;
      }
      syncEditorPlaybackTime(player, editor);
      editorPlaybackFrameRef.current = window.requestAnimationFrame(tick);
    };

    cancelEditorPlaybackFrame();
    editorPlaybackFrameRef.current = window.requestAnimationFrame(tick);
    return cancelEditorPlaybackFrame;
  }, [audioEditor?.editorPlaying]);

  function handleEditorLoadedMetadata(event) {
    event.currentTarget.playbackRate = normalizeEditorPlaybackRate(editorPlaybackRate);
    const playbackDuration = event.currentTarget.duration || 0;
    if (!Number.isFinite(playbackDuration) || playbackDuration <= 0) return;
    setAudioEditor((current) => current ? { ...current, playbackDuration } : current);
  }

  function handleEditorEnded() {
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    cancelEditorPlaybackFrame();
    commitEditorPlaybackPosition(0, audioEditorRef.current, { editorPlaying: false, playbackSegmentIndex: null });
    setAudioEditor((current) => current ? { ...current, editorPlaying: false, currentTime: 0, playbackSegmentIndex: null } : current);
  }

  function handleEditorAudioError(event) {
    window.clearTimeout(editorSelectionPreviewTimerRef.current);
    cancelEditorPlaybackFrame();
    const mediaError = event.currentTarget.error;
    const message = mediaError?.message || `媒体错误码 ${mediaError?.code || 'unknown'}`;
    console.warn('编辑器音频加载失败:', mediaError);
    setEditorPlaybackState(false);
    setStatus(`音频播放失败：${message}`);
    setAudioEditor((current) => current ? { ...current, error: `音频播放失败：${message}` } : current);
  }

  async function saveNativeEditedAudio() {
    const nativeSegments = (audioEditor?.segments || [])
      .map((segment) => {
        const sampleRate = nativeSegmentSampleRate(segment, editorSampleRate(audioEditor));
        return {
          sourcePath: segment.sourcePath || audioEditor.playbackPath || audioEditor.sourcePath,
          sourceStartFrame: nativeSegmentSourceStartFrame(segment),
          sourceEndFrame: nativeSegmentSourceEndFrame(segment),
          sampleRate
        };
      })
      .filter((segment) => segment.sourcePath && segment.sourceEndFrame > segment.sourceStartFrame);

    if (!nativeSegments.length) {
      setStatus('没有可保存的编辑片段');
      setAudioEditor((current) => current ? { ...current, error: '没有可保存的编辑片段' } : current);
      return;
    }

    setAudioEditor((current) => current ? { ...current, busy: true, error: '' } : current);
    setStatus('正在按采样点导出编辑后的音频');
    try {
      const result = await invoke('export_editor_segments_mp3', {
        segments: nativeSegments,
        filename: audioEditor.filename || generateFilename('mp3'),
        bitrateKbps: bitrate,
        saveDir: saveDirectory.trim() || null
      });
      const savedPath = result?.path || '';
      const savedFilename = result?.filename || String(savedPath).split(/[\\/]/).pop() || audioEditor.filename || generateFilename('mp3');
      const displayFilename = audioEditor.filename || savedFilename;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(savedPath ? convertFileSrc(savedPath) : '');
      setMp3Blob(null);
      setLastSavedPath(savedPath);
      setLastSavedAudio({ path: savedPath, filename: savedFilename, displayFilename });
      setRestartPromptOpen(false);
      setSavePrompt({ filename: savedFilename, savedPath });
      setStatus(`已保存编辑后的音频：${savedFilename}`);
      if (cacheDeleteOnSaveRef.current) await deleteCurrentRecordingCache();
      if (savedPath) uploadSavedAudioToGoogleDrive(savedPath, savedFilename, displayFilename);
      await deleteEditorTemporaryAudioFiles(audioEditor);
      await closeAudioEditor();
    } catch (error) {
      console.warn('保存长音频编辑失败:', error);
      setAudioEditor((current) => current ? { ...current, busy: false, error: `保存编辑失败：${error?.message || error}` } : current);
      setStatus(`保存编辑失败：${error?.message || error}`);
    }
  }

  async function saveEditedAudio() {
    if (!audioEditor || audioEditor.loading || audioEditor.busy) return;
    if (audioEditor.nativeWaveformOnly) {
      await saveNativeEditedAudio();
      return;
    }
    if (!ensureDecodedEditorAudio('保存新版本')) return;
    if (!audioEditor.audioBuffer || !audioEditor.sourceBlob) {
      setStatus(audioEditor.error || '音频编辑数据未准备好');
      return;
    }

    setAudioEditor((current) => current ? { ...current, busy: true } : current);
    setStatus('正在保存编辑后的音频');
    try {
      const editedBlob = audioEditor.sourceBlob;
      const editedUrl = URL.createObjectURL(editedBlob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setMp3Blob(editedBlob);
      setAudioUrl(editedUrl);
      await saveBlob(editedBlob, audioEditor.filename);
      await deleteEditorTemporaryAudioFiles(audioEditor);
      await closeAudioEditor();
    } catch (error) {
      console.warn('保存编辑音频失败:', error);
      setAudioEditor((current) => current ? { ...current, busy: false, error: `保存编辑失败：${error?.message || error}` } : current);
      setStatus(`保存编辑失败：${error?.message || error}`);
    }
  }

  // 停止录音后统一释放麦克风、AudioContext、Worklet/Processor。
  async function stopEverything(refreshDevicesAfterStop = false) {
    stopTimer();
    stopAutoCacheTimer();
    try {
      processorRef.current?.disconnect?.();
      sourceRef.current?.disconnect?.();
      sourceNodesRef.current.forEach((sourceNode) => sourceNode.disconnect?.());
      inputStreamsRef.current.forEach((inputStream) => {
        inputStream.getTracks?.().forEach((track) => track.stop());
      });
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      if (audioContextRef.current?.state !== 'closed') await audioContextRef.current?.close?.();
    } catch {
      // 资源释放采用尽力清理，避免关闭流程被单个对象异常打断。
    }
    mediaRecorderRef.current = null;
    streamRef.current = null;
    inputStreamsRef.current = [];
    audioContextRef.current = null;
    sourceRef.current = null;
    sourceNodesRef.current = [];
    analyserRef.current = null;
    dataArrayRef.current = null;
    processorRef.current = null;
    cacheFilenameRef.current = '';
    cacheFileReservedRef.current = false;
    cacheWrittenChunkCountRef.current = 0;
    if (refreshDevicesAfterStop) refreshMicrophoneDevices(false);
  }

  // 首选 Tauri 后端保存到本地目录；浏览器预览页则退回浏览器保存机制。
  async function saveBlob(blob, filename, options = {}) {
    if (!blob) return '';
    try {
      const base64Data = await blobToBase64(blob);
      const saveDir = saveDirectory.trim() || null;
      const savedPath = await invoke('save_audio_file', { filename, base64Data, saveDir });
      const savedFilename = String(savedPath).split(/[\\/]/).pop() || filename;
      if (cacheDeleteOnSaveRef.current) await deleteCurrentRecordingCache();
      const savedAudio = { path: savedPath, filename: savedFilename, displayFilename: filename };
      setLastSavedPath(savedPath);
      setLastSavedAudio(savedAudio);
      setRestartPromptOpen(false);
      setSavePrompt({ filename: savedFilename, savedPath });
      setStatus(`已保存 ${savedFilename}`);
      if (options.autoUpload !== false) {
        uploadSavedAudioToGoogleDrive(savedPath, savedFilename, filename);
      }
      return savedPath;
    } catch (error) {
      const fallbackUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fallbackUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(fallbackUrl), 1000);
      setRestartPromptOpen(false);
      setSavePrompt({ filename, savedPath: '' });
      setStatus(`已保存 ${filename}`);
      console.warn(error);
      return '';
    }
  }

  async function saveEditorSourceBlob(blob, filename) {
    if (!blob || !isTauriRuntime()) return '';
    const base64Data = await blobToBase64(blob);
    return invoke('save_editor_source_file', { filename, base64Data, saveDir: saveDirectory.trim() || null });
  }

  async function startRecordingSession() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('当前环境不支持麦克风录音');
      return;
    }
    if (!window.lamejs?.Mp3Encoder) {
      setStatus('MP3 编码器未加载');
      return;
    }

    try {
      setSavePrompt(null);
      revokeAudioEditorUrls(audioEditor);
      setAudioEditor(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl('');
      setWebmBlob(null);
      setMp3Blob(null);
      setLastSavedPath('');
      setLastSavedAudio(null);
      setLastUploadedAudio(null);
      setFilenameMenu(null);
      setTotalSeconds(0);
      chunksRef.current = [];
      mp3DataRef.current = [];
      cacheSavedFilenameRef.current = '';
      cacheWrittenChunkCountRef.current = 0;

      const selectedEntries = selectedMicrophoneEntries();
      if (!selectedEntries.length) {
        setStatus(`${activeMicrophoneSlot} 号麦克风槽位为空`);
        return;
      }
      const inputStreams = await Promise.all(selectedEntries.map(captureMicrophoneStream));
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const destination = audioContext.createMediaStreamDestination();
      const inputSources = inputStreams.map((inputStream) => {
        const inputSource = audioContext.createMediaStreamSource(inputStream);
        inputSource.connect(destination);
        return inputSource;
      });
      const source = audioContext.createMediaStreamSource(destination.stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);

      streamRef.current = destination.stream;
      inputStreamsRef.current = inputStreams;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      sourceNodesRef.current = inputSources;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
      mp3EncoderRef.current = new window.lamejs.Mp3Encoder(1, audioContext.sampleRate, bitrate);
      processorRef.current = await createMp3Processor(audioContext, source);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      cacheMimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(destination.stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        try {
          await processorRef.current?.flush?.();
          const finalBuffer = mp3EncoderRef.current?.flush?.();
          if (finalBuffer?.length > 0) mp3DataRef.current.push(new Int8Array(finalBuffer));

          const nextWebmBlob = new Blob(chunksRef.current, { type: mimeType });
          const nextMp3Blob = new Blob(mp3DataRef.current, { type: 'audio/mp3' });
          const nextUrl = URL.createObjectURL(nextWebmBlob);
          setWebmBlob(nextWebmBlob);
          setMp3Blob(nextMp3Blob);
          setAudioUrl(nextUrl);
          setStatus('录音完成');

          const mp3Filename = generateFilename('mp3');
          if (autoOpenEditorRef.current) {
            let editorSourcePath = '';
            try {
              editorSourcePath = await saveEditorSourceBlob(nextMp3Blob, mp3Filename);
            } catch (error) {
              console.warn('创建编辑器临时音频失败:', error);
              setStatus(`创建编辑器临时音频失败，尝试使用内存音频: ${error?.message || error}`);
            }
            await openAudioEditor(editorSourcePath ? null : nextMp3Blob, {
              path: editorSourcePath,
              filename: mp3Filename,
              autoSaveAfterEdit: true,
              fromRecordingStop: true
            });
          } else if (autoSaveRef.current) {
            await saveBlob(nextMp3Blob, mp3Filename);
          }
        } finally {
          await stopEverything(true);
          if (closeAfterRecordingStopRef.current) {
            if (shellActionInstanceRef.current && isTauriRuntime()) {
              await invoke('quit_all_windows').catch((error) => console.warn('退出右键菜单实例失败:', error));
            } else {
              await runWindowAction('close');
            }
            closeAfterRecordingStopRef.current = false;
          }
          if (quitAllAfterRecordingStopRef.current) {
            await invoke('quit_all_windows').catch((error) => console.warn('退出全部失败:', error));
            quitAllAfterRecordingStopRef.current = false;
          }
        }
      };

      const startedTimeText = currentTimeText();
      recordingStartedTimeRef.current = startedTimeText;
      setRecordingStartedTimeText(startedTimeText);
      cacheFilenameRef.current = generateCacheFilename('webm');
      cacheFileReservedRef.current = false;
      cacheWrittenChunkCountRef.current = 0;
      cleanupExpiredRecordingCache(false);
      recorder.start();
      setIsRecording(true);
      setStatus('🔴正在录音。。。');
      startTimer();
      startAutoCacheTimer(mimeType);
    } catch (error) {
      setIsRecording(false);
      await stopEverything(true);
      setStatus(`录音启动失败: ${error?.message || error}`);
    }
  }

  // 主录音流程：停止当前录音，或在已有录音结果时先确认是否清空界面并重新开始。
  async function toggleRecording() {
    if (isRecording) {
      setStatus('正在结束录音');
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      stopTimer();
      return;
    }

    if (hasCurrentRecording) {
      setSavePrompt(null);
      setRestartPromptOpen(true);
      return;
    }

    await startRecordingSession();
  }

  async function confirmRestartRecording() {
    setRestartPromptOpen(false);
    await startRecordingSession();
  }

  function requestCloseWindow() {
    if (!isRecording) {
      if (shellActionInstanceRef.current && isTauriRuntime()) {
        invoke('quit_all_windows').catch((error) => console.warn('退出右键菜单实例失败:', error));
      } else {
        runWindowAction('close');
      }
      return;
    }
    setSavePrompt(null);
    setRestartPromptOpen(false);
    setQuitAllPromptOpen(false);
    setClosePromptOpen(true);
  }

  async function confirmCloseWhileRecording() {
    setClosePromptOpen(false);
    setQuitAllPromptOpen(false);
    closeAfterRecordingStopRef.current = true;
    setStatus('正在结束录音并关闭');

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopTimer();
      return;
    }

    await stopEverything();
    if (shellActionInstanceRef.current && isTauriRuntime()) {
      await invoke('quit_all_windows').catch((error) => console.warn('退出右键菜单实例失败:', error));
    } else {
      await runWindowAction('close');
    }
    closeAfterRecordingStopRef.current = false;
  }

  async function confirmQuitAllWhileRecording() {
    setClosePromptOpen(false);
    setQuitAllPromptOpen(false);
    quitAllAfterRecordingStopRef.current = true;
    setStatus('正在结束录音并退出全部');

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopTimer();
      return;
    }

    await stopEverything();
    await invoke('quit_all_windows').catch((error) => console.warn('退出全部失败:', error));
    quitAllAfterRecordingStopRef.current = false;
  }

  function buildTimecodeHtml(styleType, timeText) {
    const computed = timecodeRef.current ? getComputedStyle(timecodeRef.current) : null;
    const color = computed?.color || '#0f9c3d';
    const fontFamily = computed?.fontFamily || 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif';
    const fontWeight = computed?.fontWeight || '900';
    const escapedTime = escapeHtml(timeText);
    const baseStyle = [
      `color: ${color}`,
      `font-family: ${fontFamily}`,
      `font-weight: ${fontWeight}`,
      'font-variant-numeric: tabular-nums',
      'font-feature-settings: "tnum" 1',
      'letter-spacing: 0'
    ];

    if (styleType === 'color') {
      return `<span style="${baseStyle.join('; ')};">${escapedTime}</span>`;
    }

    if (styleType === 'color23' || styleType === 'color23bg') {
      const style = [...baseStyle, 'font-size: 23px', 'line-height: 1.1'];
      if (styleType === 'color23bg') {
        style.push('background: rgba(15, 156, 61, 0.12)', 'border-radius: 5px', 'padding: 2px 6px');
      }
      return `<span style="${style.join('; ')};">${escapedTime}</span>`;
    }

    const fullStyle = [
      ...baseStyle,
      `font-size: ${computed?.fontSize || '58px'}`,
      `line-height: ${computed?.lineHeight || '1'}`,
      `text-shadow: ${computed?.textShadow || 'none'}`,
      `background: ${computed?.background || 'transparent'}`,
      `border-radius: ${computed?.borderRadius || '0'}`,
      'display: inline-block',
      'padding: 0 2px'
    ];
    return `<span style="${fullStyle.join('; ')};">${escapedTime}</span>`;
  }

  function showTimeCopyNotice(message, success) {
    const rect = timecodeRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? Math.max(8, rect.top - 10) : 20;
    window.clearTimeout(timeCopyNoticeTimerRef.current);
    setTimeCopyNotice({ message, success, x, y });
    timeCopyNoticeTimerRef.current = window.setTimeout(() => setTimeCopyNotice(null), 1000);
  }

  async function copyTimecode(styleType = timeCopyStyle) {
    const nextStyle = normalizeTimeCopyStyle(styleType);
    const text = displayTime;
    try {
      if (nextStyle !== 'plain' && navigator.clipboard?.write && window.ClipboardItem) {
        const html = buildTimecodeHtml(nextStyle, text);
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          })
        ]);
        showTimeCopyNotice('已复制', true);
        return;
      }

      await navigator.clipboard.writeText(text);
      showTimeCopyNotice('已复制', true);
    } catch (error) {
      try {
        await navigator.clipboard.writeText(text);
        showTimeCopyNotice('已复制文本', true);
      } catch (fallbackError) {
        console.warn('复制时间码失败:', error, fallbackError);
        showTimeCopyNotice('复制失败', false);
      }
    }
  }

  function openTimeCopyMenu(event) {
    event.preventDefault();
    const menuWidth = 172;
    const menuHeight = 192;
    setTimeCopyMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  }

  function chooseTimeCopyStyle(styleType) {
    const nextStyle = normalizeTimeCopyStyle(styleType);
    setTimeCopyStyle(nextStyle);
    setTimeCopyMenu(null);
  }

  function openEditorPlaybackRateMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 172;
    const menuHeight = 336;
    setEditorFrameRateMenu(null);
    setEditorPlaybackRateDraft(String(editorPlaybackRate));
    setEditorPlaybackRateMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  }

  function chooseEditorPlaybackRate(value) {
    const nextRate = normalizeEditorPlaybackRate(value);
    setEditorPlaybackRate(nextRate);
    if (editorAudioRef.current) editorAudioRef.current.playbackRate = nextRate;
    setEditorPlaybackRateMenu(null);
  }

  function applyCustomEditorPlaybackRate() {
    chooseEditorPlaybackRate(editorPlaybackRateDraft);
  }

  function openEditorFrameRateMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 228;
    const menuHeight = 360;
    setEditorPlaybackRateMenu(null);
    setEditorFrameRateMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  }

  function chooseEditorFrameRate(value) {
    setEditorFrameRate(normalizeEditorFrameRate(value));
    setEditorFrameRateMenu(null);
  }

  function handleTimecodeKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    copyTimecode();
  }

  async function showTitlePresetMenu(event) {
    event.preventDefault();
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法打开独立预设菜单');
      return;
    }

    try {
      const position = new LogicalPosition(Math.max(0, event.screenX), Math.max(0, event.screenY));
      const existingMenu = await WebviewWindow.getByLabel(PRESET_MENU_LABEL);
      if (existingMenu) {
        await existingMenu.setPosition(position);
        await existingMenu.show();
        await existingMenu.setFocus();
        return;
      }

      const presetMenu = new WebviewWindow(PRESET_MENU_LABEL, {
        url: '/?menu=presets',
        title: 'AudioRecorder Presets',
        width: 300,
        height: 390,
        minWidth: 300,
        minHeight: 390,
        x: position.x,
        y: position.y,
        resizable: false,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: true
      });
      presetMenu.once('tauri://error', (errorEvent) => {
        console.warn('打开预设菜单窗口失败:', errorEvent.payload);
        setStatus(`打开预设菜单失败: ${errorEvent.payload}`);
      });
    } catch (error) {
      console.warn('打开预设菜单窗口失败:', error);
      setStatus(`打开预设菜单失败: ${error?.message || error}`);
    }
  }

  function commitPresetList(updater) {
    setPresets((items) => {
      const nextPresets = typeof updater === 'function' ? updater(items) : updater;
      savePresetList(nextPresets);
      return nextPresets;
    });
  }

  function startTitlePresetEditing() {
    if (isDefaultPresetWindow) return;
    setTitlePresetDraft({
      icon: currentPreset.icon || '',
      title: currentPreset.title || ''
    });
    setTitlePresetEditing(true);
  }

  function saveTitlePresetDraft() {
    if (isDefaultPresetWindow || !titlePresetEditing) return;
    const nextIcon = String(titlePresetDraft.icon).slice(0, 2);
    const nextTitle = sanitizePart(titlePresetDraft.title);
    commitPresetList((items) => items.map((preset) => (
      preset.id === activePresetId ? { ...preset, icon: nextIcon, title: nextTitle } : preset
    )));
    setTitlePresetEditing(false);
  }

  function handleTitlePresetKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitlePresetDraft();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setTitlePresetEditing(false);
    }
  }

  function updateTitlePresetIcon(value) {
    const characters = Array.from(String(value));
    setTitlePresetDraft((draft) => ({
      ...draft,
      icon: characters.length ? characters[characters.length - 1] : ''
    }));
  }

  // 支持“备注 @ 链接/路径”的多行快捷打开。
  async function openLinks() {
    const targets = linksText
      .split('\n')
      .map((line) => {
        const pieces = line.split('@');
        return pieces.length > 1 ? pieces.slice(1).join('@').trim() : line.trim();
      })
      .filter(Boolean);

    if (!targets.length) {
      setStatus('请先在设置中填写链接或路径');
      setSettingsOpen(true);
      return;
    }

    for (const target of targets) {
      try {
        await invoke('open_target', { target });
      } catch (error) {
        console.warn(error);
      }
    }
    setStatus(`已打开 ${targets.length} 个链接`);
  }

  async function openSavedFolder() {
    setSavePrompt(null);
    try {
      await invoke('open_recordings_folder', { saveDir: saveDirectory.trim() || null });
    } catch (error) {
      console.warn(error);
      setStatus('浏览器预览页无法直接打开本地文件夹');
    }
  }

  async function openDriveLink(link) {
    if (!link) return;
    setFilenameMenu(null);
    try {
      await invoke('open_target', { target: link });
    } catch (error) {
      console.warn(error);
      setStatus(`打开云端链接失败: ${error?.message || error}`);
    }
  }

  async function copyDriveShareLink(link = drivePrompt?.fileLink) {
    const targetLink = typeof link === 'string' ? link : drivePrompt?.fileLink;
    if (!targetLink) {
      setStatus('没有可复制的云端链接');
      return;
    }
    try {
      await navigator.clipboard.writeText(targetLink);
      setStatus('已复制可分享链接');
    } catch (error) {
      console.warn(error);
      setStatus(`复制可分享链接失败: ${error?.message || error}`);
    }
    setFilenameMenu(null);
  }

  async function chooseSaveDirectory() {
    if (!isTauriRuntime()) {
      setStatus('浏览器预览页无法打开文件夹选择窗口');
      return;
    }
    try {
      const selected = await invoke('select_save_directory', {
        currentDir: saveDirectory.trim() || defaultSaveDirectory || null
      });
      if (selected) {
        setSaveDirectory(selected);
        setStatus('已更新保存路径');
      }
    } catch (error) {
      console.warn(error);
      setStatus(`选择保存路径失败: ${error?.message || error}`);
    }
  }

  function applyGlobalWindowScale(scalePercent) {
    const nextScale = normalizeWindowScale(scalePercent);
    setGlobalWindowScale(nextScale);
    localStorage.setItem(GLOBAL_WINDOW_SCALE_KEY, String(nextScale));
    if (isTauriRuntime()) {
      emit(GLOBAL_SCALE_UPDATED_EVENT, { scale: nextScale })
        .catch((error) => console.warn('广播全局缩放失败:', error));
    }
    setStatus(`窗口缩放 ${nextScale}%`);
  }

  function restoreDefaultSettings() {
    if (isRecording) {
      setStatus('录音中不能恢复默认设置');
      return;
    }
    setAutoSave(true);
    setAutoOpenEditor(false);
    setAutoCache(false);
    setCacheIntervalSeconds(DEFAULT_CACHE_INTERVAL);
    setBitrate(DEFAULT_BITRATE);
    applyGlobalWindowScale(DEFAULT_WINDOW_SCALE);
    setTokens(DEFAULT_TOKEN_TYPES.map(makeToken));
    setRecordingDate('');
    setNamePart(TEXT_DEFAULTS.name);
    setNumberDigits(0);
    setCustomPart(TEXT_DEFAULTS.custom);
    setSaveDirectory('');
    setGoogleDriveAutoUpload(false);
    setGoogleDrivePublicShare(false);
    setGoogleDriveClientId('');
    setGoogleDriveClientSecret('');
    setGoogleDriveFolderId('');
    setMicrophoneSlots([...DEFAULT_MICROPHONE_SLOTS]);
    setActiveMicrophoneSlot(0);
    setLinksText('');
    setLastSavedPath('');
    setLastSavedAudio(null);
    setLastUploadedAudio(null);
    setFilenameMenu(null);
    setTokenPickerOpen(false);
    setEditingTextToken(null);
    setStatus('已恢复默认设置');
  }

  function addToken(type) {
    const token = makeToken(type);
    if (type === 'name' || type === 'custom') token.manualValue = false;
    setTokens((items) => [...items, token]);
  }

  function removeToken(id) {
    setTokens((items) => items.filter((item) => item.id !== id));
  }

  function updateToken(id, value) {
    setTokens((items) => items.map((item) => (
      item.id === id ? { ...item, value, manualValue: item.type === 'name' || item.type === 'custom' ? true : item.manualValue } : item
    )));
  }

  function textTokenBase(type) {
    if (type === 'name') return textBaseWithoutAutoNumber(namePart, TEXT_DEFAULTS.name);
    if (type === 'custom') return textBaseWithoutAutoNumber(customPart, TEXT_DEFAULTS.custom);
    return '';
  }

  function isAutoTextToken(token) {
    if (token.type !== 'name' && token.type !== 'custom') return false;
    if (token.manualValue) return false;
    const base = textTokenBase(token.type);
    if (!token.value || token.value === base) return true;
    const autoBases = [base, ...(LEGACY_TEXT_DEFAULTS[token.type] || [])];
    return autoBases.some((item) => token.value === item || new RegExp(`^${escapeRegExp(item)}\\d+$`).test(token.value));
  }

  function textTokenValue(token) {
    if (token.type !== 'name' && token.type !== 'custom') return tokenLabels[token.type];
    if (!isAutoTextToken(token)) return token.value;
    const sameTypeTokens = tokens.filter((item) => item.type === token.type);
    const index = sameTypeTokens.findIndex((item) => item.id === token.id);
    const base = textTokenBase(token.type);
    return sameTypeTokens.length > 1 && index >= 0 ? `${base}${index + 1}` : base;
  }

  function editableTokenValue(token) {
    return textTokenValue(token);
  }

  async function togglePinnedWindow() {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWindow().setAlwaysOnTop(nextPinned);
    } catch (error) {
      setIsPinned(!nextPinned);
      console.warn('切换窗口置顶失败:', error);
    }
  }

  function adjustTimeOffsetByWheel(event) {
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    setTimeOffset((value) => value + step);
  }

  function dragWindow(event) {
    if (!isTauriRuntime()) return;
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target.closest('.title-preset-display, .title-preset-editor, .title-preset-icon-input, .title-preset-name-input')) return;
    if (event.target.closest('button, label, input, select, textarea, a, [role="menu"]')) return;
    getCurrentWindow().startDragging().catch((error) => console.warn('拖动窗口失败:', error));
  }

  function dragPresetTitleWindow(event) {
    if (!isTauriRuntime()) return;
    if (event.button !== 0 || event.detail > 1) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let startedDragging = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', cleanup, true);
      window.removeEventListener('pointercancel', cleanup, true);
    };

    const handlePointerMove = (moveEvent) => {
      if (startedDragging || (moveEvent.buttons & 1) !== 1) {
        cleanup();
        return;
      }

      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (Math.hypot(deltaX, deltaY) < 2) return;

      startedDragging = true;
      cleanup();
      getCurrentWindow().startDragging().catch((error) => console.warn('拖动预设标题窗口失败:', error));
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', cleanup, true);
    window.addEventListener('pointercancel', cleanup, true);
  }

  function dragAudioEditorWindow(event) {
    if (!isTauriRuntime()) return;
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target.closest('button, label, input, select, textarea, a, canvas')) return;
    if (event.target.closest('.audio-editor-toolbar, .audio-editor-controls, .audio-editor-wave-panel, .audio-editor-mini-wave, .audio-editor-actions')) return;
    getCurrentWindow().startDragging().catch((error) => console.warn('拖动音频编辑窗口失败:', error));
  }

  async function toggleAudioEditorMaximize(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      console.warn('切换音频编辑窗口最大化失败:', error);
      setStatus(`切换编辑器最大化失败：${error?.message || error}`);
    }
  }

  function openSettingsInRegularMode() {
    setLayoutMode('regular');
    setSettingsOpen(true);
  }

  function toggleSettingsInRegularMode() {
    if (!settingsOpen) {
      openSettingsInRegularMode();
      return;
    }
    setSettingsOpen(false);
  }

  function openSettingsContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    setCacheMenuOpen(false);
    setSettingsMenuOpen(true);
  }

  async function toggleStartupEnabled() {
    const nextEnabled = !startupEnabled;
    if (!isTauriRuntime()) {
      setStartupEnabled(nextEnabled);
      localStorage.setItem(STARTUP_ENABLED_KEY, nextEnabled ? 'true' : 'false');
      setStatus(`开机自启已${nextEnabled ? '开启' : '关闭'}`);
      return;
    }

    try {
      const enabled = await invoke('set_startup_enabled', { enabled: nextEnabled });
      const normalized = Boolean(enabled);
      setStartupEnabled(normalized);
      localStorage.setItem(STARTUP_ENABLED_KEY, normalized ? 'true' : 'false');
      setStatus(`开机自启已${normalized ? '开启' : '关闭'}`);
    } catch (error) {
      console.warn('设置开机自启失败:', error);
      setStatus(`设置开机自启失败：${error?.message || error}`);
    }
  }

  const filenameMenuUploadedAudio = currentUploadedAudio();

  return (
    <main className={`app-shell ${windowReady ? 'window-ready' : ''}`}>
      <section className={`recorder-window ${layoutMode === 'mini' ? 'mini-mode' : 'regular-mode'}`}>
        <header className="title-bar" onPointerDownCapture={dragWindow}>
          <div className="brand">
            <button className="traffic red" type="button" aria-label="关闭" data-tooltip="关闭" onClick={requestCloseWindow} />
            <button className="traffic yellow" type="button" aria-label="最小化" data-tooltip="最小化" onClick={() => runWindowAction('minimize')} />
            <button
              className={`traffic green ${isPinned ? 'pinned' : ''}`}
              type="button"
              aria-label={isPinned ? '取消置顶' : '置顶窗口'}
              data-tooltip={isPinned ? '取消置顶' : '置顶窗口'}
              aria-pressed={isPinned}
              onClick={togglePinnedWindow}
            >
              {isPinned && <ArrowUp size={10} />}
            </button>
            <div className={`title-identity ${usePresetTitleIdentity ? 'preset-title-mode' : ''}`}>
              <div className="title-microphone-picker">
                <button
                  className={`title-microphone-current ${microphoneSlotStateClass(activeMicrophoneSlot)}`}
                  type="button"
                  aria-label={`当前 ${microphoneSlotTooltip(activeMicrophoneSlot)}`}
                  data-tooltip={microphoneSlotTooltip(activeMicrophoneSlot)}
                  onClick={() => setTitleMicrophonePickerOpen((value) => !value)}
                >
                  {activeMicrophoneSlot}
                </button>
                {titleMicrophonePickerOpen && (
                  <div className="title-microphone-options">
                    {microphoneSlots.map((deviceId, slotIndex) => (
                      <button
                        className={`title-microphone-option ${activeMicrophoneSlot === slotIndex ? 'active' : ''} ${microphoneSlotStateClass(slotIndex)}`}
                        key={slotIndex}
                        type="button"
                        aria-label={`选择 ${microphoneSlotTooltip(slotIndex)}`}
                        data-tooltip={microphoneSlotTooltip(slotIndex)}
                        onClick={() => selectTitleMicrophoneSlot(slotIndex)}
                      >
                        {slotIndex}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="title-text" onContextMenu={showTitlePresetMenu}>
                {!usePresetTitleIdentity ? (
                  <h1 data-tooltip={`当前预设：${titlePreset.icon} ${presetDisplayTitle(titlePreset)}，右键管理预设`}>音频录制器 <span>{VERSION}</span></h1>
                ) : titlePresetEditing ? (
                  <span
                    className="title-preset-editor"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) saveTitlePresetDraft();
                    }}
                    onKeyDown={handleTitlePresetKeyDown}
                  >
                    <input
                      className="title-preset-icon-input"
                      value={titlePresetDraft.icon}
                      aria-label="预设图标"
                      autoFocus
                      onChange={(event) => updateTitlePresetIcon(event.target.value)}
                    />
                    <input
                      className="title-preset-name-input"
                      value={titlePresetDraft.title}
                      aria-label="预设名称"
                      placeholder="未命名"
                      onChange={(event) => setTitlePresetDraft((value) => ({ ...value, title: event.target.value }))}
                    />
                  </span>
                ) : (
                  <button
                    className="title-preset-display"
                    type="button"
                    data-tooltip="双击编辑预设，右键管理预设"
                    onPointerDown={dragPresetTitleWindow}
                    onDoubleClick={startTitlePresetEditing}
                  >
                    <span className="title-preset-icon">{titlePreset.icon}</span>
                    <span className={`title-preset-name ${titlePreset.title ? '' : 'empty'}`}>
                      {presetDisplayTitle(titlePreset)}
                    </span>
                  </button>
                )}
                <p>{status}</p>
              </div>
            </div>
          </div>

          <div className="title-actions">
            <label
              className="auto-save"
              aria-label="自动保存"
              data-tooltip="自动保存"
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setCacheMenuOpen(false);
                setAutoSaveMenuOpen(true);
              }}
            >
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(event) => setAutoSave(event.target.checked)}
              />
              <i />
              {autoSaveMenuOpen && (
                <div
                  ref={autoSaveMenuRef}
                  className="cache-menu-popover auto-save-menu-popover"
                  role="menu"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <button
                    className={deleteLocalAfterUpload ? 'selected' : ''}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={deleteLocalAfterUpload}
                    onClick={() => setDeleteLocalAfterUpload((value) => !value)}
                  >
                    <span>上传完成后删除本地文件</span>
                    <strong>{deleteLocalAfterUpload ? '开' : '关'}</strong>
                  </button>
                  <div className="cache-menu-divider" />
                  {CACHE_RETENTION_OPTIONS.map((option) => (
                    <button
                      className={uploadedLocalRetentionDays === option.value ? 'selected' : ''}
                      type="button"
                      role="menuitemradio"
                      aria-checked={uploadedLocalRetentionDays === option.value}
                      key={option.value}
                      onClick={() => setUploadedLocalRetentionDays(option.value)}
                    >
                      <span>{option.label}</span>
                      {uploadedLocalRetentionDays === option.value && <strong>已选</strong>}
                    </button>
                  ))}
                  <div className="cache-menu-divider" />
                  <button type="button" role="menuitem" onClick={cleanExpiredUploadedLocalFilesNow}>
                    <span>立即清理过期本地文件</span>
                  </button>
                  <div className="cache-menu-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAutoSaveMenuOpen(false);
                      setUploadedLocalCleanupHelpOpen(true);
                    }}
                  >
                    <span>清理文件说明</span>
                  </button>
                </div>
              )}
              {uploadedLocalCleanupHelpOpen && (
                <div
                  ref={uploadedLocalCleanupHelpRef}
                  className="uploaded-cleanup-help-popover"
                  role="dialog"
                  aria-label="清理文件说明"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setUploadedLocalCleanupHelpOpen(false);
                  }}
                >
                  <strong>清理文件说明</strong>
                  <p>上传成功后，软件会记录这个本地文件路径和上传时间。</p>
                  <p>开启“上传完成后删除本地文件”时，上传成功后会立刻删除这个本地文件。</p>
                  <p>未开启立刻删除时，会按保留 1 天、3 天、7 天或 30 天清理。</p>
                  <p>“立即清理过期本地文件”只清理已经上传成功并被记录过的本地音频。</p>
                  <p>“不自动清理”表示不会按天数自动删除，只保留记录。</p>
                  <em>手动放进保存目录、没有被软件记录过的旧 MP3，不会主动删除。</em>
                </div>
              )}
            </label>
            <button
              ref={settingsButtonRef}
              className="icon-button"
              type="button"
              aria-label="设置"
              data-tooltip="设置"
              onClick={toggleSettingsInRegularMode}
              onContextMenu={openSettingsContextMenu}
            >
              <Settings size={26} />
            </button>
            {settingsMenuOpen && (
              <div
                ref={settingsMenuRef}
                className="settings-context-menu"
                role="menu"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button
                  className={startupEnabled ? 'selected' : ''}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={startupEnabled}
                  onClick={toggleStartupEnabled}
                >
                  <span>开机自启</span>
                  <strong>{startupEnabled ? '开' : '关'}</strong>
                </button>
                <div className="settings-context-divider" />
                <button className="version-row" type="button" role="menuitem" disabled>
                  <span>软件版本</span>
                  <strong>V{VERSION}</strong>
                </button>
              </div>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label={layoutMode === 'mini' ? '切换常规界面' : '切换迷你界面'}
              data-tooltip={layoutMode === 'mini' ? '切换常规界面' : '切换迷你界面'}
              onClick={() => setLayoutMode((value) => (value === 'mini' ? 'regular' : 'mini'))}
            >
              {layoutMode === 'mini' ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
            </button>
          </div>
        </header>

        <div className="main-grid">
          <button
            className={`record-button ${isRecording ? 'recording' : ''}`}
            type="button"
            aria-label={isRecording ? '停止录音' : '开始录音'}
            onClick={toggleRecording}
          >
            {isRecording ? <Square size={50} fill="currentColor" /> : <Play size={58} fill="currentColor" />}
          </button>

          <div className="time-block">
            <div className="time-row">
              <button
                ref={timecodeRef}
                className="timer"
                type="button"
                aria-label={`复制时间码 ${displayTime}`}
                onClick={() => copyTimecode()}
                onContextMenu={openTimeCopyMenu}
                onKeyDown={handleTimecodeKeyDown}
              >
                {displayTime.split('').map((char, index) => (
                  <span className={char === ':' ? 'timer-colon' : 'timer-digit'} key={`${char}-${index}`}>
                    {char}
                  </span>
                ))}
              </button>
              <div className="seconds-control">
                <input
                  value={timeOffset === 0 ? '' : timeOffset}
                  type="number"
                  placeholder="±秒"
                  onChange={(event) => setTimeOffset(Number(event.target.value || 0))}
                  onWheel={adjustTimeOffsetByWheel}
                />
              </div>
            </div>
            <canvas ref={canvasRef} className="waveform" width="760" height="130" />
            {shellUploadSummary ? (
              <div className="shell-upload-panel" aria-live="polite">
                <div className="shell-upload-head">
                  <strong title={shellUploadSummary.presetTitle || '默认设置'}>
                    {shellUploadSummary.presetTitle || '默认设置'}
                  </strong>
                  <span>
                    {String(shellUploadSummary.completed || 0).padStart(2, '0')}/
                    {String(shellUploadSummary.total || 0).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    disabled={!(shellUploadSummary.uploadItems || []).some((item) => item.link)}
                    onClick={() => copyDriveShareLink((shellUploadSummary.uploadItems || []).map((item) => item.link).filter(Boolean).join('\n'))}
                  >
                    复制全部
                  </button>
                </div>
                <i className="shell-upload-total-progress">
                  <b style={{ width: `${uploadProgress?.percent || (shellUploadSummary.total ? Math.round((shellUploadSummary.completed / shellUploadSummary.total) * 100) : 0)}%` }} />
                </i>
                <div className="shell-upload-list">
                  {(shellUploadSummary.uploadItems || []).map((item) => (
                    <div className={`shell-upload-row ${item.state}`} key={item.filePath}>
                      <strong title={item.filename}>{item.filename}</strong>
                      <span title={item.link || (item.state === 'failed' ? '上传失败' : '等待上传')}>
                        {item.link || (item.state === 'failed' ? '上传失败' : item.state === 'uploading' ? '上传中...' : '等待上传')}
                      </span>
                      <button
                        type="button"
                        disabled={!item.link}
                        onClick={() => copyDriveShareLink(item.link)}
                      >
                        复制链接
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : uploadProgress ? (
              <div className={`upload-progress ${uploadProgress.state}`} aria-live="polite">
                <span>
                  {uploadProgress.state === 'failed' ? '上传失败' : `上传 ${uploadProgress.percent}%`}
                </span>
                <i>
                  <b style={{ width: `${uploadProgress.percent}%` }} />
                </i>
              </div>
            ) : (
              <p className="center-status" aria-live="polite">{status}</p>
            )}
          </div>
        </div>

        <div className="filename-pill" onContextMenu={openFilenameMenu}>
          <button
            className="audio-edit-trigger"
            type="button"
            disabled={isRecording || !canOpenCurrentAudioEditor}
            aria-label="打开音频编辑界面"
            data-tooltip={isRecording ? '录音中不能编辑' : '打开音频编辑界面'}
            onClick={() => openAudioEditor()}
            onContextMenu={openFilenameMenu}
          >
            <AudioLines size={28} />
          </button>
          <button className="filename-text-button" type="button" onClick={openSettingsInRegularMode}>
            <span> </span>
            <strong>{generateFilename('mp3')}</strong>
            <ChevronDown size={20} />
          </button>
        </div>

        {filenameMenu && (
          <div
            ref={filenameMenuRef}
            className="filename-context-menu"
            style={{ left: `${filenameMenu.x}px`, top: `${filenameMenu.y}px` }}
            role="menu"
            aria-label="音频上传菜单"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isRecording || !canOpenCurrentAudioEditor}
              onClick={() => openAudioEditor()}
            >
              打开音频编辑
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={autoOpenEditor}
              onClick={() => {
                setAutoOpenEditor((value) => !value);
                setFilenameMenu(null);
              }}
            >
              {autoOpenEditor ? '自动打开编辑：开' : '自动打开编辑：关'}
            </button>
            {!filenameMenuUploadedAudio && (
              <button type="button" role="menuitem" onClick={uploadCurrentAudioFromMenu}>
                上传音频
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={!filenameMenuUploadedAudio}
              onClick={() => copyDriveShareLink(filenameMenuUploadedAudio?.fileLink)}
            >
              复制链接
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!filenameMenuUploadedAudio}
              onClick={() => openDriveLink(filenameMenuUploadedAudio?.folderLink)}
            >
              打开云端文件夹
            </button>
          </div>
        )}

        <div className="save-row">
          <button className="round-action webm" type="button" disabled={!webmBlob} onClick={() => saveBlob(webmBlob, generateFilename('webm'))}>
            <Save size={50} />
            <span>保存 WEBM</span>
          </button>
          <button className="round-action mp3" type="button" disabled={!mp3Blob} onClick={() => saveBlob(mp3Blob, generateFilename('mp3'))}>
            <Save size={50} />
            <span>保存 MP3</span>
          </button>
          <button className="round-action link" type="button" onClick={openLinks}>
            <ExternalLink size={50} />
            <span>打开链接</span>
          </button>
        </div>

        <footer className="player-bar">
          <button
            className="small-play"
            type="button"
            disabled={!audioUrl}
            onClick={() => (audioRef.current?.paused ? audioRef.current.play() : audioRef.current.pause())}
          >
            <Play size={20} fill="currentColor" />
          </button>
          <span>{formatTime(Math.floor(currentTime))}</span>
          <input
            className="progress"
            type="range"
            min="0"
            max={duration || 0}
            step="0.01"
            value={currentTime}
            disabled={!audioUrl}
            onChange={(event) => {
              const value = Number(event.target.value);
              setCurrentTime(value);
              if (audioRef.current) audioRef.current.currentTime = value;
            }}
          />
          <span>{formatTime(Math.floor(duration))}</span>
          <Volume2 size={22} />
          <input className="volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
          <button className="folder-button" type="button" aria-label="打开保存文件夹" data-tooltip="打开保存文件夹" onClick={openSavedFolder}>
            <FolderOpen size={22} />
          </button>
        </footer>

        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        />

        {audioEditor && (
          <div className="audio-editor-shell" role="dialog" aria-modal="true" aria-label="音频编辑界面" onMouseDown={dragAudioEditorWindow}>
            <div className="audio-editor-window" data-tauri-drag-region>
              <header className="audio-editor-header" data-tauri-drag-region>
                <div className="audio-editor-brand" data-tauri-drag-region>
                  <span className="audio-editor-traffic">
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <button type="button" aria-label="最大化或还原音频编辑窗口" onClick={toggleAudioEditorMaximize} />
                  </span>
                  <span className="audio-editor-mark"><AudioLines size={26} /></span>
                  <div data-tauri-drag-region>
                    <strong>编辑 · {audioEditor.filename}</strong>
                    <em>音频编辑器 · 已加载峰值缓存</em>
                  </div>
                </div>
                <button className="audio-editor-close" type="button" onClick={closeAudioEditor}>
                  <X size={20} />
                  <span>关闭</span>
                </button>
              </header>

              <div className="audio-editor-toolbar" aria-label="音频编辑工具栏">
                <button type="button" disabled={audioEditor.busy} onClick={importAudioFileIntoEditor}><Download size={16} /><span>导入</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={saveEditedAudio}><Upload size={16} /><span>导出</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy || audioEditor.historyIndex <= 0} onClick={() => jumpEditorHistory(-1)}><Undo2 size={16} /><span>撤销</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy || audioEditor.historyIndex >= audioEditor.history.length - 1} onClick={() => jumpEditorHistory(1)}><Redo2 size={16} /><span>重做</span></button>
                <button ref={silenceCutButtonRef} type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={scanSilenceForCut}>
                  <Scissors size={16} />
                  <span>剪除</span>
                </button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={copyEditorSelection}><Copy size={16} /><span>复制</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy || !editorClipboard} onClick={pasteEditorSelection}><Clipboard size={16} /><span>粘贴</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={deleteEditorSelection}><Trash2 size={16} /><span>删除</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={() => {
                  const splitTime = snapEditorTimeToFrame(audioEditor.playbackMarkerTime || audioEditor.currentTime || activeEditorSelection?.start || 0, audioEditor);
                  setAudioEditor((current) => current
                    ? editorWithActiveSelection(current, {
                        start: splitTime,
                        end: snapEditorTimeToFrame(splitTime + editorFrameDuration(current), current)
                      }, null)
                    : current);
                  setStatus('已定位分割点，真正分割片段逻辑下一步完善');
                }}><Split size={16} /><span>分割</span></button>
                <button type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={selectEditorFullRange}><SlidersHorizontal size={16} /><span>全选</span></button>
                <div className="audio-editor-selection-summary">
                  <span>选区时长</span>
                  <strong>{formatEditorTime(totalEditorSelectionDuration)}</strong>
                </div>
              </div>

              <section className="audio-editor-controls">
                <div className="audio-editor-duration audio-editor-total-duration">
                  <span>音频总时长</span>
                  <strong>{formatEditorTime(audioEditor.duration || 0)}</strong>
                </div>
                <div
                  className={`audio-editor-transport audio-editor-transport-card ${audioEditor.editorPlaying ? 'playing' : 'paused'}`}
                  onContextMenu={openEditorPlaybackRateMenu}
                >
                  <button
                    className="editor-transport-toggle"
                    type="button"
                    disabled={audioEditor.loading}
                    onClick={toggleEditorPlayback}
                    aria-label={audioEditor.editorPlaying ? '暂停' : '播放'}
                  >
                    {audioEditor.editorPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                  </button>
                  <AudioLines className="editor-transport-wave" size={24} />
                  <div className="editor-transport-readout">
                    <strong ref={editorTransportTimeRef}>{formatEditorTime(audioEditor.currentTime || 0)}</strong>
                    <span><i />{audioEditor.editorPlaying ? '正在播放...' : '已暂停'}</span>
                  </div>
                  <button className="editor-transport-start" type="button" onClick={resetEditorToStart} data-tooltip="回到起始帧" aria-label="回到起始帧">
                    <SkipBack size={15} fill="currentColor" />
                  </button>
                </div>
                <label>
                  <span className="audio-editor-field-label">
                    开始
                    <em
                      data-tooltip={`真实帧编号 F${editorFrameNumber(activeEditorSelection?.start || 0, audioEditor)} · ${editorFrameRateOption(editorFrameRate)?.label || '30 fps'}`}
                      onContextMenu={openEditorFrameRateMenu}
                    >
                      帧 {formatEditorFpsTime(snapEditorTimeToFrame(activeEditorSelection?.start || 0, audioEditor), editorFrameRate)}
                    </em>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatEditorTime(snapEditorTimeToFrame(activeEditorSelection?.start || 0, audioEditor))}
                    disabled={audioEditor.loading}
                    onChange={(event) => updateEditorSelection('start', event.target.value)}
                  />
                </label>
                <label>
                  <span className="audio-editor-field-label">
                    结束
                    <em
                      data-tooltip={`真实帧编号 F${editorFrameNumber(activeEditorSelection?.end || 0, audioEditor)} · ${editorFrameRateOption(editorFrameRate)?.label || '30 fps'}`}
                      onContextMenu={openEditorFrameRateMenu}
                    >
                      帧 {formatEditorFpsTime(snapEditorTimeToFrame(activeEditorSelection?.end || 0, audioEditor), editorFrameRate)}
                    </em>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatEditorTime(snapEditorTimeToFrame(activeEditorSelection?.end || 0, audioEditor))}
                    disabled={audioEditor.loading}
                    onChange={(event) => updateEditorSelection('end', event.target.value)}
                  />
                </label>
              </section>

              <section className="audio-editor-wave-panel">
                {editorZoomNoticeVisible && (
                  <div className="audio-editor-zoom-badge" aria-live="polite">
                    缩放 {Math.round(audioEditor.zoom || 0)}%
                  </div>
                )}
                <div className="audio-editor-canvas-stack">
                  <canvas
                    ref={editorCanvasRef}
                    className="audio-editor-base-canvas"
                    width="1100"
                    height="220"
                    style={{ cursor: audioEditor.hoverSelectionDeleteIndex != null ? 'pointer' : audioEditor.dragSelectionEdge || audioEditor.hoverSelectionEdge ? 'ew-resize' : 'crosshair' }}
                    onPointerDown={startEditorSelectionDrag}
                    onPointerMove={moveEditorSelectionDrag}
                    onPointerUp={endEditorSelectionDrag}
                    onPointerCancel={endEditorSelectionDrag}
                    onPointerLeave={clearEditorSelectionHover}
                    onContextMenu={openEditorSelectionContextMenu}
                  />
                  <canvas
                    ref={editorSelectionCanvasRef}
                    className="audio-editor-selection-canvas"
                    width="1100"
                    height="220"
                    aria-hidden="true"
                  />
                  <canvas
                    ref={editorOverlayCanvasRef}
                    className="audio-editor-overlay-canvas"
                    width="1100"
                    height="220"
                    aria-hidden="true"
                  />
                </div>
                {audioEditor.error && <p>{audioEditor.error}</p>}
                {audioEditor.nativeWaveformOnly && audioEditor.waveformProgress && audioEditor.waveformProgress.percent < 100 && (
                  <div className="waveform-progress" role="status">
                    <b>{audioEditor.waveformProgress.percent}%</b>
                    <span>
                      <i style={{ width: `${audioEditor.waveformProgress.percent}%` }} />
                    </span>
                    <em>{audioEditor.waveformProgress.stage}</em>
                  </div>
                )}
              </section>

              <section className={`audio-editor-mini-wave ${audioEditor.miniDragging ? 'dragging' : ''}`}>
                <div className="audio-editor-mini-canvas-stack">
                  <canvas
                    ref={editorMiniCanvasRef}
                    className="audio-editor-base-canvas"
                    width="1040"
                    height="48"
                    onPointerDown={startEditorMiniDrag}
                    onPointerMove={moveEditorMiniDrag}
                    onPointerUp={endEditorMiniDrag}
                    onPointerCancel={endEditorMiniDrag}
                  />
                  <canvas
                    ref={editorMiniOverlayCanvasRef}
                    className="audio-editor-mini-overlay-canvas"
                    width="1040"
                    height="48"
                    aria-hidden="true"
                  />
                </div>
              </section>

              <footer className="audio-editor-actions">
                <button type="button" disabled={audioEditor.loading} onClick={previewEditorFull}>
                  <Play size={20} fill="currentColor" />
                  <span>完整预览</span>
                </button>
                <div className="selection-preview-combo">
                  <button
                    className="selection-preview-toggle"
                    type="button"
                    disabled={audioEditor.loading}
                    aria-pressed={previewAllEditorSelections}
                    data-tooltip={previewAllEditorSelections ? '当前预览全部选区' : '当前预览活动选区'}
                    onClick={() => setPreviewAllEditorSelections((current) => !current)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <button
                    className="selection-preview-button"
                    type="button"
                    disabled={audioEditor.loading}
                    onClick={previewEditorSelection}
                  >
                    <AudioLines size={22} />
                    <span>选区预览</span>
                  </button>
                </div>
                <button className="trim" type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={deleteEditorSelection}>
                  <Trash2 size={22} />
                  <span>删除选区</span>
                </button>
                <button className="save" type="button" disabled={audioEditor.loading || audioEditor.busy} onClick={saveEditedAudio}>
                  <Save size={22} />
                  <span>{audioEditor.busy ? '正在保存...' : '保存新版本'}</span>
                </button>
              </footer>

              <audio
                ref={editorAudioRef}
                src={audioEditor.url}
                onTimeUpdate={handleEditorTimeUpdate}
                onLoadedMetadata={handleEditorLoadedMetadata}
                onPlay={() => setEditorPlaybackState(true)}
                onPause={() => setEditorPlaybackState(false)}
                onEnded={handleEditorEnded}
                onError={handleEditorAudioError}
              />
            </div>
          </div>
        )}

        {timeCopyNotice && (
          <div
            className={`time-copy-notice ${timeCopyNotice.success ? 'success' : 'failed'}`}
            style={{ left: `${timeCopyNotice.x}px`, top: `${timeCopyNotice.y}px` }}
            role="status"
          >
            {timeCopyNotice.message}
          </div>
        )}

        {timeCopyMenu && (
          <div
            ref={timeCopyMenuRef}
            className="time-copy-menu"
            style={{ left: `${timeCopyMenu.x}px`, top: `${timeCopyMenu.y}px` }}
            role="menu"
            aria-label="时间码复制样式"
          >
            {TIME_COPY_OPTIONS.map((option) => (
              <button
                className={option.value === timeCopyStyle ? 'selected' : ''}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === timeCopyStyle}
                key={option.value}
                onClick={() => chooseTimeCopyStyle(option.value)}
              >
                <span>{option.label}</span>
                {option.value === timeCopyStyle && <strong>已选</strong>}
              </button>
            ))}
          </div>
        )}

        {editorPlaybackRateMenu && (
          <div
            ref={editorPlaybackRateMenuRef}
            className="editor-time-menu playback-rate-menu"
            style={{ left: `${editorPlaybackRateMenu.x}px`, top: `${editorPlaybackRateMenu.y}px` }}
            role="menu"
            aria-label="播放速度"
            onContextMenu={(event) => event.preventDefault()}
          >
            <strong className="editor-time-menu-title">播放速度</strong>
            {EDITOR_PLAYBACK_RATE_OPTIONS.map((rate) => (
              <button
                className={Math.abs(rate - editorPlaybackRate) < 0.001 ? 'selected' : ''}
                type="button"
                role="menuitemradio"
                aria-checked={Math.abs(rate - editorPlaybackRate) < 0.001}
                key={rate}
                onClick={() => chooseEditorPlaybackRate(rate)}
              >
                <span>{rate.toFixed(rate % 1 === 0 ? 1 : 2)} 倍</span>
                {Math.abs(rate - editorPlaybackRate) < 0.001 && <b>已选</b>}
              </button>
            ))}
            <div className="editor-time-custom-rate">
              <span>自定义</span>
              <input
                type="number"
                min="0.1"
                max="8"
                step="0.05"
                value={editorPlaybackRateDraft}
                onChange={(event) => setEditorPlaybackRateDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyCustomEditorPlaybackRate();
                }}
              />
              <button type="button" onClick={applyCustomEditorPlaybackRate}>应用</button>
            </div>
          </div>
        )}

        {editorFrameRateMenu && (
          <div
            ref={editorFrameRateMenuRef}
            className="editor-time-menu frame-rate-menu"
            style={{ left: `${editorFrameRateMenu.x}px`, top: `${editorFrameRateMenu.y}px` }}
            role="menu"
            aria-label="帧率"
            onContextMenu={(event) => event.preventDefault()}
          >
            {EDITOR_FRAME_RATE_OPTIONS.map((option) => (
              <button
                className={option.value === editorFrameRate ? 'selected' : ''}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === editorFrameRate}
                key={option.value}
                onClick={() => chooseEditorFrameRate(option.value)}
              >
                <span>{option.label}</span>
                {option.value === editorFrameRate && <b>已选</b>}
              </button>
            ))}
          </div>
        )}

        {editorSelectionMenu && (
          <div
            ref={editorSelectionMenuRef}
            className="editor-selection-menu"
            style={{ left: `${editorSelectionMenu.x}px`, top: `${editorSelectionMenu.y}px` }}
            role="menu"
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              className="all-action"
              type="button"
              role="menuitem"
              onClick={() => setAllEditorSelectionsLocked(!editorSelectionMenu.allLocked)}
            >
              {editorSelectionMenu.allLocked ? '取消全部标记' : '标记全部选区'}
            </button>
            <span className="editor-selection-menu-divider" aria-hidden="true" />
            {editorSelectionMenu.locked ? (
              <button type="button" role="menuitem" onClick={() => setEditorSelectionLocked(editorSelectionMenu.rangeIndex, false)}>
                取消标记
              </button>
            ) : (
              <button type="button" role="menuitem" onClick={() => setEditorSelectionLocked(editorSelectionMenu.rangeIndex, true)}>
                标记选区
              </button>
            )}
          </div>
        )}

        {(savePrompt || drivePrompt || silenceCutPrompt || restartPromptOpen || closePromptOpen || quitAllPromptOpen) && (
          <div
            ref={actionBubbleRef}
            className={`action-popover ${restartPromptOpen || closePromptOpen || quitAllPromptOpen ? 'restart-popover' : drivePrompt ? 'drive-popover' : silenceCutPrompt ? 'silence-popover' : 'save-popover'}`}
            style={silenceCutPrompt?.position ? { left: `${silenceCutPrompt.position.x}px`, top: `${silenceCutPrompt.position.y}px` } : undefined}
            role="status"
          >
            {silenceCutPrompt ? (
              <p>
                已选出 {silenceCutPrompt.count} 段超过
                <input
                  aria-label="剪除无声秒数"
                  type="number"
                  min={MIN_SILENCE_CUT_SECONDS}
                  max={MAX_SILENCE_CUT_SECONDS}
                  value={silenceCutSeconds}
                  onChange={(event) => setSilenceCutSeconds(normalizeSilenceCutSeconds(event.target.value))}
                  onBlur={(event) => rescanSilenceForCut(event.target.value, silenceSensitivity, silenceReserveSeconds)}
                />
                秒，灵敏度
                <input
                  aria-label="剪除静音灵敏度"
                  type="number"
                  min={MIN_SILENCE_SENSITIVITY}
                  max={MAX_SILENCE_SENSITIVITY}
                  value={silenceSensitivity}
                  onChange={(event) => setSilenceSensitivity(normalizeSilenceSensitivity(event.target.value))}
                  onBlur={(event) => rescanSilenceForCut(silenceCutSeconds, event.target.value, silenceReserveSeconds)}
                />
                ，预留
                <input
                  aria-label="剪除前后预留秒数"
                  type="number"
                  min={MIN_SILENCE_RESERVE_SECONDS}
                  max={MAX_SILENCE_RESERVE_SECONDS}
                  step="0.1"
                  value={silenceReserveSeconds}
                  onChange={(event) => setSilenceReserveSeconds(normalizeSilenceReserveSeconds(event.target.value))}
                  onBlur={(event) => rescanSilenceForCut(silenceCutSeconds, silenceSensitivity, event.target.value)}
                />
                秒，总计 {formatEditorTime(silenceCutPrompt.totalDuration || 0)}
                {silenceCutPrompt.count > 0 ? '，是否删除全部?' : '，可调整参数重新检测'}
              </p>
            ) : (
              <p>
                {quitAllPromptOpen
                  ? '正在录音，是否结束录音并退出全部?'
                  : closePromptOpen
                  ? '正在录音，是否结束录音并关闭?'
                  : restartPromptOpen
                    ? '是否删除当前录音并重新开始录音?'
                    : drivePrompt
                      ? '已上传 Google Drive'
                      : '已保存音频，是否打开录音文件夹?'}
              </p>
            )}
            <div>
              {quitAllPromptOpen ? (
                <button className="restart-action" type="button" onClick={confirmQuitAllWhileRecording}>
                  结束并退出
                </button>
              ) : closePromptOpen ? (
                <button className="restart-action" type="button" onClick={confirmCloseWhileRecording}>
                  结束并关闭
                </button>
              ) : restartPromptOpen ? (
                <button className="restart-action" type="button" onClick={confirmRestartRecording}>
                  重新开始
                </button>
              ) : drivePrompt ? (
                <>
                  <button className="open-folder-action" type="button" onClick={() => openDriveLink(drivePrompt.fileLink)}>
                    打开云端文件
                  </button>
                  <button className="open-folder-action" type="button" onClick={() => openDriveLink(drivePrompt.folderLink)}>
                    打开云端文件夹
                  </button>
                  <button className="open-folder-action" type="button" onClick={() => copyDriveShareLink()}>
                    复制可分享链接
                  </button>
                </>
              ) : silenceCutPrompt ? (
                <>
                  <button className="restart-action" type="button" disabled={silenceCutPrompt.count <= 0} onClick={deleteEditorSelection}>
                    删除全部
                  </button>
                  <button className="open-folder-action" type="button" onClick={() => rescanSilenceForCut(silenceCutSeconds, silenceSensitivity, silenceReserveSeconds)}>
                    重新检测
                  </button>
                </>
              ) : (
                <button className="open-folder-action" type="button" onClick={openSavedFolder}>
                  打开文件夹
                </button>
              )}
              <button
                className="cancel-folder-action"
                type="button"
                onClick={() => {
                  setSavePrompt(null);
                  setDrivePrompt(null);
                  setSilenceCutPrompt(null);
                  setRestartPromptOpen(false);
                  setClosePromptOpen(false);
                  setQuitAllPromptOpen(false);
                  closeAfterRecordingStopRef.current = false;
                  quitAllAfterRecordingStopRef.current = false;
                }}
              >
                {silenceCutPrompt ? '保留检查' : '取消'}
              </button>
            </div>
          </div>
        )}

        {settingsOpen && (
          <aside className="settings-panel">
            <div className="settings-head">
              <div className="settings-head-main">
                <div className="settings-title-row">
                  <span><ListMusic size={20} /> 文件命名规则</span>
                  <label className="number-digits-control">
                    编号位数
                    <select value={numberDigits} onChange={(event) => setNumberDigits(normalizeNumberDigits(event.target.value))}>
                      <option value="0">不补零</option>
                      <option value="2">2位</option>
                      <option value="3">3位</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="settings-head-actions">
                <label
                  className="auto-cache-control"
                  aria-label="自动缓存"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCacheMenuOpen(true);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoCache}
                    onChange={(event) => setAutoCache(event.target.checked)}
                  />
                  <span className="auto-cache-tooltip" data-tooltip="自动缓存">
                    <i />
                  </span>
                  <input
                    className="cache-interval-input"
                    type="number"
                    min="1"
                    max="3600"
                    value={cacheIntervalSeconds}
                    onChange={(event) => setCacheIntervalSeconds(normalizeCacheInterval(event.target.value))}
                  />
                  <span>秒</span>
                  {cacheMenuOpen && (
                    <div
                      ref={cacheMenuRef}
                      className="cache-menu-popover"
                      role="menu"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <button
                        className={cacheDeleteOnSave ? 'selected' : ''}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={cacheDeleteOnSave}
                        onClick={() => setCacheDeleteOnSave((value) => !value)}
                      >
                        <span>保存成功后删除本次缓存</span>
                        <strong>{cacheDeleteOnSave ? '开' : '关'}</strong>
                      </button>
                      <div className="cache-menu-divider" />
                      {CACHE_RETENTION_OPTIONS.map((option) => (
                        <button
                          className={cacheRetentionDays === option.value ? 'selected' : ''}
                          type="button"
                          role="menuitemradio"
                          aria-checked={cacheRetentionDays === option.value}
                          key={option.value}
                          onClick={() => setCacheRetentionDays(option.value)}
                        >
                          <span>{option.label}</span>
                          {cacheRetentionDays === option.value && <strong>已选</strong>}
                        </button>
                      ))}
                      <div className="cache-menu-divider" />
                      <button type="button" role="menuitem" onClick={cleanExpiredCacheNow}>
                        <span>立即清理过期缓存</span>
                      </button>
                      <button type="button" role="menuitem" onClick={clearWaveformCacheNow}>
                        <span>立即清空音波缓存</span>
                      </button>
                    </div>
                  )}
                </label>
                <button className="settings-close-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置" data-tooltip="关闭设置">
                  <X size={22} />
                </button>
              </div>
              <p className="settings-preview">预览：{generateFilename('mp3')}</p>
            </div>

            <div className="token-row">
              {tokens.map((token) => (
                <span
                  className={`token token-${token.type}`}
                  key={token.id}
                  onDoubleClick={() => {
                    if (token.type === 'name' || token.type === 'custom') setEditingTextToken(token.id);
                  }}
                >
                  <span className="token-content">
                    {token.type === 'separator' ? (
                      <input
                        value={token.value}
                        maxLength="8"
                        aria-label="自定义分隔符"
                        onChange={(event) => updateToken(token.id, event.target.value)}
                      />
                    ) : editingTextToken === token.id && (token.type === 'name' || token.type === 'custom') ? (
                      <input
                        className="token-text-input"
                        value={editableTokenValue(token)}
                        autoFocus
                        onBlur={() => setEditingTextToken(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === 'Escape') setEditingTextToken(null);
                        }}
                        onChange={(event) => updateToken(token.id, event.target.value)}
                      />
                    ) : (
                      <span>{token.type === 'name' || token.type === 'custom' ? editableTokenValue(token) : tokenLabels[token.type]}</span>
                    )}
                    <button className="token-remove" type="button" onClick={() => removeToken(token.id)} aria-label="移除">
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                </span>
              ))}
              <div className="add-token">
                <button className="add-token-main" type="button" aria-label="添加命名标签" data-tooltip="添加命名标签" onClick={() => setTokenPickerOpen((value) => !value)}>
                  <Plus size={18} />
                </button>
                {tokenPickerOpen && (
                  <div className="token-picker">
                    {tokenOptions.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          addToken(type);
                          setTokenPickerOpen(false);
                        }}
                      >
                        {tokenLabels[type]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="form-grid">
              <div className="compact-settings-row">
                <label className="start-date-field">
                  编号开始日期
                  <div className="start-date-input-row">
                    <input
                      className="start-date-text-input"
                      value={recordingDate}
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="YYYYMMDD"
                      onChange={(event) => setRecordingDate(dateKeyFromValue(event.target.value))}
                    />
                    <span className="start-date-picker-zone" data-tooltip="选择日期">
                      <input
                        ref={startDatePickerRef}
                        className="native-date-picker"
                        type="date"
                        aria-label="选择编号开始日期"
                        tabIndex={-1}
                        value={normalizeDateInput(recordingDate)}
                        onChange={(event) => setRecordingDate(dateKeyFromValue(event.target.value))}
                      />
                    </span>
                  </div>
                </label>
                <label className="bitrate-field">
                  MP3 比特率设置
                  <select value={bitrate} onChange={(event) => setBitrate(Number(event.target.value))}>
                    <option value="8">8 kbps</option>
                    <option value="16">16 kbps</option>
                    <option value="24">24 kbps</option>
                    <option value="40">40 kbps</option>
                    <option value="64">64 kbps</option>
                    <option value="80">80 kbps</option>
                    <option value="96">96 kbps</option>
                    <option value="112">112 kbps</option>
                    <option value="128">128 kbps</option>
                    <option value="160">160 kbps</option>
                    <option value="192">192 kbps</option>
                    <option value="224">224 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="320">320 kbps</option>
                  </select>
                </label>
                <div className="microphone-field">
                  <div className="microphone-slots">
                    {microphoneSlots.map((deviceId, slotIndex) => (
                      <button
                        className={`microphone-slot ${activeMicrophoneSlot === slotIndex ? 'active' : ''} ${microphoneSlotStateClass(slotIndex)}`}
                        key={slotIndex}
                        type="button"
                        aria-label={`选择 ${slotIndex} 号麦克风`}
                        onClick={() => openMicrophoneSlot(slotIndex)}
                      >
                        {slotIndex}
                      </button>
                    ))}
                  </div>
                  <select
                    value={microphoneSlots[activeMicrophoneSlot] || ''}
                    onChange={(event) => updateMicrophoneSlot(activeMicrophoneSlot, event.target.value)}
                  >
                    {activeMicrophoneSlot === 0 ? (
                      <option value="default">系统默认麦克风</option>
                    ) : (
                      <option value="">空-麦克风设备</option>
                    )}
                    {microphoneDevices.map((device, index) => (
                      <option value={device.deviceId} key={device.deviceId || index}>
                        {microphoneLabel(device, index)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="path-field">
                保存路径
                <div className="path-picker">
                  <input
                    value={saveDirectory || defaultSaveDirectory}
                    onChange={(event) => setSaveDirectory(event.target.value)}
                  />
                  <button type="button" aria-label="选择保存文件夹" data-tooltip="选择保存文件夹" onClick={chooseSaveDirectory}>
                    <FolderOpen size={18} />
                  </button>
                </div>
              </label>
              <section className="cloud-upload-field" aria-label="Google 云端硬盘上传">
                <div className="cloud-upload-title">
                  <span className="google-drive-mark">▲</span>
                  <strong>Google 云端硬盘</strong>
                  <em className={googleDriveStatus.connected ? 'connected' : ''}>
                    {googleDriveStatus.connected ? `已登录为 ${googleDriveStatus.email || 'Google 用户'}` : '未连接'}
                  </em>
                </div>
                {googleDriveMessage && (
                  <div className={googleDriveStatus.connected ? 'cloud-upload-message connected' : 'cloud-upload-message'}>
                    {googleDriveMessage}
                  </div>
                )}
                <div className="cloud-upload-actions">
                  <button
                    type="button"
                    className={googleDriveBusy ? 'cancel-auth-button' : ''}
                    disabled={!googleDriveBusy && !googleDriveClientId.trim()}
                    onClick={
                      googleDriveBusy
                        ? cancelGoogleDriveConnect
                        : googleDriveStatus.connected
                          ? disconnectGoogleDrive
                          : connectGoogleDrive
                    }
                  >
                    {googleDriveBusy ? '取消授权' : googleDriveStatus.connected ? '断开连接' : '连接'}
                  </button>
                  <button type="button" disabled={googleDriveBusy} onClick={importGoogleDriveClientJson}>
                    导入 JSON
                  </button>
                  <label className="cloud-toggle">
                    <input
                      type="checkbox"
                      checked={googleDriveAutoUpload}
                      onChange={(event) => setGoogleDriveAutoUpload(event.target.checked)}
                    />
                    <i />
                    <span>自动上传</span>
                  </label>
                  <label className="cloud-toggle">
                    <input
                      type="checkbox"
                      checked={googleDrivePublicShare}
                      onChange={(event) => setGoogleDrivePublicShare(event.target.checked)}
                    />
                    <i />
                    <span>分享链接</span>
                  </label>
                </div>
                <label className="cloud-folder-field">
                  文件夹链接
                  <input
                    value={googleDriveFolderId}
                    onChange={(event) => setGoogleDriveFolderId(event.target.value)}
                    placeholder="可粘贴 Google Drive 文件夹完整链接，留空则上传到根目录"
                  />
                </label>
              </section>
              <label className="links-field">
                打开链接
                <textarea
                  value={linksText}
                  onChange={(event) => setLinksText(event.target.value)}
                  placeholder={'备注 @ https://example.com\n资料夹 @ D:\\Documents'}
                />
              </label>
              <div className="settings-actions">
                <div className="scale-preset-control" aria-label="全局窗口缩放">
                  {WINDOW_SCALE_OPTIONS.map((scale) => (
                    <button
                      className={scale === globalWindowScale ? 'active' : ''}
                      type="button"
                      key={scale}
                      onClick={() => applyGlobalWindowScale(scale)}
                    >
                      {scale}
                    </button>
                  ))}
                </div>
                <button type="button" className="restore-settings-action" onClick={restoreDefaultSettings}>
                  恢复默认设置
                </button>
              </div>
            </div>

            {lastSavedPath && <p className="saved-path">最近保存：{lastSavedPath}</p>}
          </aside>
        )}

      </section>
    </main>
  );
}
