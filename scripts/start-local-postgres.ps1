$ErrorActionPreference = "Stop"

# Force PostgreSQL command-line tools to display messages in English.
$env:LANGUAGE = "en"
$env:LANG = "en_US.UTF-8"
$env:LC_ALL = "C"

$projectRoot = Split-Path -Parent $PSScriptRoot
$postgresRoot = Join-Path $projectRoot ".local\postgresql-17\pgsql"
$dataDirectory = Join-Path $projectRoot ".local\postgresql-data"
$logFile = Join-Path $projectRoot ".local\postgresql.log"
$pgCtl = Join-Path $postgresRoot "bin\pg_ctl.exe"
$pgIsReady = Join-Path $postgresRoot "bin\pg_isready.exe"

if (-not (Test-Path -LiteralPath $pgCtl)) {
    throw "Local PostgreSQL was not found at $postgresRoot"
}

& $pgIsReady -h 127.0.0.1 -p 5432 *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Local PostgreSQL is already running on 127.0.0.1:5432."
    exit 0
}

& $pgCtl -D $dataDirectory -l $logFile -o '"-h 127.0.0.1 -p 5432"' start
if ($LASTEXITCODE -ne 0) {
    throw "Local PostgreSQL could not be started. See $logFile"
}

& $pgIsReady -h 127.0.0.1 -p 5432
