[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDump,

    [Parameter(Mandatory = $true)]
    [string]$RestoreDatabaseName,

    [string]$EnvFile,
    [string]$UploadsZip,
    [string]$RestoreUploadsPath,
    [string]$PgRestorePath = "pg_restore",
    [string]$CreatedbPath = "createdb",
    [string]$PsqlPath = "psql",
    [string]$DbHost,
    [string]$DbPort,
    [string]$DbName,
    [string]$DbUser,
    [string]$DbPassword,
    [switch]$SkipCreateDatabase
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

        $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
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

if (-not (Test-Path -LiteralPath $BackupDump)) {
    throw "Backup dump was not found: $BackupDump"
}

$envValues = Read-DotEnv -Path $EnvFile
$DbHost = First-Value -Provided $DbHost -EnvValues $envValues -Key "DB_HOST" -DefaultValue "localhost"
$DbPort = First-Value -Provided $DbPort -EnvValues $envValues -Key "DB_PORT" -DefaultValue "5432"
$DbName = First-Value -Provided $DbName -EnvValues $envValues -Key "DB_NAME"
$DbUser = First-Value -Provided $DbUser -EnvValues $envValues -Key "DB_USER"
$DbPassword = First-Value -Provided $DbPassword -EnvValues $envValues -Key "DB_PASSWORD"

if ($RestoreDatabaseName -eq $DbName) {
    throw "Refusing to restore into the live database '$DbName'. Use a separate test database name such as atec_restore_test."
}

$resolvedPgRestorePath = Resolve-ToolPath -ToolPath $PgRestorePath -ToolFileName "pg_restore.exe"
$resolvedPsqlPath = Resolve-ToolPath -ToolPath $PsqlPath -ToolFileName "psql.exe"
$resolvedCreatedbPath = Resolve-ToolPath -ToolPath $CreatedbPath -ToolFileName "createdb.exe"

if ([string]::IsNullOrWhiteSpace($resolvedPgRestorePath)) {
    throw "Could not find pg_restore at '$PgRestorePath'. Install PostgreSQL client tools or pass the full path."
}

if ([string]::IsNullOrWhiteSpace($resolvedPsqlPath)) {
    throw "Could not find psql at '$PsqlPath'. Install PostgreSQL client tools or pass the full path."
}

if (-not $SkipCreateDatabase -and [string]::IsNullOrWhiteSpace($resolvedCreatedbPath)) {
    throw "Could not find createdb. Install PostgreSQL client tools, pass -CreatedbPath, or use -SkipCreateDatabase if the restore database already exists."
}

$oldPgPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $DbPassword

    if (-not $SkipCreateDatabase) {
        Write-Host "Creating restore database '$RestoreDatabaseName' if possible..."
        & $resolvedCreatedbPath "--host=$DbHost" "--port=$DbPort" "--username=$DbUser" $RestoreDatabaseName
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "createdb returned exit code $LASTEXITCODE. If the database already exists, this can be ignored."
        }
    }

    Write-Host "Restoring backup into '$RestoreDatabaseName'..."
    & $resolvedPgRestorePath "--host=$DbHost" "--port=$DbPort" "--username=$DbUser" "--dbname=$RestoreDatabaseName" "--clean" "--if-exists" "--no-owner" $BackupDump
    if ($LASTEXITCODE -ne 0) {
        throw "pg_restore failed with exit code $LASTEXITCODE."
    }

    Write-Host "Checking restored record counts..."
    $verifySql = @"
SELECT 'clients' AS item, count(*) FROM atec.tblclients
UNION ALL SELECT 'assets', count(*) FROM atec.tblasset
UNION ALL SELECT 'inspections', count(*) FROM atec.tblinspection
UNION ALL SELECT 'inspection_results', count(*) FROM atec.tblinspectionresult
UNION ALL SELECT 'users', count(*) FROM atec.tblusers;
"@
    & $resolvedPsqlPath "--host=$DbHost" "--port=$DbPort" "--username=$DbUser" "--dbname=$RestoreDatabaseName" "--tuples-only" "--no-align" "--command=$verifySql"
    if ($LASTEXITCODE -ne 0) {
        throw "psql verification failed with exit code $LASTEXITCODE."
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

if (-not [string]::IsNullOrWhiteSpace($UploadsZip)) {
    if (-not (Test-Path -LiteralPath $UploadsZip)) {
        throw "Uploads zip was not found: $UploadsZip"
    }
    if ([string]::IsNullOrWhiteSpace($RestoreUploadsPath)) {
        throw "Pass -RestoreUploadsPath when using -UploadsZip."
    }

    New-Item -ItemType Directory -Force -Path $RestoreUploadsPath | Out-Null
    Expand-Archive -LiteralPath $UploadsZip -DestinationPath $RestoreUploadsPath -Force
    Write-Host "Uploads restored to: $RestoreUploadsPath"
}

Write-Host ""
Write-Host "Restore verification completed. Keep this as proof that the backup can be recovered."
