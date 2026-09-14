@echo off
chcp 65001 >nul
rem ============================================
rem  码境 CodeScope 一键启动（Windows，双击运行）
rem  前台运行，关闭窗口或按 Ctrl+C 即停止
rem ============================================
cd /d "%~dp0"

rem 工具目录同级通常就是 markdown-vault（整个文件夹一起放云盘时最稳），自动指向
if exist "%~dp0markdown-vault" set "CODESCOPE_VAULT=%~dp0markdown-vault"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装: https://nodejs.org  （装完重开本窗口）
  pause
  exit /b 1
)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 18 (
  echo [错误] Node.js 版本过低，需要 18 或更高版本。
  pause
  exit /b 1
)

cd /d "%~dp0masscode-runner"
node -e "const fs=require('fs'),path=require('path'),p=require('./package.json');process.exit(Object.keys(p.dependencies||{}).every(n=^>fs.existsSync(path.join('node_modules',...n.split('/'),'package.json')))?0:1)"
if errorlevel 1 goto install_deps
goto deps_ready

:install_deps
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，无法安装码境运行依赖。
  pause
  exit /b 1
)
echo 首次启动或依赖已更新：正在安装码境运行依赖…
call npm ci --omit=dev
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

:deps_ready

if not defined CODESCOPE_PORT set "CODESCOPE_PORT=%MASSCODE_RUNNER_PORT%"
if not defined CODESCOPE_PORT set "CODESCOPE_PORT=4877"
if not defined CODESCOPE_HOST set "CODESCOPE_HOST=%MASSCODE_RUNNER_HOST%"
if not defined CODESCOPE_HOST set "CODESCOPE_HOST=127.0.0.1"
set "PORT=%CODESCOPE_PORT%"
node scripts\ensure-onlyoffice.js
node preflight.js --quiet
if errorlevel 1 (
  echo [错误] 环境预检失败，请按上方提示修复后重试。
  pause
  exit /b 1
)
set "OPEN_HOST=%CODESCOPE_HOST%"
if "%OPEN_HOST%"=="0.0.0.0" set "OPEN_HOST=127.0.0.1"
if "%OPEN_HOST%"=="::" set "OPEN_HOST=[::1]"
echo 启动码境 CodeScope（前台运行，Ctrl+C 停止）
echo 页面：http://%OPEN_HOST%:%PORT%
if "%CODESCOPE_HOST%"=="0.0.0.0" echo 局域网：http://^<本机IP^>:%PORT%（仅限可信网络；本机 IP 用 ipconfig 查看）
start "" "http://%OPEN_HOST%:%PORT%"

node server.js

echo.
echo 服务已停止。
pause
