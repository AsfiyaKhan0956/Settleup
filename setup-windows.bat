@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo          SettleUp - First Time Setup
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS or newer, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

node -e "const v=Number(process.versions.node.split('.')[0]); if(v<22){console.error('Node.js 22 or newer is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example. You can add email/SMS settings later.
)

echo Installing project dependencies. This requires an internet connection...
call npm install
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection and Node.js version, then run setup-windows.bat again.
  pause
  exit /b 1
)

echo Preparing the main SQLite database (existing database will never be overwritten)...
call npm run db:init
if errorlevel 1 (
  pause
  exit /b 1
)

echo Starting SettleUp...
call npm run dev
pause
