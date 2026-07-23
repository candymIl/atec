[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$UploadRoot
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not $UploadRoot) {
    $envFile = Join-Path $ProjectRoot "backend\.env"
    if (Test-Path -LiteralPath $envFile) {
        $setting = Get-Content -LiteralPath $envFile |
            Where-Object { $_ -match "^(UPLOAD_ROOT|UPLOADS_PATH)=" } |
            Select-Object -First 1
        if ($setting) {
            $UploadRoot = ($setting -split "=", 2)[1].Trim()
        }
    }
}

if (-not $UploadRoot) {
    throw "UPLOAD_ROOT is not configured."
}

$workspace = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$resolvedUploadRoot = [System.IO.Path]::GetFullPath($UploadRoot).TrimEnd("\")

if ($resolvedUploadRoot.StartsWith($workspace + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Upload root must be outside the Git workspace: $resolvedUploadRoot"
}

if (-not (Test-Path -LiteralPath $resolvedUploadRoot -PathType Container)) {
    throw "Upload root does not exist: $resolvedUploadRoot"
}

$files = Get-ChildItem -LiteralPath $resolvedUploadRoot -Recurse -File
$bytes = ($files | Measure-Object Length -Sum).Sum
$expectedFolders = @("assets", "inspections", "signatures", "job-cards")
$missingFolders = $expectedFolders | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $resolvedUploadRoot $_) -PathType Container)
}

if ($files.Count -eq 0) {
    throw "Upload root is empty: $resolvedUploadRoot"
}

if ($missingFolders.Count -gt 0) {
    throw "Upload root is missing expected folders: $($missingFolders -join ', ')"
}

[pscustomobject]@{
    UploadRoot = $resolvedUploadRoot
    FileCount = $files.Count
    Bytes = $bytes
    Gigabytes = [math]::Round($bytes / 1GB, 3)
    InsideWorkspace = $false
    Status = "HEALTHY"
} | Format-List
