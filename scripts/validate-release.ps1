param(
    [string]$ExpectedVersion = "",
    [string]$PackagePath = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$failed = $false

function Add-Failure {
    param([string]$Message)
    Write-Host "FAIL: $Message" -ForegroundColor Red
    $script:failed = $true
}

function Add-Ok {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

$manifestPath = Join-Path $root "manifest.json"
if (!(Test-Path $manifestPath)) {
    Add-Failure "manifest.json is missing."
} else {
    try {
        $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
        Add-Ok "manifest.json is valid JSON."
        if ($manifest.manifest_version -ne 3) {
            Add-Failure "manifest_version must be 3."
        } else {
            Add-Ok "manifest_version is 3."
        }
        if ([string]::IsNullOrWhiteSpace($manifest.version)) {
            Add-Failure "manifest version is missing."
        } elseif ($ExpectedVersion -and $manifest.version -ne $ExpectedVersion) {
            Add-Failure "manifest version '$($manifest.version)' does not match expected '$ExpectedVersion'."
        } else {
            Add-Ok "manifest version '$($manifest.version)' is valid."
        }
    } catch {
        Add-Failure "manifest.json is not valid JSON: $($_.Exception.Message)"
    }
}

$requiredFiles = @(
    "manifest.json",
    "AudioRecorder.html",
    "AudioRecorder.js",
    "AudioRecorderWorklet.js",
    "background.js",
    "lamejs.iife.js",
    "README.md",
    "PRIVACY.md",
    "CHANGELOG.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    ".gitignore",
    ".github/workflows/release.yml"
)

foreach ($file in $requiredFiles) {
    if (Test-Path (Join-Path $root $file)) {
        Add-Ok "required file exists: $file"
    } else {
        Add-Failure "required file missing: $file"
    }
}

$sensitiveFilePatterns = @(
    "*.pem", "*.key", "*.p12", "*.pfx", "*.crt", "*.cer",
    "*.env", ".env", ".env.*",
    "*.mp3", "*.webm", "*.wav", "*.m4a", "*.ogg", "*.aac"
)

foreach ($pattern in $sensitiveFilePatterns) {
    $matches = Get-ChildItem -Path $root -Recurse -Force -File -Filter $pattern |
        Where-Object { $_.FullName -notmatch "\\.git\\" }
    foreach ($match in $matches) {
        Add-Failure "sensitive or generated file should not be committed: $($match.FullName)"
    }
}

$textFiles = Get-ChildItem -Path $root -Recurse -Force -File |
    Where-Object {
        $_.FullName -notmatch "\\.git\\" -and
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -ne $PSCommandPath -and
        ($_.Extension -in @(".html", ".js", ".json", ".md", ".txt", ".ps1", ".yml", ".yaml", ".css") -or $_.Name -eq "LICENSE" -or $_.Name -eq ".gitignore")
    }

foreach ($file in $textFiles) {
    $relative = Resolve-Path -Relative $file.FullName
    $content = Get-Content -Raw -Path $file.FullName

    if ($file.Extension -eq ".html") {
        if ($content -match "<script[^>]+src=[`"']https?://") {
            Add-Failure "remote script found in $relative"
        }
    }

    if ($file.Extension -in @(".js", ".html")) {
        if ($content -match "\beval\s*\(") {
            Add-Failure "eval() found in $relative"
        }
        if ($content -match "\bnew\s+Function\s*\(") {
            Add-Failure "new Function() found in $relative"
        }
        if ($content -match "fetch\s*\([^)]*https?://") {
            Add-Failure "network code fetch found in $relative"
        }
    }

    if ($content -match "[A-Za-z]:\\Users\\|[A-Za-z]:\\ChromeExtension\\|/Users/|/home/") {
        Add-Failure "absolute local path found in $relative"
    }

    if ($content -match "client_secret|refresh_token|access_token|BEGIN (RSA |EC |OPENSSH |PRIVATE )?KEY|-----BEGIN") {
        Add-Failure "secret-like content found in $relative"
    }

    if ($content -match "sourceMappingURL=.*[A-Za-z]:\\") {
        Add-Failure "source map local path found in $relative"
    }
}

$htmlPath = Join-Path $root "AudioRecorder.html"
if (Test-Path $htmlPath) {
    $html = Get-Content -Raw -Path $htmlPath
    if ($html -match "\.\./") {
        Add-Failure "parent-directory asset reference found in AudioRecorder.html"
    } else {
        Add-Ok "AudioRecorder.html does not reference parent-directory assets."
    }
}

if ($PackagePath) {
    if (!(Test-Path $PackagePath)) {
        Add-Failure "package path does not exist: $PackagePath"
    } else {
        Add-Ok "package exists: $PackagePath"
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $PackagePath))
        try {
            $entries = $zip.Entries | ForEach-Object { $_.FullName }
            if ($entries -contains "manifest.json") {
                Add-Ok "package root contains manifest.json."
            } else {
                Add-Failure "package root must directly contain manifest.json."
            }
            $blocked = $entries | Where-Object {
                $_ -match "^\.git/" -or
                $_ -match "^\.github/" -or
                $_ -match "^node_modules/" -or
                $_ -match "(^|/)(test|tests|__tests__)/" -or
                $_ -match "\.(pem|key|p12|pfx|crt|cer|env|map)$"
            }
            foreach ($entry in $blocked) {
                Add-Failure "blocked package entry found: $entry"
            }
        } finally {
            $zip.Dispose()
        }
    }
}

if ($failed) {
    Write-Host "Release validation failed." -ForegroundColor Red
    exit 1
}

Write-Host "Release validation passed." -ForegroundColor Green

