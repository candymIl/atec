# Run interactively as the Windows user who will provision the accounts.
# Saves only Windows DPAPI ciphertext, outside Git. Does not create accounts.
$ErrorActionPreference = 'Stop'
$targetDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.local\portal-access-review'
$targetFile = Join-Path $targetDirectory 'bootstrap-password.dpapi'
if (Test-Path -LiteralPath $targetFile) {
    throw 'An encrypted bootstrap password already exists. It has not been overwritten.'
}
$first = $null
$second = $null
$firstPointer = [IntPtr]::Zero
$secondPointer = [IntPtr]::Zero
try {
    $first = Read-Host 'Enter the temporary portal password (hidden; at least 8 characters)' -AsSecureString
    $second = Read-Host 'Enter it again (hidden)' -AsSecureString
    $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
    if ([string]::IsNullOrWhiteSpace($firstText) -or $firstText.Length -lt 8) {
        throw 'Password must contain at least 8 characters and cannot be blank.'
    }
    if ([System.Text.Encoding]::UTF8.GetByteCount($firstText) -gt 72) {
        throw 'Password must be no more than 72 UTF-8 bytes for the current password hashing system.'
    }
    if ($firstText -cne $secondText) { throw 'The two passwords do not match. Nothing was saved.' }
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    $first | ConvertFrom-SecureString | Set-Content -LiteralPath $targetFile -Encoding ASCII
    Write-Host 'Password saved encrypted for this Windows account on this computer. No accounts were changed.'
} finally {
    $firstText = $null
    $secondText = $null
    if ($firstPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer) }
    if ($secondPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer) }
    if ($null -ne $first) { $first.Dispose() }
    if ($null -ne $second) { $second.Dispose() }
}
