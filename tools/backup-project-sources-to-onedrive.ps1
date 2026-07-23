param(
    [string]$ProjectsRoot = "D:\Projects",
    [string]$BackupRoot = "C:\Users\JacquesJonker\OneDrive - FB Crane Builders & Repairs\Project Source Backups"
)

$ErrorActionPreference = "Stop"

$projects = @("ATEC", "fbcranes-ims")
$excludedDirectories = @(
    ".git",
    ".local",
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pytest_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "cache",
    "coverage",
    "dist",
    "logs",
    "node_modules",
    "out",
    "outputs",
    "target",
    "temp",
    "tmp",
    "uploads",
    "venv"
)
$excludedFiles = @(
    ".env",
    ".env.development",
    ".env.local",
    ".env.production",
    ".env.test",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.pem",
    "*.pyc",
    "*.sqlite-shm",
    "*.sqlite-wal"
)

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

foreach ($project in $projects) {
    $source = Join-Path $ProjectsRoot $project
    $destination = Join-Path $BackupRoot $project

    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Project source folder was not found: $source"
    }

    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    $arguments = @(
        $source,
        $destination,
        "/E",
        "/COPY:DAT",
        "/DCOPY:DAT",
        "/R:2",
        "/W:2",
        "/XJ",
        "/FFT",
        "/NP",
        "/NFL",
        "/NDL",
        "/XD"
    ) + $excludedDirectories + @("/XF") + $excludedFiles

    & robocopy @arguments | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Project backup failed for $project with robocopy exit code $LASTEXITCODE"
    }
}

$manifest = [ordered]@{
    completed_at = (Get-Date).ToString("o")
    source = $ProjectsRoot
    destination = $BackupRoot
    projects = $projects
    excluded_directories = $excludedDirectories
    excluded_sensitive_files = $excludedFiles
}

$manifest | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $BackupRoot "backup-manifest.json") -Encoding UTF8
