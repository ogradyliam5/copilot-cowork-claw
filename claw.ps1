#Requires -Version 7.2
<#
.SYNOPSIS
    Claw PC - lets Microsoft 365 Copilot Cowork run commands, PowerShell, files and long jobs on
    this Windows PC through a private Microsoft dev tunnel.

.DESCRIPTION
    First run:  installs anything missing (Node.js LTS, Caddy and the dev tunnel CLI), builds the
                Claw server, creates your secret keys and private dev tunnel, tests everything
                over the internet and builds your Cowork plugin (claw-pc-plugin-READY.zip).
    Later runs: starts everything in a few seconds.

    Keep the window open while you use Claw PC in Cowork. Press Ctrl+C or close the window to
    stop. While it is stopped, Cowork cannot reach this PC.

    Run it from a normal window, not "Run as administrator". The easiest way is to double-click
    Start-Claw.cmd, which also installs PowerShell 7 if you need it.

.PARAMETER Rotate
    Make a new secret URL. The old one stops working straight away. Upload the new plugin.

.PARAMETER Plugin
    Build the plugin file again, for example if you deleted it before uploading it.

.PARAMETER Stop
    Stop a Claw PC that was left running, then exit.

.PARAMETER Uninstall
    Stop Claw PC and delete its dev tunnel, keys, logs and server build. Your workspace folder
    and the apps it installed are left alone.

.PARAMETER SelfTest
    Build, start and test everything on this PC without opening the tunnel, then exit.
    Nothing is exposed to the internet. CI runs this on every change.
#>
[CmdletBinding()]
param(
    [switch]$Rotate,
    [switch]$Plugin,
    [switch]$Stop,
    [switch]$Uninstall,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Settings ------------------------------------------------------------------------------------

$RepoRoot    = $PSScriptRoot
$ServerSrc   = Join-Path $RepoRoot 'server'
$PluginSrc   = Join-Path $RepoRoot 'plugin'
$StateDir    = Join-Path $env:LOCALAPPDATA 'claw-pc'
$ServerDir   = Join-Path $StateDir 'server'
$StateFile   = Join-Path $StateDir 'state.json'
$PidFile     = Join-Path $StateDir 'running.json'
$Caddyfile   = Join-Path $StateDir 'Caddyfile'
$LogDir      = Join-Path $StateDir 'logs'
$JobDir      = Join-Path $StateDir 'jobs'
$Workspace   = Join-Path $env:USERPROFILE 'claw-workspace'
$Downloads   = Join-Path $env:USERPROFILE 'Downloads'
$ReadyZip    = Join-Path $(if (Test-Path -LiteralPath $Downloads) { $Downloads } else { $RepoRoot }) 'claw-pc-plugin-READY.zip'
$ServerPort  = 38787   # Claw server, localhost only
$ProxyPort   = 38788   # Caddy, localhost only - the dev tunnel forwards to this port
$CallTimeout = 25      # seconds per command; Cowork expects every tool call to finish within 30
$Friendly    = @{ server = 'Claw server'; caddy = 'local proxy'; tunnel = 'dev tunnel' }

$script:State   = @{}
$script:Running = [ordered]@{}

# --- Small helpers -------------------------------------------------------------------------------

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Good([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    $Text" -ForegroundColor DarkGray }
function Quote([string]$Text) { '"' + $Text + '"' }
function Get-AppPath([string]$Name) { (Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }

function New-Secret([int]$Bytes) {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

function Get-TextHash([string]$Text) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text)))
}

function Get-FolderHash([string]$Path) {
    $lines = Get-ChildItem -LiteralPath $Path -Recurse -File -Force |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|dist)[\\/]' } |
        Sort-Object FullName |
        ForEach-Object { [IO.Path]::GetRelativePath($Path, $_.FullName) + '=' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    Get-TextHash (@($lines) -join "`n")
}

function Update-SessionPath {
    # Pick up folders that installers added to PATH after this window was opened.
    $current = @($env:Path -split ';' | Where-Object { $_ })
    $saved = @(@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';' -split ';' |
        Where-Object { $_ -and ($current -notcontains $_) })
    if ($saved.Count -gt 0) { $env:Path = (@($current) + $saved) -join ';' }
}

function Install-App([string]$Command, [string]$WingetId, [string]$Name) {
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$Name isn't installed and winget isn't available to install it. Install 'App Installer' from the Microsoft Store, then run Start-Claw.cmd again."
    }
    Write-Step "Installing $Name (approve any Windows prompt)..."
    & winget install --id $WingetId --exact --source winget --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
    $code = $LASTEXITCODE
    Update-SessionPath
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$Name still isn't available (winget exit code $code). Close this window, open a new one and run Start-Claw.cmd again."
    }
}

function Read-State {
    if (Test-Path -LiteralPath $StateFile) {
        try { return (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json -AsHashtable) } catch { }
    }
    return @{}
}

function Save-State {
    $script:State | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding utf8NoBOM
}

# --- Processes -----------------------------------------------------------------------------------

function Save-Running {
    $list = foreach ($p in $script:Running.Values) {
        try { [ordered]@{ id = $p.Id; start = $p.StartTime.ToUniversalTime().Ticks } } catch { }
    }
    ConvertTo-Json -InputObject @($list) | Set-Content -LiteralPath $PidFile -Encoding utf8NoBOM
}

function Stop-Stale {
    # Stop processes left behind by an earlier run that didn't shut down cleanly.
    if (-not (Test-Path -LiteralPath $PidFile)) { return 0 }
    $count = 0
    $entries = @()
    try { $entries = @(Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json) } catch { }
    foreach ($e in $entries) {
        try {
            $p = Get-Process -Id ([int]$e.id) -ErrorAction Stop
            if ($p.StartTime.ToUniversalTime().Ticks -eq [long]$e.start) {
                Stop-Process -Id $p.Id -Force -ErrorAction Stop
                $count++
            }
        } catch { }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return $count
}

function Start-Background([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    $p = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir "$Name.out.log") `
        -RedirectStandardError (Join-Path $LogDir "$Name.err.log")
    $script:Running[$Name] = $p
    Save-Running
    return $p
}

function Stop-Running {
    if ($script:Running.Count -eq 0) { return }
    foreach ($p in $script:Running.Values) {
        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    $script:Running.Clear()
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Claw PC stopped.' -ForegroundColor DarkGray
}

function Wait-Running {
    while ($true) {
        foreach ($name in @($script:Running.Keys)) {
            if ($script:Running[$name].HasExited) {
                throw "The $($Friendly[$name]) stopped (for example after sleep or a network change). Run Start-Claw.cmd again. Logs: $LogDir"
            }
        }
        Start-Sleep -Seconds 2
    }
}

function Show-Logs {
    Get-ChildItem -LiteralPath $LogDir -Filter '*.log' -File -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ''
        Write-Host "----- $($_.Name) (last 60 lines) -----" -ForegroundColor DarkGray
        Get-Content -LiteralPath $_.FullName -Tail 60 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
}

# --- HTTP and test helpers -----------------------------------------------------------------------

function Get-HttpStatus([string]$Uri) {
    try {
        $r = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec 10 -SkipHttpErrorCheck -UserAgent 'claw-pc-check' `
            -Headers @{ 'X-Tunnel-Skip-AntiPhishing-Page' = 'true' }
        return [int]$r.StatusCode
    } catch { return 0 }
}

function Wait-HttpOk([string]$Uri, [int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ((Get-HttpStatus $Uri) -eq 200) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Invoke-ServerScript([string]$Script, [string]$Url, [string]$LogName, [switch]$Show) {
    $saved = $env:CLAW_URL
    $env:CLAW_URL = $Url
    try {
        $node = (Get-AppPath 'node')
        $file = Join-Path $ServerDir "scripts\$Script"
        $log = Join-Path $LogDir "$LogName.log"
        if ($Show) {
            & $node $file 2>&1 | Tee-Object -FilePath $log | Out-Host
        } else {
            & $node $file *> $log
        }
        return ($LASTEXITCODE -eq 0)
    } finally {
        $env:CLAW_URL = $saved
    }
}

function Test-IPv6Loopback {
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Loopback, 0)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch { return $false }
}

function Assert-PortFree([int]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $owner = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        throw "Port $Port is already in use (by '$owner'). If that's an old Claw PC, run: Start-Claw.cmd -Stop"
    }
}

function Read-SharedText([string]$Path) {
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        try { return [IO.StreamReader]::new($fs).ReadToEnd() } finally { $fs.Dispose() }
    } catch { return '' }
}

# --- Server and proxy ----------------------------------------------------------------------------

function Sync-Server {
    # Copy the server out of this folder (so node_modules never lands in a synced folder) and
    # build it - only on the first run or when the server files have changed.
    $hash = Get-FolderHash $ServerSrc
    if ($script:State.serverHash -eq $hash -and (Test-Path -LiteralPath (Join-Path $ServerDir 'dist\main.js'))) { return }
    Write-Step 'Building the Claw server (first run or after an update - about a minute)...'
    if (Test-Path -LiteralPath $ServerDir) { Remove-Item -LiteralPath $ServerDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $ServerDir | Out-Null
    Get-ChildItem -LiteralPath $ServerSrc -Force |
        Where-Object { $_.Name -notin @('node_modules', 'dist') } |
        Copy-Item -Destination $ServerDir -Recurse -Force
    Push-Location -LiteralPath $ServerDir
    try {
        & npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Installing the server packages failed (npm ci) - see the messages above.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Building the server failed (npm run build) - see the messages above.' }
    } finally { Pop-Location }
    $script:State.serverHash = $hash
    Save-State
}

function Write-Caddyfile {
    $bind = if (Test-IPv6Loopback) { '127.0.0.1 [::1]' } else { '127.0.0.1' }
    $content = @"
{
    admin off
    auto_https off
    persist_config off
}

:$ProxyPort {
    bind $bind

    # The only way in is the secret path. Caddy adds the server's API key itself.
    handle_path /cowork-$($script:State.secret)/* {
        reverse_proxy 127.0.0.1:$ServerPort {
            header_up x-api-key "$($script:State.apiKey)"
        }
    }

    # Everything else gets a plain 404.
    handle {
        respond 404
    }
}
"@
    Set-Content -LiteralPath $Caddyfile -Value $content -Encoding utf8NoBOM
    $validateLog = Join-Path $LogDir 'caddy-validate.log'
    & (Get-AppPath 'caddy') validate --config $Caddyfile --adapter caddyfile *> $validateLog
    if ($LASTEXITCODE -ne 0) { throw "The local proxy settings were rejected. Details: $validateLog" }
}

function Start-ClawServer {
    # These settings go to the server only. The server removes the key and port settings from
    # its own environment at start-up, so the commands it runs never see them.
    $vars = [ordered]@{
        HOST                    = '127.0.0.1'
        PORT                    = "$ServerPort"
        API_KEY                 = $script:State.apiKey
        API_KEY_HEADER          = 'x-api-key'
        LOG_DIRECTORY           = $LogDir
        JOB_DIRECTORY           = $JobDir
        POWERSHELL_PATH         = (Get-Process -Id $PID).Path
        DEFAULT_TIMEOUT_SECONDS = "$CallTimeout"
        MAX_TIMEOUT_SECONDS     = "$CallTimeout"
    }
    $saved = @{}
    foreach ($k in $vars.Keys) {
        $saved[$k] = [Environment]::GetEnvironmentVariable($k)
        [Environment]::SetEnvironmentVariable($k, $vars[$k])
    }
    try {
        $main = Join-Path $ServerDir 'dist\main.js'
        Start-Background -Name 'server' -FilePath (Get-AppPath 'node') -Arguments @(Quote $main) -WorkingDirectory $Workspace | Out-Null
    } finally {
        foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    }
}

# --- Cowork plugin -------------------------------------------------------------------------------

function New-PawIcon([string]$Path, [int]$Size, [switch]$Transparent) {
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        if ($Transparent) { $g.Clear([System.Drawing.Color]::Transparent) } else { $g.Clear([System.Drawing.Color]::FromArgb(255, 110, 86, 207)) }
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        # Paw: centre x, centre y, radius x, radius y - as fractions of the icon size.
        foreach ($e in @(@(0.50, 0.64, 0.200, 0.160), @(0.27, 0.42, 0.075, 0.095), @(0.41, 0.29, 0.075, 0.095),
                         @(0.59, 0.29, 0.075, 0.095), @(0.73, 0.42, 0.075, 0.095))) {
            $g.FillEllipse($brush, [single](($e[0] - $e[2]) * $Size), [single](($e[1] - $e[3]) * $Size),
                [single](2 * $e[2] * $Size), [single](2 * $e[3] * $Size))
        }
        $brush.Dispose()
    } finally { $g.Dispose() }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

function Build-PluginZip([string]$Url, [string]$OutFile) {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('claw-pc-plugin-' + (New-Secret 4))
    try {
        Copy-Item -LiteralPath $PluginSrc -Destination $tmp -Recurse
        New-PawIcon -Path (Join-Path $tmp 'color.png') -Size 192
        New-PawIcon -Path (Join-Path $tmp 'outline.png') -Size 32 -Transparent
        $manifestPath = Join-Path $tmp 'manifest.json'
        $m = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $m.id = $script:State.appId
        $m.packageName = 'com.cowork.plugin.claw-pc-' + $script:State.appId.Substring(0, 8)
        $m.version = '1.0.' + [int]$script:State.pluginBuild
        $m.agentConnectors[0].toolSource.remoteMcpServer.mcpServerUrl = $Url
        $m | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
        if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($tmp, $OutFile)
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-PluginZip([string]$Path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.Drawing
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName })
        foreach ($need in @('manifest.json', 'color.png', 'outline.png', 'skills/claw-pc/SKILL.md')) {
            if ($names -notcontains $need) { throw "The plugin zip is missing $need (it has: $($names -join ', '))." }
        }
        $reader = [IO.StreamReader]::new($zip.GetEntry('manifest.json').Open())
        try { $m = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($m.id -ne $script:State.appId) { throw 'The plugin ID was not filled in.' }
        if ($m.agentConnectors[0].toolSource.remoteMcpServer.mcpServerUrl -notlike 'https://*/mcp') { throw 'The plugin URL was not filled in.' }
        foreach ($icon in @(@('color.png', 192), @('outline.png', 32))) {
            $ms = [IO.MemoryStream]::new()
            $s = $zip.GetEntry($icon[0]).Open()
            try { $s.CopyTo($ms) } finally { $s.Dispose() }
            $ms.Position = 0
            $img = [System.Drawing.Image]::FromStream($ms)
            try { $size = "$($img.Width)x$($img.Height)" } finally { $img.Dispose(); $ms.Dispose() }
            if ($size -ne "$($icon[1])x$($icon[1])") { throw "$($icon[0]) is $size pixels, expected $($icon[1])x$($icon[1])." }
        }
    } finally { $zip.Dispose() }
}

function Show-UploadSteps {
    Write-Host ''
    Write-Host '  -------------------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host '   NEXT STEP: upload your plugin to Cowork (only needed now, not every time)' -ForegroundColor Yellow
    Write-Host "   File: $ReadyZip" -ForegroundColor Yellow
    Write-Host '   In Cowork: Customize > Plugins > Upload plugin > choose the file > Only you' -ForegroundColor Yellow
    Write-Host '   > Apply. Then delete the file - it contains your secret URL.' -ForegroundColor Yellow
    Write-Host '   Uploaded one before? If Cowork says it already exists, remove the old' -ForegroundColor Yellow
    Write-Host '   Claw PC plugin first (Customize > Plugins > Claw PC > Remove).' -ForegroundColor Yellow
    Write-Host '  -------------------------------------------------------------------------' -ForegroundColor Yellow
    try { Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$ReadyZip`"" } catch { }
}

# --- Dev tunnel ----------------------------------------------------------------------------------

function Initialize-Tunnel {
    # Returns the tunnel's public base URL (or $null if it can only be read once hosting starts).
    $who = & devtunnel user show 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $who -match '(?i)not logged in') {
        Write-Step 'Sign in to Microsoft dev tunnels (a browser window will open)...'
        & devtunnel user login | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Dev tunnel sign-in failed. To sign in with GitHub instead, run: devtunnel user login -g' }
    }
    $id = $script:State.tunnelId
    $show = & devtunnel show $id 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Step 'Creating your private dev tunnel...'
        $created = & devtunnel create $id --allow-anonymous 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "Couldn't create the dev tunnel: $($created.Trim()) - your organisation may block dev tunnels or anonymous access (see docs\troubleshooting.md)."
        }
        $show = ''
    }
    if ($show -notmatch "\b$ProxyPort\b") {
        $portOut = & devtunnel port create $id -p $ProxyPort --protocol http 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -and $portOut -notmatch '(?i)already|exists|conflict') {
            throw "Couldn't add the port to the dev tunnel: $($portOut.Trim())"
        }
        $show = & devtunnel show $id 2>&1 | Out-String
    }
    $m = [regex]::Match($show, "https://[A-Za-z0-9-]+-$ProxyPort\.[A-Za-z0-9.-]*devtunnels\.ms")
    if ($m.Success) { return $m.Value }
    $m = [regex]::Match($show, '(?im)Tunnel ID\s*:\s*([a-z0-9-]+)\.([a-z0-9]+)\s*$')
    if ($m.Success) { return "https://$($m.Groups[1].Value)-$ProxyPort.$($m.Groups[2].Value).devtunnels.ms" }
    return $null
}

function Find-TunnelUrlInLog {
    $log = Join-Path $LogDir 'tunnel.out.log'
    for ($i = 0; $i -lt 60; $i++) {
        $m = [regex]::Match((Read-SharedText $log), "https://[A-Za-z0-9-]+-$ProxyPort\.[A-Za-z0-9.-]*devtunnels\.ms")
        if ($m.Success) { return $m.Value }
        if ($script:Running['tunnel'].HasExited) { break }
        Start-Sleep -Seconds 1
    }
    return $null
}

# --- Modes ---------------------------------------------------------------------------------------

function Invoke-SelfTest([string]$LocalBase) {
    Write-Step 'Checking every tool through the local proxy...'
    if (-not (Invoke-ServerScript -Script 'selftest.mjs' -Url "$LocalBase/mcp" -LogName 'selftest' -Show)) {
        throw 'The tool checks failed (see above).'
    }
    Write-Step 'Building a test plugin...'
    $zip = Join-Path ([IO.Path]::GetTempPath()) ('claw-pc-selftest-' + (New-Secret 4) + '.zip')
    try {
        Build-PluginZip -Url 'https://selftest.invalid/cowork-selftest/mcp' -OutFile $zip
        Test-PluginZip $zip
        Write-Good 'The plugin builds correctly.'
    } finally {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    }
    Write-Host ''
    Write-Host 'SELF-TEST PASSED' -ForegroundColor Green
}

function Start-Claw {
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and -not $SelfTest) {
        throw 'Please run Start-Claw.cmd normally, not "Run as administrator", so Cowork only gets your normal user rights.'
    }

    Update-SessionPath
    $stale = Stop-Stale
    if ($stale -gt 0) { Write-Note "Stopped $stale process(es) left over from an earlier run." }
    Assert-PortFree $ServerPort
    Assert-PortFree $ProxyPort

    Install-App 'node' 'OpenJS.NodeJS.LTS' 'Node.js'
    Install-App 'caddy' 'CaddyServer.Caddy' 'Caddy'
    if (-not $SelfTest) { Install-App 'devtunnel' 'Microsoft.devtunnel' 'the dev tunnel CLI' }
    $nodeVersion = (& node --version | Out-String).Trim()
    if ([int](($nodeVersion -replace '^v', '').Split('.')[0]) -lt 20) {
        throw "Claw PC needs Node.js 20 or later (found $nodeVersion). Run: winget upgrade OpenJS.NodeJS.LTS"
    }

    New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
    $script:State = Read-State
    if (-not $script:State.apiKey) { $script:State.apiKey = New-Secret 32 }
    if ($Rotate -or -not $script:State.secret) { $script:State.secret = New-Secret 24 }
    if (-not $script:State.tunnelId) { $script:State.tunnelId = 'claw-' + (New-Secret 6) }
    if (-not $script:State.appId) { $script:State.appId = [guid]::NewGuid().ToString() }
    Save-State
    if ($Rotate) { Write-Good 'Made a new secret URL. The old one no longer works.' }

    Sync-Server
    Write-Caddyfile

    Write-Step 'Starting the Claw server...'
    Start-ClawServer
    if (-not (Wait-HttpOk "http://127.0.0.1:$ServerPort/health" 30)) {
        throw "The Claw server didn't start. Details: $(Join-Path $LogDir 'server.err.log')"
    }

    Write-Step 'Starting the local proxy...'
    Start-Background -Name 'caddy' -FilePath (Get-AppPath 'caddy') `
        -Arguments @('run', '--config', (Quote $Caddyfile), '--adapter', 'caddyfile') -WorkingDirectory $StateDir | Out-Null
    $local = "http://127.0.0.1:$ProxyPort/cowork-$($script:State.secret)"
    if (-not (Wait-HttpOk "$local/health" 30)) {
        throw "The local proxy didn't start. Details: $(Join-Path $LogDir 'caddy.err.log')"
    }
    foreach ($blocked in @("http://127.0.0.1:$ProxyPort/health", "http://127.0.0.1:$ProxyPort/cowork-wrong/health")) {
        if ((Get-HttpStatus $blocked) -ne 404) { throw 'The local proxy is not blocking requests without the secret path.' }
    }
    Write-Good 'Only requests on the secret path get through.'

    if ($SelfTest) {
        Invoke-SelfTest -LocalBase $local
        return
    }

    $base = Initialize-Tunnel
    Write-Step 'Opening the tunnel...'
    Start-Background -Name 'tunnel' -FilePath (Get-AppPath 'devtunnel') `
        -Arguments @('host', $script:State.tunnelId) -WorkingDirectory $StateDir | Out-Null
    if (-not $base) { $base = Find-TunnelUrlInLog }
    if (-not $base) { throw "Couldn't find your tunnel's address. Details: $(Join-Path $LogDir 'tunnel.out.log')" }
    $cowork = "$base/cowork-$($script:State.secret)"
    if (-not (Wait-HttpOk "$cowork/health" 60)) {
        throw "The tunnel didn't connect. Check your internet connection. Details: $(Join-Path $LogDir 'tunnel.out.log')"
    }

    Write-Step 'Testing the connection end to end (through the internet)...'
    if (Invoke-ServerScript -Script 'smoke.mjs' -Url "$cowork/mcp" -LogName 'smoke') {
        Write-Good 'End-to-end test passed.'
    } else {
        Write-Warning "The end-to-end test failed, so Cowork may not be able to connect. Details: $(Join-Path $LogDir 'smoke.log')"
    }

    $url = "$cowork/mcp"
    $script:State.url = $url
    $pluginHash = Get-TextHash ((Get-FolderHash $PluginSrc) + '|' + $url + '|' + $script:State.appId)
    if ($Plugin -or $script:State.pluginHash -ne $pluginHash) {
        $script:State.pluginBuild = [int]$script:State.pluginBuild + 1
        Build-PluginZip -Url $url -OutFile $ReadyZip
        $script:State.pluginHash = $pluginHash
        Save-State
        Show-UploadSteps
    } else {
        Save-State
    }

    Write-Host ''
    Write-Host '  =========================================================================' -ForegroundColor Green
    Write-Host '   Claw PC is running. Keep this window open while you use Cowork.' -ForegroundColor Green
    Write-Host '   Press Ctrl+C (or close this window) to stop.' -ForegroundColor Green
    Write-Host '  =========================================================================' -ForegroundColor Green
    Wait-Running
}

function Invoke-Uninstall {
    $stopped = Stop-Stale
    if ($stopped -gt 0) { Write-Note "Stopped $stopped running process(es)." }
    $st = Read-State
    Update-SessionPath
    if ($st.tunnelId -and (Get-Command devtunnel -ErrorAction SilentlyContinue)) {
        Write-Step 'Deleting your dev tunnel...'
        'y' | & devtunnel delete $st.tunnelId *> $null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Couldn't delete the dev tunnel. You can do it later with: devtunnel delete $($st.tunnelId)" }
    }
    Write-Step 'Deleting keys, logs and the server build...'
    Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ReadyZip -Force -ErrorAction SilentlyContinue
    Write-Good 'Claw PC has been removed from this PC.'
    Write-Host ''
    Write-Host '  Also remove the plugin in Cowork: Customize > Plugins > Claw PC > Remove.'
    Write-Host "  Your workspace folder was left alone: $Workspace"
    Write-Host '  To remove the apps it installed (only if nothing else uses them):'
    Write-Host '    winget uninstall CaddyServer.Caddy'
    Write-Host '    winget uninstall Microsoft.devtunnel'
    Write-Host '    winget uninstall OpenJS.NodeJS.LTS'
}

# --- Main ----------------------------------------------------------------------------------------

$exitCode = 0
$showLogs = $false
try {
    if (-not $IsWindows) { throw 'Claw PC only runs on Windows 10 or 11.' }
    foreach ($required in @($ServerSrc, $PluginSrc)) {
        if (-not (Test-Path -LiteralPath $required)) {
            throw "Can't find $required. Run Start-Claw.cmd from the folder you extracted, with all its files."
        }
    }
    New-Item -ItemType Directory -Force -Path $StateDir, $LogDir, $JobDir | Out-Null

    if ($Stop) {
        $stopped = Stop-Stale
        if ($stopped -gt 0) { Write-Good "Stopped Claw PC ($stopped processes)." } else { Write-Note 'Claw PC was not running.' }
    } elseif ($Uninstall) {
        Invoke-Uninstall
    } else {
        Start-Claw
    }
} catch {
    $exitCode = 1
    $showLogs = [bool]$SelfTest
    Write-Host ''
    Write-Host "PROBLEM: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $SelfTest) { Write-Host 'Fixes for common problems: docs\troubleshooting.md' -ForegroundColor DarkGray }
} finally {
    Stop-Running
    if ($showLogs) { Show-Logs }
}
exit $exitCode
