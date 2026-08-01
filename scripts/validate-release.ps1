param(
  [Parameter(Mandatory = $true)]
  [string] $ExpectedVersion,

  [string] $PackagePath
)

$ErrorActionPreference = "Stop"

function Read-JsonFile {
  param([Parameter(Mandatory = $true)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing required file: $Path"
  }
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$packageJson = Read-JsonFile "package.json"
$tauriConfig = Read-JsonFile "src-tauri/tauri.conf.json"

if ($packageJson.version -ne $ExpectedVersion) {
  throw "package.json version '$($packageJson.version)' does not match '$ExpectedVersion'."
}

if ($tauriConfig.version -ne $ExpectedVersion) {
  throw "src-tauri/tauri.conf.json version '$($tauriConfig.version)' does not match '$ExpectedVersion'."
}

$cargoToml = Get-Content -LiteralPath "src-tauri/Cargo.toml" -Raw
if ($cargoToml -notmatch '(?m)^version\s*=\s*"' + [regex]::Escape($ExpectedVersion) + '"') {
  throw "src-tauri/Cargo.toml version does not match '$ExpectedVersion'."
}

$requiredFiles = @(
  "README.md",
  "public/THIRD_PARTY_NOTICES.txt",
  "LICENSES/FFMPEG-NOTICE.txt",
  "LICENSES/GPL-3.0.txt",
  "tools/ffmpeg.exe"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Missing required release file: $file"
  }
}

$ffmpegNotice = Get-Content -LiteralPath "LICENSES/FFMPEG-NOTICE.txt" -Raw
if ($ffmpegNotice -notmatch "GPLv3" -or $ffmpegNotice -notmatch "8\.1\.2") {
  throw "FFmpeg notice must mention GPLv3 and the bundled FFmpeg version."
}

if ($PackagePath) {
  if (-not (Test-Path -LiteralPath $PackagePath)) {
    throw "Package path not found: $PackagePath"
  }

  $assets = Get-ChildItem -LiteralPath $PackagePath -File
  $expectedMsi = "AudioRecorder_V$ExpectedVersion" + "_windows_x64.msi"
  $expectedHash = "AudioRecorder_V$ExpectedVersion" + "_windows_x64.sha256"

  if (-not ($assets.Name -contains $expectedMsi)) {
    throw "Missing release asset: $expectedMsi"
  }
  if (-not ($assets.Name -contains $expectedHash)) {
    throw "Missing release checksum: $expectedHash"
  }
}

Write-Host "Release validation passed for $ExpectedVersion."
