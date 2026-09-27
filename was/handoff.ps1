param([ValidateSet('inspect', 'leave', 'return')][string]$Action = 'inspect')

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path $PSScriptRoot -Parent
$config = Get-Content (Join-Path $root 'servers.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$local = Get-Content (Join-Path $root 'local.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($property in $local.PSObject.Properties) {
    $config | Add-Member $property.Name $property.Value -Force
}
$handoff = $config.cluster.handoff
if (!$handoff) { exit 0 }
$mutex = [Threading.Mutex]::new($false, 'Global\OanismajorHandoff')
if (!$mutex.WaitOne($(if ($Action -eq 'leave') { 30000 } else { 0 }))) { exit 1 }
$journal = Join-Path $env:LOCALAPPDATA 'oanismajor/handoff.json'

function Save-Step($Value) {
    $null = [IO.Directory]::CreateDirectory((Split-Path $journal -Parent))
    $temporary = "$journal.next"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $journal) { [IO.File]::Replace($temporary, $journal, "$journal.previous") }
    else { [IO.File]::Move($temporary, $journal) }
}

function Invoke-Step([bool]$Remote, [string]$Step, $Ticket) {
    if ($Step -ne 'inspect') {
        $null = [IO.Directory]::CreateDirectory((Split-Path $journal -Parent))
        [IO.File]::AppendAllText("$journal.log", [DateTime]::UtcNow.ToString('o') + " $Step remote=$Remote`r`n")
    }
    $request = @{ action = $Step }
    if ($null -ne $Ticket) { $request.ticket = $Ticket }
    $payload = $request | ConvertTo-Json -Depth 12 -Compress
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    if ($Remote) {
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = 'wsl.exe'
        $start.Arguments = "-d $($config.distribution) -u root --exec ssh -i /root/.ssh/oanismajor -o IdentitiesOnly=yes -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 $($handoff.peer.user)@$($handoff.peer.address) handoff $encoded"
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($start)
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(120000)) { $process.Kill(); throw "Handoff $Step timeout" }
        $output = $stdout.GetAwaiter().GetResult()
        $failure = $stderr.GetAwaiter().GetResult()
        $code = $process.ExitCode
        $process.Dispose()
        if ($code -ne 0) { throw "Handoff $Step failed: $failure" }
    } else {
        $output = & wsl.exe -d $config.distribution -u root --exec `
            $config.node "$($config.root)/db/handoff.js" $encoded
    }
    if (!$Remote -and $LASTEXITCODE -ne 0) { throw "Handoff $Step failed" }
    return ($output | ConvertFrom-Json)
}

try {
    if ($Action -ne 'inspect' -and (Test-Path -LiteralPath $journal)) {
        $pending = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
        $target = [bool]$pending.target
        if ($pending.phase -eq 'prepared') {
            $pending.ticket = Invoke-Step (!$target) 'freeze' $pending.ticket
            $pending.phase = 'frozen'
            Save-Step $pending
        }
        if ($pending.phase -eq 'frozen') {
            $pending.ticket = Invoke-Step $target 'promote' $pending.ticket
            $pending.phase = 'promoted'
            Save-Step $pending
        }
        if ($pending.phase -ne 'promoted') { throw 'Invalid handoff journal' }
        $null = Invoke-Step (!$target) 'rejoin' $pending.ticket
        Remove-Item -LiteralPath $journal
    }
    $current = Invoke-Step $false 'inspect' $null
    if ($Action -eq 'inspect') {
        $current | ConvertTo-Json -Depth 12
        exit 0
    }
    if ($Action -eq 'leave' -and $current.recovery) { exit 0 }
    if ($Action -eq 'return' -and (!$current.recovery -or
        $config.cluster.address -ne $handoff.preferred)) { exit 0 }
    $remote = Invoke-Step $true 'inspect' $null
    if ($current.system -ne $remote.system -or $current.recovery -eq $remote.recovery) {
        throw 'Database roles do not match'
    }
    $target = $Action -eq 'leave'
    $prepared = Invoke-Step $target 'prepare' $null
    Save-Step @{ phase = 'prepared'; target = $target; ticket = $prepared }
    $frozen = Invoke-Step (!$target) 'freeze' $prepared
    Save-Step @{ phase = 'frozen'; target = $target; ticket = $frozen }
    $promoted = Invoke-Step $target 'promote' $frozen
    Save-Step @{ phase = 'promoted'; target = $target; ticket = $promoted }
    $null = Invoke-Step (!$target) 'rejoin' $promoted
    Remove-Item -LiteralPath $journal
} catch {
    $null = [IO.Directory]::CreateDirectory((Split-Path $journal -Parent))
    [IO.File]::AppendAllText("$journal.log", [DateTime]::UtcNow.ToString('o') + ' ' + $_.Exception.Message + "`r`n")
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
