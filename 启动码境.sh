#!/usr/bin/env bash
# 码境 CodeScope 一键启动（Linux / WSL）
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$ROOT_DIR/masscode-runner"
PORT="${CODESCOPE_PORT:-${MASSCODE_RUNNER_PORT:-4877}}"
HOST="${CODESCOPE_HOST:-${MASSCODE_RUNNER_HOST:-127.0.0.1}}"

if [ ! -d "$RUNNER_DIR" ]; then echo "找不到 masscode-runner 目录：$RUNNER_DIR"; exit 1; fi
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。Debian/Ubuntu 可运行：sudo apt-get install -y nodejs npm"
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 版本过低：当前 $(node --version)，需要 18 或更高版本。"
  echo "建议使用发行版新版软件源或 nvm 安装 Node.js LTS：https://nodejs.org/"
  exit 1
fi

cd "$RUNNER_DIR"
if ! node -e 'const fs=require("fs"),path=require("path"),p=require("./package.json");process.exit(Object.keys(p.dependencies||{}).every(n=>fs.existsSync(path.join("node_modules",...n.split("/"),"package.json")))?0:1)'; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "未找到 npm，无法安装码境运行依赖。"
    exit 1
  fi
  echo "首次启动或依赖已更新：正在安装码境运行依赖…"
  npm ci --omit=dev
fi

export CODESCOPE_VAULT="${CODESCOPE_VAULT:-${MASSCODE_VAULT:-$ROOT_DIR/markdown-vault}}"
export CODESCOPE_HOST="$HOST"
node scripts/ensure-onlyoffice.js
node preflight.js --quiet || { echo "环境预检失败，请按上方提示修复后重试。"; exit 1; }
OPEN_HOST="$HOST"
[ "$OPEN_HOST" = "0.0.0.0" ] && OPEN_HOST="127.0.0.1"
[ "$OPEN_HOST" = "::" ] && OPEN_HOST="[::1]"
URL="http://$OPEN_HOST:$PORT"

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then gio open "$URL" >/dev/null 2>&1 &
  elif command -v wslview >/dev/null 2>&1; then wslview "$URL" >/dev/null 2>&1 &
  else echo "浏览器未自动打开，请手动访问：$URL"; fi
}

if command -v curl >/dev/null 2>&1 && curl --noproxy '*' -fsS "$URL/api/rev" >/dev/null 2>&1; then
  echo "码境 CodeScope 已在运行：$URL"
  open_browser
  exit 0
fi

echo "启动码境 CodeScope（Linux，Ctrl+C 停止）"
echo "Vault：$CODESCOPE_VAULT"
echo "页面：$URL"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if { [ "$HOST" = "0.0.0.0" ] || [ "$HOST" = "::" ]; } && [ -n "$LAN_IP" ]; then
  echo "局域网：http://$LAN_IP:$PORT（仅限可信网络）"
fi
( sleep 1; open_browser ) &
exec node server.js
