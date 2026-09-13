#!/bin/bash
# ============================================
#  码境 CodeScope 启动（前台运行）
#  服务在前台跑，关闭窗口或按 Ctrl+C 即停止
# ============================================
cd "$(dirname "$0")/masscode-runner" || { echo "找不到 masscode-runner 目录"; read -r -p "按回车退出"; exit 1; }
PORT="${CODESCOPE_PORT:-${MASSCODE_RUNNER_PORT:-4877}}"
HOST="${CODESCOPE_HOST:-${MASSCODE_RUNNER_HOST:-127.0.0.1}}"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装：https://nodejs.org/"
  read -r -p "按回车退出"
  exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "Node.js 版本过低：当前 $(node --version)，需要 18 或更高版本。"
  read -r -p "按回车退出"
  exit 1
fi
if ! node -e 'const fs=require("fs"),path=require("path"),p=require("./package.json");process.exit(Object.keys(p.dependencies||{}).every(n=>fs.existsSync(path.join("node_modules",...n.split("/"),"package.json")))?0:1)'; then
  command -v npm >/dev/null 2>&1 || { echo "未找到 npm，无法安装码境依赖。"; read -r -p "按回车退出"; exit 1; }
  echo "首次启动或依赖已更新：正在安装码境运行依赖…"
  npm ci --omit=dev || { echo "依赖安装失败，请检查网络后重试。"; read -r -p "按回车退出"; exit 1; }
fi

export CODESCOPE_VAULT="${CODESCOPE_VAULT:-${MASSCODE_VAULT:-$(cd .. && pwd)/markdown-vault}}"
export CODESCOPE_HOST="$HOST"
node preflight.js --quiet || { echo "环境预检失败，请按上方提示修复后重试。"; read -r -p "按回车退出"; exit 1; }
OPEN_HOST="$HOST"; [ "$OPEN_HOST" = "0.0.0.0" ] && OPEN_HOST="127.0.0.1"; [ "$OPEN_HOST" = "::" ] && OPEN_HOST="[::1]"
URL="http://$OPEN_HOST:$PORT"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 码境 CodeScope 已在运行（端口 $PORT），直接打开页面…"
  ( sleep 0.6; open "$URL" ) &
  read -r -p "按回车退出"
  exit 0
fi

echo "启动码境 CodeScope（前台运行，Ctrl+C 停止）"
echo "页面：$URL"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
if { [ "$HOST" = "0.0.0.0" ] || [ "$HOST" = "::" ]; } && [ -n "$LAN_IP" ]; then echo "局域网：http://$LAN_IP:$PORT（仅限可信网络）"; fi
( sleep 1.2; open "$URL" ) &
exec node server.js
