$ErrorActionPreference = "Stop"

# Force PostgreSQL command-line tools to display messages in English.
$env:LANGUAGE = "en"
$env:LANG = "en_US.UTF-8"
$env:LC_ALL = "C"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pgCtl = Join-Path $projectRoot ".local\postgresql-17\pgsql\bin\pg_ctl.exe"
$dataDirectory = Join-Path $projectRoot ".local\postgresql-data"

if (-not (Test-Path -LiteralPath $pgCtl)) {
    throw "Local PostgreSQL was not found."
}

& $pgCtl -D $dataDirectory stop -m fast
if ($LASTEXITCODE -ne 0) {
    throw "Local PostgreSQL could not be stopped."
}

Write-Host "Local PostgreSQL stopped."
