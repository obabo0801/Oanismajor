param(
    [ValidateSet('cli', 'start', 'stop', 'restart', 'status', 'logs', 'update', 'install', 'uninstall', 'control')]
    [string]$Action = 'cli',
    [ValidateSet('', 'was', 'web', 'db')][string]$Role = '',
    [string]$Instance = ''
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$directory = Split-Path $PSScriptRoot -Parent
$local = Join-Path $directory 'local.json'
$utf8 = [Text.UTF8Encoding]::new($false)
$code = 0
$script:quiet = $false
$line = '───────────────────────────────────────────────'
Set-Location -LiteralPath $directory

function Read-Config {
    $script:config = Get-Content servers.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:settings = if (Test-Path -LiteralPath $local) {
        Get-Content -LiteralPath $local -Raw -Encoding UTF8 | ConvertFrom-Json
    } else { [pscustomobject]@{} }
    foreach ($property in $settings.PSObject.Properties) {
        $config | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force
    }
    $language = $settings.lang
    if ($language -notin @('ko', 'en')) {
        $language = if ((Get-UICulture).Name -like 'ko*') { 'ko' } else { 'en' }
    }
    $script:message = Get-Content (Join-Path $PSScriptRoot "i18n/$language.json") `
        -Raw -Encoding UTF8 | ConvertFrom-Json
    $env:OANISMAJOR_LANG = $language
}

function Banner {
    $art = Get-Content (Join-Path $PSScriptRoot 'banner.txt') -Raw -Encoding UTF8
    Write-Host $art.TrimEnd()
}

function Paint {
    param([string]$Value, [string]$Tone = 'mute')
    if ([Console]::IsOutputRedirected) { return $Value }
    $colors = @{ success = '52;199;89'; error = '255;69;58'; focus = '55;121;255'; mute = '110;110;110' }
    return "$([char]27)[38;2;$($colors[$Tone])m$Value$([char]27)[0m"
}

function Width {
    param([string]$Value)
    return $Value.Length + [regex]::Matches($Value, '[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff01-\uff60]').Count
}

function Offline {
    $rows = @()
    foreach ($service in @('was', 'web', 'db')) {
        if ($Role -and $Role -ne $service) { continue }
        $items = @($config.$service)
        if ($Instance) {
            $items = @($items | Where-Object { "$_" -eq $Instance -or "$($_.port)" -eq $Instance -or $_.name -eq $Instance })
        }
        if (!$items.Count) { continue }
        $rows += ,@($service.ToUpper(), $message.states.inactive, '', '')
    }
    $columns = @($message.columns)
    $widths = @(0, 0, 0, 0)
    $all = @()
    $all += ,$columns
    foreach ($row in $rows) { $all += ,$row }
    foreach ($row in $all) {
        for ($i = 0; $i -lt 4; $i++) { $widths[$i] = [Math]::Max($widths[$i], (Width $row[$i])) }
    }
    $segments = @($widths | ForEach-Object { '─' * ($_ + 2) })
    Write-Host (Paint ('┌' + ($segments -join '┬') + '┐'))
    for ($index = 0; $index -lt $all.Count; $index++) {
        $cells = for ($i = 0; $i -lt 4; $i++) {
            $tone = if ($index -gt 0 -and $i -eq 1) { 'error' } else { 'mute' }
            $space = $widths[$i] - (Width $all[$index][$i])
            Paint ((' ' * [int][Math]::Floor($space / 2)) + $all[$index][$i] + (' ' * [int][Math]::Ceiling($space / 2))) $tone
        }
        Write-Host ((Paint '│ ') + ($cells -join (Paint ' │ ')) + (Paint ' │'))
        if ($index -eq 0) { Write-Host (Paint ('├' + ($segments -join '┼') + '┤')) }
    }
    Write-Host (Paint ('└' + ($segments -join '┴') + '┘'))
}

function Running {
    $ErrorActionPreference = 'Continue'
    $output = (& wsl.exe --list --running --quiet 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) { throw $message.unavailable }
    $names = $output.Replace([string][char]0, '') -split '\r?\n' |
        ForEach-Object { $_.Trim() } | Where-Object { $_ }
    return $names -contains $config.distribution
}

function Ready {
    $ErrorActionPreference = 'Continue'
    if (!$settings.cluster -or !(Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        return $false
    }
    if (!(Running)) {
        return [bool](Get-ScheduledTask -TaskName "oanismajor $($config.distribution)" -ErrorAction SilentlyContinue)
    }
    & wsl.exe -d $config.distribution -u root --exec test -x $config.node *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & wsl.exe -d $config.distribution -u root --exec test -f "$($config.root)/run.js" *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & wsl.exe -d $config.distribution -u root --exec test -f /etc/systemd/system/was.service *> $null
    return $LASTEXITCODE -eq 0
}

function Install {
    param([string]$Command = 'install', [string]$Log)
    if ($Command -eq 'update') {
        if (!(Running)) { throw $message.wsl }
        $source = & wsl.exe -d $config.distribution -u root --exec wslpath -a $directory
        if ($LASTEXITCODE -ne 0) { throw $message.failed }
        $previous = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & wsl.exe -d $config.distribution -u root --exec bash "$source/was/install.sh" $source update 2>&1 | ForEach-Object {
                [IO.File]::AppendAllText($Log, "$_`n", $utf8)
                if ("$_" -match '^@oanismajor:(\w+)$') {
                    [Console]::Write("`r" + (Paint $message.progress.($Matches[1]) success) + "`r`n")
                }
            }
            $result = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previous }
        if ($result -ne 0) { throw $message.failed }
        Read-Config
        if ($settings.cluster.handoff.enabled) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'host/setup.ps1') -Update
            if ($LASTEXITCODE -ne 0) { throw $message.failed }
        }
        return
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $PSScriptRoot 'install.ps1') -Managed -Language $env:OANISMAJOR_LANG | Out-Host
    if ($LASTEXITCODE -ne 0) { throw $message.failed }
    Read-Config
    if (!(Ready)) { throw $message.bootstrap }
}

function Available {
    param([string]$Command)
    $names = @()
    if (Running) {
        $query = if ($Command -eq 'start') { 'starting' } else { 'stopping' }
        $names = @(& wsl.exe -d $config.distribution -u root --exec $config.node "$($config.root)/run.js" $query)
        if ($LASTEXITCODE -ne 0) { throw $message.failed }
    } elseif ($Command -eq 'start') {
        $names = @('was', 'web', 'db' | Where-Object { @($config.$_).Count })
    }
    return $names
}

function Choose {
    param([string]$Command)
    $script:quiet = $true
    $names = @(Available $Command)
    if (!$names.Count -or [Console]::IsInputRedirected) { return }
    while ($true) {
        Write-Host (Paint ("1. " + $message.all))
        for ($i = 0; $i -lt $names.Count; $i++) { Write-Host (Paint ("$($i + 2). " + $names[$i].ToUpper())) }
        Write-Host (Paint ("0. " + $message.back))
        $choice = Read-Host $message.select
        if ($null -eq $choice -or $choice -eq '0') { return }
        if ($choice -eq '1') { if (!(Run $Command)) { $script:code = 1 }; return }
        $number = 0
        if ([int]::TryParse($choice, [ref]$number) -and $number -ge 2 -and $number -le $names.Count + 1) {
            $previous = $script:Role
            try { $script:Role = $names[$number - 2]; if (!(Run $Command)) { $script:code = 1 } }
            finally { $script:Role = $previous }
            return
        }
        Write-Host (Paint $message.invalid error)
    }
}

function Run {
    param([string]$Command)
    if (($Command -eq 'install' -and (Ready)) -or ($Command -eq 'uninstall' -and !(Ready))) {
        $script:quiet = $true
        return $true
    }
    $log = Join-Path ([IO.Path]::GetTempPath()) ("oanismajor-" + [guid]::NewGuid() + '.log')
    $success = $false
    $script:quiet = $false
    if ($Command -ne 'stop') { Write-Host (Paint $line) }
    try {
        if ($Command -ne 'install' -and !(Ready)) { throw $message.missing }
        if ($Command -eq 'uninstall') {
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
            if (!(New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
                Write-Host (Paint $message.sudo)
                $child = Start-Process powershell.exe -Verb RunAs -Wait -PassThru `
                    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action uninstall"
                if ($child.ExitCode -ne 0) { throw $message.failed }
                $script:quiet = $true
                return $true
            }
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'host/setup.ps1') -Remove
            if ($LASTEXITCODE -ne 0) { throw $message.failed }
            $task = Get-ScheduledTask -TaskName "oanismajor $($config.distribution)" -ErrorAction SilentlyContinue
            if ($task) { Stop-ScheduledTask -InputObject $task }
        }
        if ($Command -in @('install', 'update')) {
            Install $Command $log
        } elseif ($Command -in @('status', 'stop') -and !(Running)) {
            if ($Command -eq 'status') {
                if (!(Get-Command node -ErrorAction SilentlyContinue) -or
                    !(Test-Path (Join-Path $directory 'node_modules/pg/package.json'))) {
                    Offline
                    throw $message.unavailable
                }
                $arguments = @((Join-Path $directory 'run.js'), 'status')
                if ($Role) { $arguments += $Role }
                if ($Instance) { $arguments += $Instance }
                & node @arguments
                if ($LASTEXITCODE -ne 0) { throw $message.failed }
            } else { $script:quiet = $true }
        } else {
            if ($Command -in @('start', 'restart')) {
                $task = Get-ScheduledTask -TaskName "oanismajor $($config.distribution)"
                Start-ScheduledTask -InputObject $task
            }
            $arguments = @('-d', $config.distribution, '-u', 'root', '--exec',
                '/usr/bin/env', "OANISMAJOR_LANG=$env:OANISMAJOR_LANG",
                "OANISMAJOR_COLOR=$([int](![Console]::IsOutputRedirected))",
                $config.node, "$($config.root)/run.js", $Command)
            if ($Role) { $arguments += $Role }
            if ($Instance) { $arguments += $Instance }
            if ($Command -in @('status', 'logs')) {
                & wsl.exe @arguments | ForEach-Object { [Console]::Write("`r$_`r`n") }
            } else {
                $ErrorActionPreference = 'Continue'
                $script:quiet = $Command -eq 'stop'
                & wsl.exe @arguments 2>&1 | ForEach-Object {
                    $script:quiet = $false
                    [IO.File]::AppendAllText($log, "$_`n", $utf8)
                    $tone = if ($_ -is [Management.Automation.ErrorRecord]) { 'error' } else { 'success' }
                    [Console]::Write("`r" + (Paint "$_" $tone) + "`r`n")
                }
                $ErrorActionPreference = 'Stop'
            }
            if ($LASTEXITCODE -ne 0) { throw $message.failed }
            if ($Command -eq 'uninstall') {
                $task = Get-ScheduledTask -TaskName "oanismajor $($config.distribution)" -ErrorAction SilentlyContinue
                if ($task) { Stop-ScheduledTask -InputObject $task; Unregister-ScheduledTask -InputObject $task -Confirm:$false }
            }
        }
        $success = $true
    } catch {
        $script:quiet = $false
        Write-Host (Paint "$($message.targets.$Command) $($message.failed)" error)
        if ($_.Exception.Message -ne $message.failed) { Write-Host (Paint $_.Exception.Message error) }
        [IO.File]::AppendAllText($log, "`n$($_.Exception.Message)`n", $utf8)
    }
    if ($success) {
        if ($Command -in @('start', 'stop', 'restart', 'update')) { $script:quiet = $true }
        if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log }
    } else { Write-Host (Paint "$($message.detail): $log") }
    return $success
}

function Settings {
    while ($true) {
        Write-Host (Paint $line)
        Write-Host (Paint $message.settings)
        Write-Host (Paint ("1. " + $message.language))
        Write-Host (Paint ("0. " + $message.back))
        switch (Read-Host $message.select) {
            '0' { return }
            '1' {
                Write-Host (Paint ("1. " + $message.auto))
                Write-Host (Paint '2. 한국어')
                Write-Host (Paint '3. English')
                Write-Host (Paint ("0. " + $message.back))
                $choice = Read-Host $message.select
                if ($null -eq $choice -or $choice -eq '0') { continue }
                $language = @{ '1' = 'auto'; '2' = 'ko'; '3' = 'en' }[$choice]
                if (!$language) { Write-Host (Paint $message.invalid error); continue }
                Read-Config
                $settings | Add-Member -NotePropertyName lang -NotePropertyValue $language -Force
                [IO.File]::WriteAllText($local, ($settings | ConvertTo-Json -Depth 20) + "`n", $utf8)
                Read-Config
                Write-Host (Paint $message.saved success)
            }
            default { Write-Host (Paint $message.invalid error) }
        }
    }
}

try {
    Read-Config
    if ($Action -eq 'control') {
        $script:quiet = $true
        if ($env:SSH_ORIGINAL_COMMAND -match '^handoff ([A-Za-z0-9+/=]{1,22000})$') {
            & wsl.exe -d $config.distribution -u root --exec `
                $config.node "$($config.root)/db/handoff.js" $Matches[1]
            exit $LASTEXITCODE
        }
        if ($env:SSH_ORIGINAL_COMMAND -notmatch '^(status|start|stop|restart)(?: (was|web|db))?$') {
            throw $message.invalid
        }
        $Action = $Matches[1]
        $Role = $Matches[2]
        if ($Action -ne 'status' -and !$Role) { throw $message.invalid }
        if (Run $Action) { exit 0 }
        exit 1
    }
    if (($Action -eq 'install' -and (Ready)) -or ($Action -eq 'uninstall' -and !(Ready))) { $script:quiet = $true; exit 0 }
    if ($Action -notin @('start', 'stop')) { Banner }
    if ($Action -ne 'cli') {
        if ($Action -in @('start', 'stop') -and !$Role) { Choose $Action }
        else { $code = if (Run $Action) { 0 } else { 1 } }
        exit $code
    }
    if (!(Ready)) {
        if (!(Run 'install')) { $code = 1; exit $code }
    }
    $commands = @('start', 'stop', 'restart', 'status', 'logs', 'update')
    while ($true) {
        Clear-Host
        Banner
        if (!(Run 'status')) {
            if ([Console]::IsInputRedirected) { break }
            $null = Read-Host
        }
        Write-Host (Paint $line)
        $available = @{ start = @(Available 'start').Count; stop = @(Available 'stop').Count }
        for ($index = 0; $index -lt $commands.Count; $index++) {
            if ($available.ContainsKey($commands[$index]) -and !$available[$commands[$index]]) { continue }
            $label = if ($commands[$index] -eq 'status') { $message.refresh } else { $message.($commands[$index]) }
            Write-Host (Paint ("$($index + 1). " + $label))
        }
        Write-Host (Paint ("7. " + $message.settings))
        Write-Host (Paint ("0. " + $message.exit))
        if ([Console]::IsInputRedirected) { break }
        $choice = Read-Host $message.select
        if ($null -eq $choice) { break }
        if ($choice -eq '0') { break }
        if ($choice -eq '7') { Settings; continue }
        if ($choice -eq '4') { continue }
        if ($choice -notin @('1', '2', '3', '4', '5', '6')) { Write-Host (Paint $message.invalid error); continue }
        $command = $commands[[int]$choice - 1]
        if ($available.ContainsKey($command) -and !$available[$command]) { continue }
        try {
            if ($command -in @('start', 'stop')) { Choose $command } else { $null = Run $command }
        } catch {
            $script:quiet = $false
            Write-Host (Paint $_.Exception.Message error)
        }
        if (!$script:quiet) { $null = Read-Host }
    }
} catch {
    $code = 1
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit $code
} finally {
    if (!$script:quiet -and ($Action -ne 'cli' -or $code -ne 0) -and ![Console]::IsInputRedirected) {
        $null = Read-Host
    }
}
