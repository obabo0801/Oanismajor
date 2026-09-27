$ErrorActionPreference = 'Stop'
trap {
    [IO.File]::AppendAllText((Join-Path $env:ProgramData 'oanismajor/host.log'), $_.Exception.Message + "`r`n" + $_.ScriptStackTrace + "`r`n")
    exit 1
}
$root = Split-Path $PSScriptRoot -Parent
$config = Get-Content (Join-Path $root 'servers.json') -Raw | ConvertFrom-Json
$local = Get-Content (Join-Path $root 'local.json') -Raw | ConvertFrom-Json
$directory = Join-Path $env:ProgramData 'oanismajor'
$shutdown = Join-Path $directory 'shutdown'
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
if ((Test-Path $shutdown) -and (Get-Item $shutdown).LastWriteTimeUtc -lt $boot) {
    Remove-Item -LiteralPath $shutdown
}
while (!(Get-NetIPAddress -IPAddress $local.cluster.address -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
    Start-Sleep -Seconds 1
}
$keepalive = Start-Process "$env:WINDIR\System32\wsl.exe" -WindowStyle Hidden -PassThru `
    -ArgumentList @('-d', $config.distribution, '-u', 'root', '--exec', '/bin/sleep', 'infinity')
try {
    while (!$keepalive.HasExited) {
        if ($local.cluster.handoff.enabled -and !(Test-Path $shutdown)) {
            try {
                & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
                    -File (Join-Path $PSScriptRoot 'handoff.ps1') -Action return 2>> (Join-Path $directory 'handoff.log')
            } catch {
                [IO.File]::AppendAllText((Join-Path $directory 'handoff.log'), $_.Exception.Message + "`r`n")
            }
        }
        Start-Sleep -Seconds 30
    }
} finally {
    if (!$keepalive.HasExited) { Stop-Process -Id $keepalive.Id }
}
