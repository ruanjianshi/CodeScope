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
if not exist "node_modules\@novnc\novnc\core\rfb.js" goto install_deps
if not exist "node_modules\ws" goto install_deps
if not exist "node_modules\ssh2" goto install_deps
if not exist "node_modules\saxes" goto install_deps
if not exist "node_modules\pdfjs-dist" goto install_deps
if not exist "node_modules\monaco-editor" goto install_deps
if not exist "node_modules\fflate" goto install_deps
if not exist "node_modules\xmind-embed-viewer\dist\umd\xmind-embed-viewer.js" goto install_deps
if not exist "node_modules\mind-elixir\dist\MindElixir.iife.js" goto install_deps
if not exist "node_modules\simple-mind-map\dist\simpleMindMap.umd.min.js" goto install_deps
if not exist "node_modules\docx-preview\dist\docx-preview.min.js" goto install_deps
if not exist "node_modules\xlsx\dist\xlsx.full.min.js" goto install_deps
if not exist "node_modules\pptx-preview\dist\pptx-preview.umd.js" goto install_deps
if not exist "node_modules\docx" goto install_deps
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
set "PORT=%CODESCOPE_PORT%"
echo 启动码境 CodeScope（前台运行，Ctrl+C 停止）
echo 页面：http://127.0.0.1:%PORT%
echo 局域网：http://<本机IP>:%PORT% （同一局域网下其他设备可访问；本机 IP 用 ipconfig 查看）
start "" "http://127.0.0.1:%PORT%"

node server.js

echo.
echo 服务已停止。
pause
