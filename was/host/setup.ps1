param([switch]$Remove, [switch]$Update)

$ErrorActionPreference = 'Stop'
$base = Split-Path $PSScriptRoot -Parent
$root = Split-Path $base -Parent
$folder = Join-Path $env:ProgramData 'oanismajor'
$service = Get-Service Oanismajor -ErrorAction SilentlyContinue
$stamp = Join-Path $folder 'host.sha256'
$hash = ((@('host.cs', 'host.ps1', 'host/setup.ps1') | ForEach-Object {
    (Get-FileHash (Join-Path $base $_) -Algorithm SHA256).Hash
}) -join ':')
if ($Update) {
    $local = Get-Content (Join-Path $root 'local.json') -Raw | ConvertFrom-Json
    if (!$local.cluster.handoff.enabled) { exit 0 }
    if ($service -and (Test-Path $stamp) -and [IO.File]::ReadAllText($stamp) -eq $hash) { exit 0 }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (!(New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Update"
        exit $child.ExitCode
    }
}
$control = 'HKLM:\SYSTEM\CurrentControlSet\Control'
$order = @((Get-ItemProperty $control -Name PreshutdownOrder -ErrorAction SilentlyContinue).PreshutdownOrder | Where-Object { $_ -and $_ -ne 'Oanismajor' })
if ($service) { Stop-Service Oanismajor }
if ($Remove) {
    if ($service) { & sc.exe delete Oanismajor | Out-Null }
    if ($order.Count) { Set-ItemProperty $control -Name PreshutdownOrder -Value $order }
    else { Remove-ItemProperty $control -Name PreshutdownOrder -ErrorAction SilentlyContinue }
    exit 0
}
$local = Get-Content (Join-Path $root 'local.json') -Raw | ConvertFrom-Json
if (!$local.cluster.handoff.enabled) { exit 0 }
& tailscale.exe set --unattended=true
if ($LASTEXITCODE -ne 0) { throw 'Tailscale unattended configuration failed' }
$null = [IO.Directory]::CreateDirectory($folder)
$file = Join-Path $folder 'host.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe `
    "/out:$file" (Join-Path $base 'host.cs')
if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$name = ($user -split '\\')[-1]
$command = "`"$file`" `"$root`" `"$name`""
if (!$service) {
    New-Service -Name Oanismajor -BinaryPathName $command -DisplayName Oanismajor `
        -StartupType Automatic -DependsOn @('WslService', 'sshd', 'Tailscale') | Out-Null
} else {
    & sc.exe config Oanismajor binPath= $command | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Host configuration failed' }
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Shutdown {
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool ChangeServiceConfig2(IntPtr service, uint level, ref uint value);
    [DllImport("advapi32.dll")] public static extern bool CloseServiceHandle(IntPtr handle);
    public static int Configure() {
        IntPtr manager=OpenSCManager(null,null,1);
        if(manager==IntPtr.Zero) return Marshal.GetLastWin32Error();
        IntPtr service=OpenService(manager,"Oanismajor",2);
        try {
            if(service==IntPtr.Zero) return Marshal.GetLastWin32Error();
            uint timeout=180000;
            return ChangeServiceConfig2(service,7,ref timeout) ? 0 : Marshal.GetLastWin32Error();
        } finally {
            if(service!=IntPtr.Zero) CloseServiceHandle(service);
            CloseServiceHandle(manager);
        }
    }
}
'@
$result = [Shutdown]::Configure()
if ($result -ne 0) { throw "Host shutdown configuration failed: $result" }
New-ItemProperty $control -Name PreshutdownOrder -PropertyType MultiString `
    -Value (@('Oanismajor') + $order) -Force | Out-Null
$config = Get-Content (Join-Path $root 'servers.json') -Raw | ConvertFrom-Json
foreach ($file in @('oanismajor', 'known_hosts')) {
    $source = Join-Path $env:USERPROFILE ".ssh/$file"
    if (!(Test-Path -LiteralPath $source)) { throw 'SSH control configuration required' }
    $linux = & wsl.exe -d $config.distribution -u root --exec wslpath -a $source
    if ($LASTEXITCODE -ne 0) { throw 'SSH path conversion failed' }
    & wsl.exe -d $config.distribution -u root --exec install -D -m 600 $linux "/root/.ssh/$file"
    if ($LASTEXITCODE -ne 0) { throw 'SSH control configuration failed' }
}
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$base\host.ps1`""
$options = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName "oanismajor $($config.distribution)" -Action $action `
    -Trigger @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn -User $user)) `
    -Settings $options -Principal $principal -Force | Out-Null
Start-Service Oanismajor
Stop-ScheduledTask -TaskName "oanismajor $($config.distribution)"
Start-ScheduledTask -TaskName "oanismajor $($config.distribution)"
[IO.File]::WriteAllText($stamp, $hash)
