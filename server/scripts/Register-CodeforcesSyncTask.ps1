[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$NodePath,

    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$TaskName = 'ContestHub-CodeforcesSync',

    [switch]$DefinitionOnly
)

$ErrorActionPreference = 'Stop'
$server = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $server 'dist\scripts\sync-codeforces.js'
if (!(Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw 'Build the ContestHub server before scheduling the sync.'
}

if (!$NodePath) {
    $NodePath = (Get-Command node.exe -CommandType Application).Source
}
$node = (Resolve-Path -LiteralPath $NodePath).ProviderPath
if ((& $node --version) -notmatch '^v24\.') {
    throw 'Use the Node.js 24 executable for this task.'
}

$launcher = Join-Path $PSScriptRoot 'Invoke-CodeforcesSync.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "{0}" -NodePath "{1}"' -f $launcher, $node
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $server
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 6)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal

if ($DefinitionOnly) {
    $task
    return
}

if ($PSCmdlet.ShouldProcess($TaskName, 'Register six-hour Codeforces sync')) {
    if (Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue) {
        throw "A scheduled task named $TaskName already exists."
    }
    Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -InputObject $task
}
