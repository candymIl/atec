[CmdletBinding()]
param(
    [string]$EnvFile,
    [string]$BackupRoot,
    [string]$UploadsPath,
    [string]$PgDumpPath = "pg_dump",
    [string]$DbHost,
    [string]$DbPort,
    [string]$DbName,
    [string]$DbUser,
    [string]$DbPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $PSScriptRoot "..\backend\.env"
}

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        $values[$key] = $value
    }

    return $values
}

function First-Value {
    param(
        [string]$Provided,
        [hashtable]$EnvValues,
        [string]$Key,
        [string]$DefaultValue = $null
    )

    if (-not [string]::IsNullOrWhiteSpace($Provided)) {
        return $Provided
    }

    if ($EnvValues.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($EnvValues[$Key])) {
        return $EnvValues[$Key]
    }

    return $DefaultValue
}

function Resolve-ToolPath {
    param(
        [string]$ToolPath,
        [string]$ToolFileName
    )

    $command = Get-Command $ToolPath -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $searchRoots = @(
        "C:\Program Files\PostgreSQL",
        "C:\Program Files (x86)\PostgreSQL"
    )

    foreach ($root in $searchRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }

        $match = Get-ChildItem -LiteralPath $root -Recurse -Filter $ToolFileName -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1

        if ($match) {
            return $match.FullName
        }
    }

    return $null
}

$envValues = Read-DotEnv -Path $EnvFile
$BackupRoot = First-Value -Provided $BackupRoot -EnvValues $envValues -Key "BACKUP_ROOT" -DefaultValue "D:\ATECBackups"
$UploadsPath = First-Value -Provided $UploadsPath -EnvValues $envValues -Key "UPLOADS_PATH" -DefaultValue (Join-Path $PSScriptRoot "..\backend\uploads")
$DbHost = First-Value -Provided $DbHost -EnvValues $envValues -Key "DB_HOST" -DefaultValue "localhost"
$DbPort = First-Value -Provided $DbPort -EnvValues $envValues -Key "DB_PORT" -DefaultValue "5432"
$DbName = First-Value -Provided $DbName -EnvValues $envValues -Key "DB_NAME"
$DbUser = First-Value -Provided $DbUser -EnvValues $envValues -Key "DB_USER"
$DbPassword = First-Value -Provided $DbPassword -EnvValues $envValues -Key "DB_PASSWORD"

$missing = @()
if ([string]::IsNullOrWhiteSpace($DbName)) { $missing += "DB_NAME" }
if ([string]::IsNullOrWhiteSpace($DbUser)) { $missing += "DB_USER" }
if ([string]::IsNullOrWhiteSpace($DbPassword)) { $missing += "DB_PASSWORD" }
if ($missing.Count -gt 0) {
    throw "Missing database setting(s): $($missing -join ', '). Add them to backend\.env or pass them as parameters."
}

$resolvedPgDumpPath = Resolve-ToolPath -ToolPath $PgDumpPath -ToolFileName "pg_dump.exe"
if ([string]::IsNullOrWhiteSpace($resolvedPgDumpPath)) {
    throw "Could not find pg_dump at '$PgDumpPath'. Install PostgreSQL client tools or pass -PgDumpPath with the full path to pg_dump.exe."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $BackupRoot "atec-$timestamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$dbDump = Join-Path $backupDir "$DbName-$timestamp.dump"
$uploadsZip = Join-Path $backupDir "uploads-$timestamp.zip"
$manifestPath = Join-Path $backupDir "manifest.json"

Write-Host "Creating ATEC database backup..."
$oldPgPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $DbPassword
    & $resolvedPgDumpPath "--host=$DbHost" "--port=$DbPort" "--username=$DbUser" "--format=custom" "--blobs" "--file=$dbDump" $DbName
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $oldPgPassword) {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:PGPASSWORD = $oldPgPassword
    }
}

$uploadsIncluded = $false
if (Test-Path -LiteralPath $UploadsPath) {
    $uploadItems = Get-ChildItem -LiteralPath $UploadsPath -Force -ErrorAction SilentlyContinue
    if ($uploadItems.Count -gt 0) {
        Write-Host "Compressing uploaded files..."
        Compress-Archive -Path (Join-Path $UploadsPath "*") -DestinationPath $uploadsZip -Force
        $uploadsIncluded = $true
    }
    else {
        Write-Warning "Uploads folder exists but is empty. No uploads zip was created."
    }
}
else {
    Write-Warning "Uploads folder was not found at $UploadsPath. No uploads zip was created."
}

$manifest = [ordered]@{
    created_at = (Get-Date).ToString("o")
    database = [ordered]@{
        host = $DbHost
        port = $DbPort
        name = $DbName
        user = $DbUser
        dump_file = Split-Path -Leaf $dbDump
        dump_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $dbDump).Hash
        dump_bytes = (Get-Item -LiteralPath $dbDump).Length
    }
    uploads = [ordered]@{
        source_path = $UploadsPath
        included = $uploadsIncluded
        zip_file = if ($uploadsIncluded) { Split-Path -Leaf $uploadsZip } else { $null }
        zip_sha256 = if ($uploadsIncluded) { (Get-FileHash -Algorithm SHA256 -LiteralPath $uploadsZip).Hash } else { $null }
        zip_bytes = if ($uploadsIncluded) { (Get-Item -LiteralPath $uploadsZip).Length } else { 0 }
    }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "ATEC backup completed:"
Write-Host "  Folder: $backupDir"
Write-Host "  Database: $dbDump"
if ($uploadsIncluded) {
    Write-Host "  Uploads: $uploadsZip"
}
Write-Host "  Manifest: $manifestPath"
