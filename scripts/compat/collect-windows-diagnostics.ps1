# Only observational collection for the exact installed executable in a fresh
# GitHub-hosted runner. No registry, ACL, dump, GPU, sandbox or security changes.
# Sources: rc2 apps/desktop/src/main.ts (setAppLogsPath, DSH_DESKTOP_DIAGNOSTIC_FILE);
# learn.microsoft.com/windows-server/performance/troubleshoot-application-service-crashing-behavior
# learn.microsoft.com/windows-server/failover-clustering/troubleshooting-using-wer-reports
# learn.microsoft.com/previous-versions/windows/desktop/krnlprov/win32-processstarttrace
# electron/electron v44.0.0 shell/common/electron_paths.cc: userData/Crashpad
[CmdletBinding()]
param([string]$ContextFile, [string]$ReadyFile, [string]$StopFile, [string]$ResultFile, [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Write-AtomicJson([string]$Path, $Value, [int]$Depth) {
    # Publish complete UTF-8 bytes by same-directory rename, never truncate the
    # path that the Node reader treats as readiness. File.Move overwrite is a
    # supported .NET Core API; no permissions or security settings are changed.
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth $Depth), [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temporary, $Path, $true)
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}
function Read-EventFields([xml]$Document) {
    # Use actual DOM nodes: PowerShell's .EventData.Data adapter can unwrap
    # un-attributed Data elements into plain strings.
    return @($Document.SelectNodes('//*[local-name()="EventData"]/*[local-name()="Data"]') |
        ForEach-Object { [ordered]@{ name = $_.GetAttribute('Name'); value = $_.InnerText } })
}
if ($SelfTest) {
    [xml]$fixture = '<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><EventData><Data Name="AppPath">synthetic.exe</Data><Data>unnamed value</Data><Data Name="Empty" /></EventData></Event>'
    $fields = @(Read-EventFields $fixture)
    if ($fields.Count -ne 3 -or $fields[0].name -ne 'AppPath' -or $fields[0].value -ne 'synthetic.exe' -or $fields[1].name -ne '' -or $fields[1].value -ne 'unnamed value' -or $fields[2].value -ne '') { throw 'Event XML field regression failed.' }
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('find-all-json-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($scratch)
    try {
        $file = Join-Path $scratch 'ready.json'
        Write-AtomicJson $file @{ observerRegistered = $true; observedUtc = [DateTime]::UtcNow.ToString('o'); revision = 1 } 5
        Write-AtomicJson $file @{ observerRegistered = $false; observedUtc = [DateTime]::UtcNow.ToString('o'); revision = 2 } 5
        $ready = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        if ($ready.revision -ne 2 -or $ready.observerRegistered -ne $false -or @(Get-ChildItem -LiteralPath $scratch).Count -ne 1) { throw 'Atomic JSON publication regression failed.' }
    } finally { Remove-Item -LiteralPath $scratch -Recurse -Force }
    Write-Output 'Event XML fields and complete JSON publication/replacement passed.'
    return
}
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted Windows runner required.' }
$context = Get-Content -LiteralPath $ContextFile -Raw | ConvertFrom-Json
$start = [DateTime]::Parse($context.startUtc).ToUniversalTime()
$result = [ordered]@{ startUtc = $context.startUtc; endUtc = $null; processSession = $null; processStarts = @(); events = @(); acl = @(); fatalLogs = @(); inventories = @(); errors = @() }
$sourceName = 'find-all-start-' + [guid]::NewGuid().ToString('N')
$observerRegistered = $false
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
        Register-CimIndicationEvent -Namespace root/cimv2 -Query "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName='DeepSeek Harness.exe'" -SourceIdentifier $sourceName | Out-Null
        $observerRegistered = $true
    } catch { Record-Error 'process-start-observer' $_ }
    # Inventory existing Microsoft tools only. Never install or configure them.
    # Microsoft ebpf-for-windows/docs/CrashDumpDebugging.md documents this SDK path.
    $result.debuggers = @()
    $toolNames = @('cdb.exe', 'cdbX64.exe', 'windbg.exe', 'symchk.exe', 'dumpchk.exe')
    $toolPaths = @()
    foreach ($name in $toolNames) {
        $toolPaths += @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
        foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
            if ($root) { $toolPaths += Join-Path $root ('Windows Kits\10\Debuggers\x64\' + $name) }
        }
    }
    $result.debuggerSearch = 'PATH and existing Windows Kits/10/Debuggers/x64; no installation or persistent symbol configuration'
    foreach ($tool in @($toolPaths | Sort-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { continue }
        try {
            $sig = Get-AuthenticodeSignature -LiteralPath $tool
            $subject = $null
            if ($null -ne $sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }
            $item = Get-Item -LiteralPath $tool
            $result.debuggers += [ordered]@{ path = $tool; name = $item.Name; version = $item.VersionInfo.FileVersion; signatureStatus = [string]$sig.Status; publisher = $subject }
        } catch { Record-Error 'debugger-inventory' $_ }
    }
    foreach ($target in @($context.executable, $context.runDirectory, (Split-Path $context.runDirectory), $context.userData, $context.paths.APPDATA, $context.paths.USERPROFILE, $context.paths.DSH_HOME)) {
        if (-not $target) { continue }
        $entry = [ordered]@{ phase = 'before-launch'; path = $target; exists = (Test-Path -LiteralPath $target); sddl = $null; owner = $null }
        if ($entry.exists) {
            try { $acl = Get-Acl -LiteralPath $target; $entry.sddl = $acl.Sddl; $entry.owner = $acl.Owner }
            catch { Record-Error 'read-acl' $_ }
        }
        $result.acl += $entry
    }
    Write-AtomicJson $ReadyFile @{ observedUtc = [DateTime]::UtcNow.ToString('o'); observerRegistered = $observerRegistered; session = $result.processSession } 5
    $deadline = [DateTime]::UtcNow.AddMinutes(20)
    while (-not (Test-Path -LiteralPath $StopFile) -and [DateTime]::UtcNow -lt $deadline) { Drain-Starts; Start-Sleep -Milliseconds 200 }
    Drain-Starts
    $context = Get-Content -LiteralPath $ContextFile -Raw | ConvertFrom-Json
    $eventMap = @{}
    # Read the complete bounded interval: Event 1001 can arrive after 1000.
    # Absence is distinct from a failed read; WER is never reconfigured.
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        Drain-Starts
        try {
            $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000,1001; StartTime = $start; EndTime = [DateTime]::UtcNow } -ErrorAction Stop)
        } catch {
            if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $events = @() }
            else { Record-Error 'application-events' $_; break }
        }
        foreach ($event in $events) {
            $xml = $event.ToXml()
            if ($xml.IndexOf($context.executable, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                ($event.ProviderName -eq 'Windows Error Reporting' -and $xml.IndexOf('>DeepSeek Harness.exe<', [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
                $eventMap[[string]$event.RecordId] = $event
            }
        }
        if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    Drain-Starts
    $matching = @($eventMap.Values | Sort-Object RecordId)
    foreach ($event in @($matching)) {
        try {
            $xmlText = $event.ToXml()
            $row = [ordered]@{ id = $event.Id; recordId = $event.RecordId; provider = $event.ProviderName; utc = $event.TimeCreated.ToUniversalTime().ToString('o'); fields = @(); xml = $xmlText }
            # Keep the original XML even if optional field parsing fails.
            try { $row.fields = @(Read-EventFields ([xml]$xmlText)) }
            catch { Record-Error 'event-field-parsing' $_ }
            $result.events += $row
        } catch { Record-Error 'event-xml-read' $_ }
    }
    $logs = Join-Path $context.userData 'logs'
    # The directory may not exist until startup. Preserve both pre/post facts.
    foreach ($target in @((Split-Path $context.userData), $context.userData, $logs, $context.paths.DSH_HOME)) {
        $entry = [ordered]@{ phase = 'after-launch'; path = $target; exists = (Test-Path -LiteralPath $target); sddl = $null; owner = $null }
        if ($entry.exists) {
            try { $acl = Get-Acl -LiteralPath $target; $entry.sddl = $acl.Sddl; $entry.owner = $acl.Owner }
            catch { Record-Error 'read-post-launch-acl' $_ }
        }
        $result.acl += $entry
    }
    $result.mainDiagnostic = [ordered]@{ path = $context.mainDiagnosticFile; exists = (Test-Path -LiteralPath $context.mainDiagnosticFile) }
    Inventory $logs 'crash-*.log' $false
    $fatalFiles = @()
    if (Test-Path -LiteralPath $logs) { $fatalFiles += @(Get-ChildItem -LiteralPath $logs -File -Filter 'crash-*.log' | Where-Object { $_.LastWriteTimeUtc -ge $start }) }
    if (Test-Path -LiteralPath $context.mainDiagnosticFile) { $fatalFiles += Get-Item -LiteralPath $context.mainDiagnosticFile }
    foreach ($file in $fatalFiles) {
        if ($file.Length -le 1048576) { $result.fatalLogs += [ordered]@{ path = $file.FullName; bytes = $file.Length; text = (Get-Content -LiteralPath $file.FullName -Raw) } }
        else { $result.errors += @{ stage = 'fatal-log-size'; message = 'Fatal log exceeds 1 MiB; recorded existence only.' } }
    }
    # This inventory records existence only. The separate bounded analyzer may
    # read metadata from matching automatic dumps; no dump bytes are uploaded.
    Inventory (Join-Path $context.userData 'Crashpad') '*' $true
    Inventory (Join-Path $context.paths.LOCALAPPDATA 'CrashDumps') 'DeepSeek Harness.exe*' $false
    foreach ($store in @('ReportArchive', 'ReportQueue')) {
        $folder = Join-Path $env:ProgramData ('Microsoft\Windows\WER\' + $store)
        $result.inventories += [ordered]@{ path = $folder; exists = (Test-Path -LiteralPath $folder); scope = 'only matching AppCrash_DeepSeek* directories are inspected below' }
        if (Test-Path -LiteralPath $folder) {
            try {
                foreach ($dir in @(Get-ChildItem -LiteralPath $folder -Directory -Filter 'AppCrash_DeepSeek*' -ErrorAction Stop | Where-Object { $_.LastWriteTimeUtc -ge $start } | Select-Object -First 20)) { Inventory $dir.FullName '*' $true }
            } catch { Record-Error 'wer-directory-listing' $_ }
        }
    }
} catch { Record-Error 'collector' $_ }
finally {
    if ($observerRegistered) { Unregister-Event -SourceIdentifier $sourceName -ErrorAction SilentlyContinue }
    $result.endUtc = [DateTime]::UtcNow.ToString('o')
    Write-AtomicJson $ResultFile $result 12
}
