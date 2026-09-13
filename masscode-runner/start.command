#!/bin/bash
# 码境 CodeScope 启动（前台运行；关闭窗口或按 Ctrl+C 即停止）
cd "$(dirname "$0")"
PORT="${CODESCOPE_PORT:-${MASSCODE_RUNNER_PORT:-4877}}"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装：https://nodejs.org/"
  exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "Node.js 版本过低：当前 $(node --version)，需要 18 或更高版本。"
  exit 1
fi
if [ ! -f node_modules/@novnc/novnc/core/rfb.js ] || [ ! -d node_modules/ws ] || [ ! -d node_modules/ssh2 ] || [ ! -d node_modules/saxes ] || [ ! -d node_modules/pdfjs-dist ] || [ ! -d node_modules/monaco-editor ] || [ ! -d node_modules/fflate ] || [ ! -f node_modules/xmind-embed-viewer/dist/umd/xmind-embed-viewer.js ] || [ ! -f node_modules/mind-elixir/dist/MindElixir.iife.js ]; then
  command -v npm >/dev/null 2>&1 || { echo "未找到 npm，无法安装码境运行依赖。"; exit 1; }
  echo "首次启动或依赖已更新：正在安装码境运行依赖…"
  npm ci --omit=dev || { echo "依赖安装失败，请检查网络后重试。"; exit 1; }
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用（可能已在运行），直接打开页面…"
  open "http://127.0.0.1:$PORT"
  exit 0
fi
echo "启动码境 CodeScope（前台运行，Ctrl+C 停止）"
echo "页面：http://127.0.0.1:$PORT"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -n "$LAN_IP" ] && echo "局域网：http://$LAN_IP:$PORT（同一 Wi-Fi 下其他设备可访问）"
( sleep 1.2; open "http://127.0.0.1:$PORT" ) &
exec node server.js
