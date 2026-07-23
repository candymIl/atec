param(
    [string]$CodexSource = "C:\Users\JacquesJonker\.codex",
    [string]$BackupRoot = "C:\Users\JacquesJonker\OneDrive - FB Crane Builders & Repairs\Codex Backup"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $CodexSource -PathType Container)) {
    throw "Codex source folder was not found: $CodexSource"
}

$currentBackup = Join-Path $BackupRoot "Current"
New-Item -ItemType Directory -Path $currentBackup -Force | Out-Null

$folders = @(
    "sessions",
    "archived_sessions",
    "skills"
)

foreach ($folder in $folders) {
    $source = Join-Path $CodexSource $folder
    if (Test-Path -LiteralPath $source -PathType Container) {
        $destination = Join-Path $currentBackup $folder
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        & robocopy $source $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /FFT /NP /NFL /NDL | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "Robocopy failed for $folder with exit code $LASTEXITCODE"
        }
    }
}

$files = @(
    "session_index.jsonl",
    "history.jsonl",
    "config.toml",
    ".codex-global-state.json",
    ".codex-global-state.json.bak",
    "memories_1.sqlite"
)

foreach ($file in $files) {
    $source = Join-Path $CodexSource $file
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $currentBackup $file) -Force
    }
}

$manifest = [ordered]@{
    completed_at = (Get-Date).ToString("o")
    source = $CodexSource
    destination = $currentBackup
    excluded_sensitive_files = @("auth.json", ".sandbox-secrets")
}

$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $BackupRoot "backup-manifest.json") -Encoding UTF8
