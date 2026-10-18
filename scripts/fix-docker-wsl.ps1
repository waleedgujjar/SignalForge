#Requires -RunAsAdministrator
# Fixes unresponsive WSL so Docker Desktop can start.
# Run: Right-click PowerShell -> Run as administrator, then:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   & "C:\Users\walee\Downloads\SignalForge\scripts\fix-docker-wsl.ps1"

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "`n=== SignalForge: Fix WSL + Docker ===" -ForegroundColor Cyan

# 1. Stop Docker Desktop
Write-Host "`n[1/6] Stopping Docker Desktop..." -ForegroundColor Yellow
Get-Process -Name "Docker Desktop","com.docker.backend","com.docker.service" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# 2. Kill stuck WSL processes
Write-Host "[2/6] Stopping stuck WSL processes..." -ForegroundColor Yellow
Get-Process -Name "wsl","wslhost","wslservice" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 3. Shutdown WSL (timeout after 30s)
Write-Host "[3/6] Shutting down WSL..." -ForegroundColor Yellow
$wslJob = Start-Job { wsl --shutdown 2>&1 }
$completed = Wait-Job $wslJob -Timeout 30
if ($completed) {
    Receive-Job $wslJob | Write-Host
} else {
    Write-Host "  wsl --shutdown timed out (continuing anyway)" -ForegroundColor DarkYellow
    Stop-Job $wslJob -Force
}
Remove-Job $wslJob -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# 4. Restart WSL / Hyper-V services
Write-Host "[4/6] Restarting WSL and Hyper-V services..." -ForegroundColor Yellow
foreach ($svc in @('WSLService', 'vmcompute', 'hns')) {
    $service = Get-Service $svc -ErrorAction SilentlyContinue
    if (-not $service) { continue }
    try {
        Restart-Service $svc -Force -ErrorAction Stop
        Write-Host "  Restarted $svc" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to restart ${svc}: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Start-Sleep -Seconds 5

# 5. Verify WSL responds
Write-Host "[5/6] Verifying WSL..." -ForegroundColor Yellow
$testJob = Start-Job { wsl.exe -e echo wsl-ok 2>&1 }
$testDone = Wait-Job $testJob -Timeout 20
if ($testDone -and (Receive-Job $testJob) -match 'wsl-ok') {
    Write-Host "  WSL is responsive" -ForegroundColor Green
    wsl -l -v
} else {
    Write-Host "  WSL still not responding — restart your PC, then run this script again." -ForegroundColor Red
    Stop-Job $testJob -Force -ErrorAction SilentlyContinue
    Remove-Job $testJob -Force -ErrorAction SilentlyContinue
    if (-not $env:SF_FIX_DOCKER_NONINTERACTIVE) { Read-Host "`nPress Enter to exit" }
    exit 1
}
Remove-Job $testJob -Force -ErrorAction SilentlyContinue

# 6. Start Docker Desktop and wait for engine
Write-Host "[6/6] Starting Docker Desktop..." -ForegroundColor Yellow
$dockerExe = "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
    Write-Host "  Docker Desktop not found at $dockerExe" -ForegroundColor Red
    if (-not $env:SF_FIX_DOCKER_NONINTERACTIVE) { Read-Host "`nPress Enter to exit" }
    exit 1
}
Start-Process $dockerExe

$dockerReady = $false
for ($i = 0; $i -lt 60; $i++) {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $dockerReady = $true
        break
    }
    Write-Host "  Waiting for Docker engine... ($($i + 1)/60)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}

if (-not $dockerReady) {
    Write-Host "  Docker engine did not start in time. Open Docker Desktop manually." -ForegroundColor Red
    if (-not $env:SF_FIX_DOCKER_NONINTERACTIVE) { Read-Host "`nPress Enter to exit" }
    exit 1
}

Write-Host "  Docker engine is running" -ForegroundColor Green

# Start SignalForge containers
Write-Host "`nStarting SignalForge containers..." -ForegroundColor Cyan
Set-Location $ProjectRoot
docker compose up postgres redis -d

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Postgres: localhost:5435 | Redis: localhost:6380"
docker compose ps

if (-not $env:SF_FIX_DOCKER_NONINTERACTIVE) { Read-Host "`nPress Enter to exit" }
