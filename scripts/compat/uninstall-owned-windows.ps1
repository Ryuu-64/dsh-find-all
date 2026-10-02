<# Remove only this run's verified installation before testing another version.
Official rc2 apps/desktop/tests/windows-installer-smoke.ps1 uses the same local
uninstaller and /S. The reviewed three tags' installer/uninstall.nsh support
/KEEP_APP_DATA and never remove Harness home. Never edit registry keys directly.
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallationReport)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows runner required.' }
$report = Get-Content -LiteralPath $InstallationReport -Raw | ConvertFrom-Json
if ($report.status -ne 'passed' -or $report.version -notin @('0.2.0-rc.2', '0.2.0-rc.1', '0.1.7-rc.2')) { throw 'A verified, supported owned installation report is required.' }
$temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$run = [IO.Path]::GetFullPath($report.runDirectory)
$install = [IO.Path]::GetFullPath($report.installDirectory)
if (-not $run.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($run) -notmatch '^find-all-desktop-[a-f0-9]{32}$') { throw 'Installation is outside this test temporary root.' }
if (-not $install.Equals((Join-Path $run 'installed'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected owned installation directory.' }
if ((Get-Item -LiteralPath $install).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked installation directory.' }
$app = Join-Path $install 'DeepSeek Harness.exe'
$uninstaller = Join-Path $install 'Uninstall DeepSeek Harness.exe'
if ($app -ne $report.executable -or (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant() -ne $report.executableSha256) { throw 'Owned executable changed; refusing removal.' }
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) { throw 'An application process remains; no uninstaller or process-name termination will be attempted.' }
$registrations = @()
foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path $root) {
        foreach ($entry in @(Get-ChildItem $root | Get-ItemProperty | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like '*DeepSeek Harness*' })) {
            if (-not $root.StartsWith('HKCU:') -or -not $entry.PSObject.Properties['InstallLocation'] -or -not $entry.InstallLocation.TrimEnd('\').Equals($install, [StringComparison]::OrdinalIgnoreCase)) { throw 'A foreign installation registration exists; refusing removal.' }
            $registrations += $entry.PSPath
        }
    }
}
if ($registrations.Count -ne 1) { throw 'Expected exactly one matching current-user installation registration.' }
foreach ($file in @($app, $uninstaller)) {
    $item = Get-Item -LiteralPath $file
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked executable.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $report.signature.thumbprint) { throw 'Executable publisher does not match the verified installer.' }
}
$process = $null
try {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S /KEEP_APP_DATA' -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(60000)) { throw 'Owned uninstaller timed out; no prompt was accepted.' }
    if ($process.ExitCode -ne 0) { throw "Owned uninstaller failed: $($process.ExitCode)" }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ((Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $registrations[0])) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Owned installation was not fully removed; next installation is blocked.' }
        Start-Sleep -Milliseconds 100
    }
} finally {
    if ($null -ne $process) {
        if (-not $process.HasExited) { $process.Kill($true); [void]$process.WaitForExit(10000) }
        $process.Dispose()
    }
}
Write-Output "Removed only the verified owned $($report.version) installation; application and Harness data were preserved."
