param(
    [Parameter(Mandatory)]
    [string]$NodePath,

    [string]$LogPath = (Join-Path $PSScriptRoot '..\logs\codeforces-sync.jsonl')
)

$ErrorActionPreference = 'Stop'
$logFile = [System.IO.Path]::GetFullPath($LogPath)
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Write-LogLine([string]$Line) {
    [System.IO.File]::AppendAllText($logFile, $Line + [System.Environment]::NewLine, $utf8)
}

function Write-LauncherError([string]$Code) {
    $line = [ordered]@{
        event = 'codeforces.launcher.error'
        timestamp = [DateTime]::UtcNow.ToString('o')
        errorCode = $Code
    } | ConvertTo-Json -Compress

    try {
        Write-LogLine $line
    } catch {
        [Console]::Error.WriteLine($line)
    }
}

try {
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($logFile))
    $server = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $entry = Join-Path $server 'dist\scripts\sync-codeforces.js'
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or !(Test-Path -LiteralPath $entry -PathType Leaf)) {
        Write-LauncherError 'LAUNCH_CONFIGURATION_ERROR'
        exit 1
    }

    $node = (Resolve-Path -LiteralPath $NodePath).ProviderPath
    $lines = [System.Collections.Generic.List[string]]::new()
    Push-Location -LiteralPath $server
    try {
        & $node $entry 2>$null | ForEach-Object {
            # Accept the CLI's structured records and discard other runtime diagnostics.
            if ($_ -match '^\{"event":"codeforces\.sync\.(start|end)",') {
                Write-LogLine $_
                $lines.Add($Matches[1])
            }
        }
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if (!$lines.Contains('end')) {
        Write-LauncherError 'JOB_PROCESS_EXITED'
        exit 1
    }
    exit $code
} catch {
    Write-LauncherError 'LAUNCH_FAILED'
    exit 1
}
