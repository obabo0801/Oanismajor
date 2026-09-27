param([switch]$Check, [switch]$Managed, [ValidateSet('ko', 'en')][string]$Language)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$directory = Split-Path $PSScriptRoot -Parent
$utf8 = [Text.UTF8Encoding]::new($false)
if (!$Language) {
    $Language = if ($env:OANISMAJOR_LANG -in @('ko', 'en')) { $env:OANISMAJOR_LANG }
        elseif ((Get-UICulture).Name -like 'ko*') { 'ko' } else { 'en' }
}
$message = Get-Content (Join-Path $PSScriptRoot "i18n/$Language.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$log = Join-Path ([IO.Path]::GetTempPath()) ("oanismajor-" + [guid]::NewGuid() + '.log')
function Text {
    param([string]$Value)
    $translation = $message.installation.PSObject.Properties[$Value]
    if ($translation) { $translation.Value } else { $Value }
}
$stage = Text 'Reading configuration'

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments, [switch]$Visible)
    if ($script:previous -ne $stage) {
        [Console]::Write("`r$stage`r`n")
        $script:previous = $stage
    }
    $preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments 2>&1 | ForEach-Object {
            [IO.File]::AppendAllText($log, "$_`n", $utf8)
            if ("$_" -match '^@oanismajor:(\w+)$') {
                [Console]::Write("`r$($message.progress.($Matches[1]))`r`n")
            } elseif ($Visible) { [Console]::Write("`r$_`r`n") }
        }
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preference }
    if ($result -ne 0) { throw "Command failed: $Command ($result)" }
}

function State {
    param([bool]$Value)
    if ($Value) { Text 'Present' } else { Text 'Missing' }
}

function Set-Ini {
    param([string]$File, [string]$Section, [string]$Key, [string]$Value)
    $text = if (Test-Path -LiteralPath $File) { [IO.File]::ReadAllText($File) } else { '' }
    $pattern = '(?ms)^\[' + [regex]::Escape($Section) + '\][^\r\n]*\r?\n(.*?)(?=^\[|\z)'
    $match = [regex]::Match($text, $pattern)
    if ($match.Success) {
        $body = $match.Groups[1].Value
        $entry = '(?m)^\s*' + [regex]::Escape($Key) + '\s*=.*$'
        if ([regex]::IsMatch($body, $entry)) {
            $body = [regex]::Replace($body, $entry, "$Key=$Value")
        } else { $body = $body.TrimEnd() + "`n$Key=$Value`n" }
        $text = $text.Remove($match.Index, $match.Length).Insert(
            $match.Index,
            "[$Section]`n$body"
        )
    } else {
        $text = $text.TrimEnd() + "`n[$Section]`n$Key=$Value`n"
    }
    if (!(Test-Path -LiteralPath $File) -or [IO.File]::ReadAllText($File) -ne $text) {
        if (Test-Path -LiteralPath $File) {
            Copy-Item -LiteralPath $File `
                -Destination "$File.backup-$(Get-Date -Format yyyyMMddHHmmssfff)"
        }
        [IO.File]::WriteAllText($File, $text, $utf8)
        return $true
    }
    return $false
}

try {
    Set-Location -LiteralPath $directory
    $config = Get-Content -LiteralPath 'servers.json' -Raw | ConvertFrom-Json
    $local = Join-Path $directory 'local.json'
    $settings = if (Test-Path -LiteralPath $local) {
        Get-Content -LiteralPath $local -Raw | ConvertFrom-Json
    } else { $null }
    $distribution = if ($settings.distribution) {
        $settings.distribution
    } else {
        $config.distribution
    }

    if ($distribution -notmatch '^[\w.-]+$') {
        throw (Text 'Check the Ubuntu distribution name.')
    }

    if ($Check) {
        Write-Host "Project: $directory"
        Write-Host "Distribution: $distribution"
        Write-Host "Server config: $(State (Test-Path -LiteralPath $local))"
        Write-Host "Environment: $(State (Test-Path -LiteralPath '.env'))"
        Write-Host "Build files: $(State (Test-Path -LiteralPath 'web/dist'))"
        Write-Host "WSL: $(State ([bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)))"
        Write-Host "Tailscale: $(State (Test-Path -LiteralPath "$env:ProgramFiles\Tailscale\tailscale.exe"))"
        Write-Host (Text 'Check complete. No settings were changed.')
        exit 0
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $stage = Text 'Requesting administrator permission'

    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host (Text 'Administrator permission is required.')
        $command =
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Language $Language"
        if ($Managed) { $command += ' -Managed' }
        $child = Start-Process $env:ComSpec -Verb RunAs -Wait -PassThru `
            -ArgumentList "/d /c $command"

        exit $child.ExitCode
    }

    if (!$Managed) {
        Write-Host (Text 'Existing data and .env will be preserved.')
    }

    $stage = Text 'Checking WSL'
    if (!(Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw (Text 'Install WSL and run start.bat again.')
    }

    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command wsl.exe).Source
    $start.Arguments = '--list --quiet'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.Encoding]::Unicode
    $start.StandardErrorEncoding = [Text.Encoding]::Unicode
    $process = [Diagnostics.Process]::Start($start)

    try {
        $output = $process.StandardOutput.ReadToEndAsync()
        $failure = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $distributions = @(
            $output.GetAwaiter().GetResult() -split '\r?\n' |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ }
        )
        $null = $failure.GetAwaiter().GetResult()
        $missing = $process.ExitCode -ne 0 -or $distributions -notcontains $distribution
    } finally {
        $process.Dispose()
    }

    if ($missing) {
        $stage = Text 'Installing WSL'
        Write-Host (Text 'Installing WSL and Ubuntu...')
        & wsl.exe --install -d $distribution --no-launch

        if ($LASTEXITCODE -notin @(0, 3010)) {
            throw (Text 'WSL installation failed. Run as administrator: wsl --install -d Ubuntu')
        }

        Write-Host (Text 'Restart Windows and run start.bat again.')
        if (!$Managed) { $null = Read-Host (Text 'Press Enter to close') }
        exit 0
    }

    $stage = Text 'Connecting Tailscale'
    $tailscale = "$env:ProgramFiles\Tailscale\tailscale.exe"

    if (!(Test-Path -LiteralPath $tailscale)) {
        Invoke-Native winget.exe @(
            'install',
            '--id',
            'Tailscale.Tailscale',
            '-e',
            '--accept-package-agreements',
            '--accept-source-agreements'
        )
    }

    $address = & $tailscale ip -4 2>$null

    if ($LASTEXITCODE -ne 0 -or !$address) {
        Write-Host (Text 'Sign in with the same Tailscale account as the primary server.')
        Invoke-Native $tailscale @('up') -Visible
        $address = & $tailscale ip -4
    }

    $address = "$address".Trim()

    if ($address -notmatch '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$') {
        throw (Text 'Could not determine the Tailscale IP.')
    }

    $stage = Text 'Saving server configuration'

    if ($settings.cluster) {
        if ($settings.cluster.address -ne $address) {
            throw (Text 'This local.json belongs to another PC. Move it separately and run again.')
        }

        if (!$Managed) { Write-Host (Text 'Using existing configuration.') }
    } else {
        Write-Host (Text '1. New server')
        Write-Host (Text '2. Connect to server')
        $choice = Read-Host (Text 'Select a number (1-2)')
        if ($choice -notin @('1', '2')) {
            throw (Text 'Select a number from 1 to 2.')
        }

        $primary = if ($choice -eq '1') {
            $address
        } else {
            (Read-Host (Text 'Primary server Tailscale IP')).Trim()
        }

        if ($primary -notmatch '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$') {
            throw (Text 'Enter a Tailscale IPv4 address.')
        }

        if ($choice -ne '1' -and $primary -eq $address) {
            throw (Text 'The primary server and current PC have the same IP.')
        }

        $preference = if ($settings.lang) { $settings.lang } else { 'auto' }
        $settings = [ordered]@{
            lang = $preference
            was = @()
            web = @()
            db = @()
            https = $null
            cluster = @{
                address = $address
                network = '100.64.0.0/10'
                storage = "${primary}:/srv/oanismajor/storage"
            }
        }

        $settings.was = @(3001)
        $settings.web = @(8081)
        $settings.db = @(
            @{
                name = $(if ($choice -eq '1') { 'main' } else { 'replica' })
                version = 18
                port = 5432
                role = $(if ($choice -eq '1') { 'primary' } else { 'replica' })
            }
        )

        if ($choice -eq '1') {
            $hostname = (Read-Host (Text 'HTTPS domain or public IP')).Trim()
            $email = (Read-Host (Text 'Certificate email')).Trim()

            if (
                $hostname -notmatch '^[a-zA-Z0-9.-]+$' -or
                $email -notmatch '^[a-zA-Z0-9.+_-]+@[a-zA-Z0-9.-]+$'
            ) {
                throw (Text 'Check the HTTPS address and email.')
            }

            $settings.https = $true
            $environment = Join-Path $directory '.env'
            $content = if (Test-Path -LiteralPath $environment) {
                [IO.File]::ReadAllText($environment)
            } else {
                ''
            }

            foreach ($entry in @(
                @('HTTPS_HOST', $hostname),
                @('HTTPS_EMAIL', $email)
            )) {
                $pattern = '(?m)^(?:export\s+)?' + $entry[0] + '\s*=.*$'
                $line = $entry[0] + '=' + $entry[1]

                if ([regex]::IsMatch($content, $pattern)) {
                    $content = [regex]::Replace($content, $pattern, $line)
                } else {
                    $content += "`n$line`n"
                }
            }

            [IO.File]::WriteAllText($environment, $content, $utf8)
        } else {
            if (!(Test-Path -LiteralPath '.env')) {
                $environment = (
                    Read-Host (Text 'Path to .env copied from the primary server')
                ).Trim('"')

                Copy-Item -LiteralPath $environment `
                    -Destination (Join-Path $directory '.env')
            }

        }

        [IO.File]::WriteAllText(
            $local,
            ($settings | ConvertTo-Json -Depth 8),
            $utf8
        )
    }

    $stage = Text 'Configuring WSL network'
    $changed = Set-Ini `
        "$env:USERPROFILE\.wslconfig" `
        'wsl2' `
        'networkingMode' `
        'mirrored'

    $changed = (
        Set-Ini `
            "$env:USERPROFILE\.wslconfig" `
            'experimental' `
            'hostAddressLoopback' `
            'true'
    ) -or $changed

    $linux = @'
import configparser, pathlib, shutil, time
p = pathlib.Path('/etc/wsl.conf')
c = configparser.ConfigParser()
c.read(p)
changed = False
for section, key, value in [('boot', 'systemd', 'true'), ('user', 'default', 'root')]:
    if c.get(section, key, fallback='') != value:
        if not c.has_section(section): c.add_section(section)
        c.set(section, key, value)
        changed = True
if changed:
    if p.exists(): shutil.copy2(p, str(p) + '.backup-' + str(time.time_ns()))
    with p.open('w') as f: c.write(f)
print('changed' if changed else 'unchanged')
'@

    $stage = Text 'Initializing Ubuntu'
    $encoded = [Convert]::ToBase64String($utf8.GetBytes($linux))
    $result = & wsl.exe -d $distribution -u root --exec python3 -c `
        "import base64;exec(base64.b64decode('$encoded'))"

    if ($LASTEXITCODE -ne 0) {
        throw (Text 'Finish Ubuntu initialization and run again.')
    }

    if ($changed -or $result -eq 'changed') {
        $stage = Text 'Preparing WSL restart'
        Write-Host (Text 'Applying network settings... WSL will stop briefly.')
        Invoke-Native wsl.exe @('--shutdown')
    }

    $stage = Text 'Registering startup task'
    $command =
        "while (!(Get-NetIPAddress " +
        "-IPAddress '$address' " +
        "-AddressFamily IPv4 " +
        "-ErrorAction SilentlyContinue)) { " +
        "Start-Sleep -Seconds 1 }; " +
        "& '$env:WINDIR\System32\wsl.exe' -d '$distribution' " +
        '-u root --exec /bin/sleep infinity'

    $action = New-ScheduledTaskAction `
        -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$command`""

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name

    $options = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    Register-ScheduledTask `
        -TaskName "oanismajor $distribution" `
        -Action $action `
        -Trigger $trigger `
        -Settings $options `
        -User $identity.Name `
        -RunLevel Highest `
        -Force |
        Out-Null

    $legacy = Get-ScheduledTask -TaskName "Jjing $distribution" -ErrorAction SilentlyContinue
    if ($legacy) {
        Stop-ScheduledTask -InputObject $legacy
        Unregister-ScheduledTask -InputObject $legacy -Confirm:$false
    }

    $stage = Text 'Starting startup task'
    if ($settings.cluster.handoff.enabled) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'host/setup.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Host configuration failed' }
    }
    Start-ScheduledTask -TaskName "oanismajor $distribution"

    $stage = Text 'Configuring Windows firewall'
    $effective = @{}

    foreach ($property in $config.PSObject.Properties) {
        $effective[$property.Name] = $property.Value
    }

    $settings = Get-Content -LiteralPath $local -Raw | ConvertFrom-Json

    foreach ($property in $settings.PSObject.Properties) {
        $effective[$property.Name] = $property.Value
    }

    $ports =
        @($effective.was) +
        @($effective.web) +
        @($effective.db | ForEach-Object { $_.port })

    if (
        ($effective.cluster.storage -eq
            "${address}:$($effective.root)/storage" -or $effective.cluster.handoff) -and
        $effective.was.Count
    ) {
        $ports += 2049
    }

    $rule = @{
        Name = 'oanismajorCluster'
        Direction = 'Inbound'
        Action = 'Allow'
        Protocol = 'TCP'
        LocalPort = $ports
        LocalAddress = $address
        RemoteAddress = '100.64.0.0/10'
    }

    if (Get-NetFirewallRule -Name oanismajorCluster -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule @rule
    } else {
        New-NetFirewallRule @rule -DisplayName 'oanismajor Cluster' | Out-Null
    }

    $stage = Text 'Configuring WSL firewall'

    if (!(Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue)) {
        throw (Text 'Update Windows 11 and WSL.')
    }

    $hyper = @{
        Name = 'oanismajorClusterWSL'
        Direction = 'Inbound'
        Action = 'Allow'
        Protocol = 'TCP'
        LocalPorts = $ports
        LocalAddresses = $address
        RemoteAddresses = '100.64.0.0/10'
    }

    if (
        Get-NetFirewallHyperVRule `
            -Name oanismajorClusterWSL `
            -ErrorAction SilentlyContinue
    ) {
        Set-NetFirewallHyperVRule @hyper
    } else {
        New-NetFirewallHyperVRule `
            @hyper `
            -DisplayName 'oanismajor Cluster WSL' `
            -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' |
            Out-Null
    }

    if ($effective.https) {
        $stage = Text 'Configuring HTTPS firewall'

        if (
            !(Get-NetFirewallRule `
                -Name oanismajorHTTPS `
                -ErrorAction SilentlyContinue)
        ) {
            New-NetFirewallRule `
                -Name oanismajorHTTPS `
                -DisplayName 'oanismajor HTTPS' `
                -Direction Inbound `
                -Action Allow `
                -Protocol TCP `
                -LocalPort 80,443 |
                Out-Null
        }

        if (
            !(Get-NetFirewallHyperVRule `
                -Name oanismajorHTTPSWSL `
                -ErrorAction SilentlyContinue)
        ) {
            New-NetFirewallHyperVRule `
                -Name oanismajorHTTPSWSL `
                -DisplayName 'oanismajor HTTPS WSL' `
                -Direction Inbound `
                -Action Allow `
                -Protocol TCP `
                -LocalPorts 80,443 `
                -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' |
                Out-Null
        }
    }

    $stage = Text 'Checking project path'
    $source = & wsl.exe -d $distribution -u root --exec wslpath -a $directory

    if ($LASTEXITCODE -ne 0) {
        throw (Text 'Could not resolve the project path.')
    }

    $source = $source.Trim()
    $loader =
        "import os,sys; " +
        "script=open(sys.argv[1],encoding='utf-8-sig').read(); " +
        "os.execv('/bin/bash',['bash','-c',script,'install',sys.argv[2]])"

    $stage = Text 'Installing Ubuntu server'

    Invoke-Native wsl.exe @(
        '-d',
        $distribution,
        '-u',
        'root',
        '--exec',
        'python3',
        '-c',
        $loader,
        "$source/was/install.sh",
        $source
    )

    if (!$Managed) { Write-Host $message.done }
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log }
    if (!$Managed) { $null = Read-Host (Text 'Press Enter to close') }
} catch {
    Write-Host "$($message.failed): $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $stage
    Write-Host "install.ps1:$($_.InvocationInfo.ScriptLineNumber)"
    if (Test-Path -LiteralPath $log) { Write-Host "$($message.detail): $log" }

    if (!$Check) {
        if (!$Managed) { $null = Read-Host (Text 'Press Enter to close') }
    }

    exit 1
}
