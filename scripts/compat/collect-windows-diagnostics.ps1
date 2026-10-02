# Only observational collection for the exact installed executable in a fresh
# GitHub-hosted runner. No registry, ACL, dump, GPU, sandbox or security changes.
# Sources: rc2 apps/desktop/src/main.ts (setAppLogsPath, DSH_DESKTOP_DIAGNOSTIC_FILE);
# learn.microsoft.com/windows-server/performance/troubleshoot-application-service-crashing-behavior
# learn.microsoft.com/windows-server/failover-clustering/troubleshooting-using-wer-reports
# learn.microsoft.com/previous-versions/windows/desktop/krnlprov/win32-processstarttrace
# electron/electron v44.0.0 shell/common/electron_paths.cc: userData/Crashpad
[CmdletBinding()]
param([string]$ContextFile, [string]$ReadyFile, [string]$StopFile, [string]$ResultFile)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows runner required.' }
$context = Get-Content -LiteralPath $ContextFile -Raw | ConvertFrom-Json
$start = [DateTime]::Parse($context.startUtc).ToUniversalTime()
$result = [ordered]@{ startUtc = $context.startUtc; endUtc = $null; processSession = $null; processStarts = @(); events = @(); acl = @(); fatalLogs = @(); inventories = @(); errors = @() }
$sourceName = 'find-all-start-' + [guid]::NewGuid().ToString('N')
$subscription = $null
function Record-Error([string]$Stage, $Failure) { $result.errors += [ordered]@{ stage = $Stage; message = [string]$Failure.Exception.Message } }
function Drain-Starts {
    foreach ($event in @(Get-Event -SourceIdentifier $sourceName -ErrorAction SilentlyContinue)) {
        $item = $event.SourceEventArgs.NewEvent
        # The fresh installer preflight refused an existing same-named app.
        # Keep process metadata only: never command lines or environment blocks.
        $result.processStarts += [ordered]@{
            utc = [DateTime]::FromFileTimeUtc([long]$item.TIME_CREATED).ToString('o')
            pid = [long]$item.ProcessID; parentPid = [long]$item.ParentProcessID
            sessionId = [long]$item.SessionID; name = [string]$item.ProcessName
        }
        Remove-Event -EventIdentifier $event.EventIdentifier
    }
}
function Inventory([string]$Folder, [string]$Pattern, [bool]$Recurse) {
    $entry = [ordered]@{ path = $Folder; exists = (Test-Path -LiteralPath $Folder); files = @() }
    if ($entry.exists) {
        try {
            $files = @(Get-ChildItem -LiteralPath $Folder -File -Filter $Pattern -Recurse:$Recurse -ErrorAction Stop |
                Where-Object { $_.LastWriteTimeUtc -ge $start } | Select-Object -First 100)
            $entry.files = @($files | ForEach-Object { [ordered]@{ path = $_.FullName; bytes = $_.Length; modifiedUtc = $_.LastWriteTimeUtc.ToString('o') } })
        } catch { Record-Error 'inventory' $_ }
    }
    $result.inventories += $entry
}
try {
    try {
        $process = Get-Process -Id $context.nodePid
        $result.processSession = [ordered]@{ nodePid = $context.nodePid; sessionId = $process.SessionId; observedUtc = [DateTime]::UtcNow.ToString('o') }
    } catch { Record-Error 'runner-session' $_ }
    try {
        $subscription = Register-CimIndicationEvent -Namespace root/cimv2 -Query "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName='DeepSeek Harness.exe'" -SourceIdentifier $sourceName
    } catch { Record-Error 'process-start-observer' $_ }
    foreach ($target in @($context.executable, $context.runDirectory, (Split-Path $context.runDirectory), $context.userData, $context.paths.APPDATA, $context.paths.USERPROFILE, $context.paths.DSH_HOME)) {
        if (-not $target) { continue }
        $entry = [ordered]@{ path = $target; exists = (Test-Path -LiteralPath $target); sddl = $null; owner = $null }
        if ($entry.exists) {
            try { $acl = Get-Acl -LiteralPath $target; $entry.sddl = $acl.Sddl; $entry.owner = $acl.Owner }
            catch { Record-Error 'read-acl' $_ }
        }
        $result.acl += $entry
    }
    @{ observedUtc = [DateTime]::UtcNow.ToString('o'); observerRegistered = ($null -ne $subscription); session = $result.processSession } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReadyFile -Encoding utf8
    $deadline = [DateTime]::UtcNow.AddMinutes(20)
    while (-not (Test-Path -LiteralPath $StopFile) -and [DateTime]::UtcNow -lt $deadline) { Drain-Starts; Start-Sleep -Milliseconds 200 }
    Drain-Starts
    $context = Get-Content -LiteralPath $ContextFile -Raw | ConvertFrom-Json
    $matching = @()
    # Read existing events only. Absence is recorded; WER is never enabled or reconfigured.
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        try {
            $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000,1001; StartTime = $start; EndTime = [DateTime]::UtcNow } -ErrorAction SilentlyContinue)
            $matching = @($events | Where-Object {
                $xml = $_.ToXml()
                $xml.IndexOf($context.executable, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                ($_.ProviderName -eq 'Windows Error Reporting' -and $xml.IndexOf('>DeepSeek Harness.exe<', [StringComparison]::OrdinalIgnoreCase) -ge 0)
            })
            if ($matching.Count -gt 0 -or $attempt -eq 5) { break }
        } catch { Record-Error 'application-events' $_; break }
        Start-Sleep -Seconds 2
    }
    foreach ($event in @($matching)) {
        $xmlText = $event.ToXml(); [xml]$xml = $xmlText
        $fields = @($xml.Event.EventData.Data | ForEach-Object { [ordered]@{ name = $_.GetAttribute('Name'); value = $_.InnerText } })
        $result.events += [ordered]@{ id = $event.Id; recordId = $event.RecordId; provider = $event.ProviderName; utc = $event.TimeCreated.ToUniversalTime().ToString('o'); fields = $fields; xml = $xmlText }
    }
    $logs = Join-Path $context.userData 'logs'
    Inventory $logs 'crash-*.log' $false
    $fatalFiles = @()
    if (Test-Path -LiteralPath $logs) { $fatalFiles += @(Get-ChildItem -LiteralPath $logs -File -Filter 'crash-*.log' | Where-Object { $_.LastWriteTimeUtc -ge $start }) }
    if (Test-Path -LiteralPath $context.mainDiagnosticFile) { $fatalFiles += Get-Item -LiteralPath $context.mainDiagnosticFile }
    foreach ($file in $fatalFiles) {
        if ($file.Length -le 1048576) { $result.fatalLogs += [ordered]@{ path = $file.FullName; bytes = $file.Length; text = (Get-Content -LiteralPath $file.FullName -Raw) } }
        else { $result.errors += @{ stage = 'fatal-log-size'; message = 'Fatal log exceeds 1 MiB; recorded existence only.' } }
    }
    # Existing dump/Crashpad files: metadata only, never their bytes.
    Inventory (Join-Path $context.userData 'Crashpad') '*' $true
    Inventory (Join-Path $context.paths.LOCALAPPDATA 'CrashDumps') 'DeepSeek Harness.exe*' $false
    foreach ($store in @('ReportArchive', 'ReportQueue')) {
        $folder = Join-Path $env:ProgramData ('Microsoft\Windows\WER\' + $store)
        $result.inventories += [ordered]@{ path = $folder; exists = (Test-Path -LiteralPath $folder); scope = 'only matching AppCrash_DeepSeek* directories are inspected below' }
        if (Test-Path -LiteralPath $folder) {
            foreach ($dir in @(Get-ChildItem -LiteralPath $folder -Directory -Filter 'AppCrash_DeepSeek*' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $start } | Select-Object -First 20)) { Inventory $dir.FullName '*' $true }
        }
    }
} catch { Record-Error 'collector' $_ }
finally {
    if ($null -ne $subscription) { Unregister-Event -SourceIdentifier $sourceName -ErrorAction SilentlyContinue }
    $result.endUtc = [DateTime]::UtcNow.ToString('o')
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ResultFile -Encoding utf8
}
