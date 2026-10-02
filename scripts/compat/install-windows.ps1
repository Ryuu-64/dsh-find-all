<#
Install only the researched rc2 release on a disposable GitHub-hosted Windows runner.
Run with pwsh -NoProfile -File; do not change execution/security policy to run this file.
The fixed latest URL is mutable: a different version or signature fails before execution.

Sources inspected at dsh-v0.2.0-rc.2 in deepseek-ai/deepseek-harness:
  apps/desktop/scripts/electron-builder-config.mjs (productName, per-user, no elevation)
  apps/desktop/scripts/installer.nsh; apps/desktop/installer/pages.nsh (no EULA page)
  apps/desktop/tests/windows-installer-smoke.ps1 (supported /S /D= argument form)
  apps/desktop/README.md (bundled CLI and Desktop profile ownership)
No agreement, permissions prompt, unsigned fallback, or security-policy bypass is automated.
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = '0.2.0-rc.2'
$url = 'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe'
$product = 'DeepSeek Harness'
$output = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($output)
$reportPath = Join-Path $output 'installer.json'
if (Test-Path -LiteralPath $reportPath) { throw 'Use a fresh evidence directory; installer.json already exists.' }
$report = [ordered]@{
    schemaVersion = 1
    target = 'windows-x64-electron'
    version = $version
    sourceTag = 'dsh-v0.2.0-rc.2'
    sourceUrl = $url
    status = 'pending'
    stage = 'runner-preflight'
    installerSha256 = $null
    installerBytes = $null
    signature = $null
    executable = $null
    bundledCli = $null
    installationScope = 'current disposable runner user'
    arguments = '/S /D=<new empty temporary directory>'
    agreementReview = 'No EULA/acceptance page found in the pinned rc2 installer configuration and custom pages; unreviewed versions are refused.'
}
$setup = $null
function Read-Signature([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    $result = [ordered]@{
        status = [string]$signature.Status
        subject = $null
        issuer = $null
        thumbprint = $null
        timestampSubject = $null
    }
    if ($null -ne $signature.SignerCertificate) {
        $result.subject = $signature.SignerCertificate.Subject
        $result.issuer = $signature.SignerCertificate.Issuer
        $result.thumbprint = $signature.SignerCertificate.Thumbprint
    }
    if ($null -ne $signature.TimeStamperCertificate) {
        $result.timestampSubject = $signature.TimeStamperCertificate.Subject
    }
    return $result
}
try {
    if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
        throw 'This installer is restricted to disposable GitHub-hosted Windows runners.'
    }
    if ($env:RUNNER_ARCH -ne 'X64' -or -not $env:RUNNER_TEMP) { throw 'An x64 Windows runner with RUNNER_TEMP is required.' }
    if (Get-Process -Name $product -ErrorAction SilentlyContinue) { throw 'An existing DeepSeek Harness process must not be touched.' }
    foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path $root) {
            $existing = Get-ChildItem $root | Get-ItemProperty | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like '*DeepSeek Harness*' }
            if ($existing) { throw 'A pre-existing installation was found; refusing to replace it.' }
        }
    }
    $run = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('find-all-desktop-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($run)
    $installer = Join-Path $run 'dsh-windows-x64.exe'
    $install = Join-Path $run 'installed'
    [void][IO.Directory]::CreateDirectory($install)
    $report.runDirectory = $run
    $report.installDirectory = $install
    $report.installer = $installer
    $report.stage = 'download'
    # Do not silently follow a changed distributor or accept TLS/security warnings.
    Invoke-WebRequest -Uri $url -OutFile $installer -MaximumRedirection 0 -TimeoutSec 600
    $item = Get-Item -LiteralPath $installer
    $report.installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.installerBytes = $item.Length
    $report.fileVersion = $item.VersionInfo.FileVersion
    $report.productVersion = $item.VersionInfo.ProductVersion
    $report.signature = Read-Signature $installer
    $report.stage = 'verify-installer'
    if ($item.Length -ne 289313640) { throw 'Installer byte length changed from the researched rc2 download; review the new artifact before running it.' }
    if ($report.fileVersion -ne $version -or $report.productVersion -ne $version) {
        throw 'The mutable download URL no longer supplies the researched rc2 installer.'
    }
    if ($report.signature.status -ne 'Valid' -or -not $report.signature.thumbprint) {
        throw 'The official installer does not have a valid Windows Authenticode signature; no fallback is permitted.'
    }
    if (@(Get-ChildItem -LiteralPath $install -Force).Count -ne 0) { throw 'The temporary installation directory must be empty.' }
    $report.stage = 'install'
    # NSIS /D= must be last and unquoted, even for a path containing spaces.
    # Never use /allusers, RunAs, or the updater mode.
    $setup = Start-Process -FilePath $installer -ArgumentList ('/S /D=' + $install) -PassThru
    if (-not $setup.WaitForExit(300000)) {
        throw 'Installer timed out. An unknown prompt or policy may require review; no prompt was accepted.'
    }
    $report.exitCode = $setup.ExitCode
    if ($setup.ExitCode -ne 0) { throw "Installer failed with exit code $($setup.ExitCode); no fallback or policy change is permitted." }
    $executable = Join-Path $install ($product + '.exe')
    $cli = Join-Path $install 'resources\runtime\cli\bin\dsh.cmd'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or -not (Test-Path -LiteralPath $cli -PathType Leaf)) {
        throw 'The expected packaged executable or official bundled CLI is missing.'
    }
    $report.stage = 'verify-installed-app'
    $report.appSignature = Read-Signature $executable
    if ($report.appSignature.status -ne 'Valid' -or $report.appSignature.thumbprint -ne $report.signature.thumbprint) {
        throw 'The installed executable signature is invalid or differs from the installer publisher.'
    }
    $report.executable = $executable
    $report.bundledCli = $cli
    $report.executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.status = 'passed'
    $report.stage = 'installed'
} catch {
    $report.status = 'failed'
    # Only this fixed URL and synthetic runner paths can occur; strip any URL query
    # nevertheless. Never include PowerShell's full invocation/environment dump.
    $report.error = ([string]$_.Exception.Message -replace '(https?://[^\s?]+)\?[^\s]+', '$1?[redacted]')
    throw $report.error
} finally {
    if ($null -ne $setup) {
        if (-not $setup.HasExited) { $setup.Kill($true); [void]$setup.WaitForExit(10000) }
        $setup.Dispose()
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
Write-Output "Verified $product $version installed for the disposable runner. See installer.json."
