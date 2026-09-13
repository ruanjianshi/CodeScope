#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.onlyoffice.yml"

if ! command -v brew >/dev/null 2>&1; then
  echo "需要 Homebrew 才能安装本地容器运行时：https://brew.sh"
  exit 1
fi

missing=()
command -v colima >/dev/null 2>&1 || missing+=(colima)
command -v docker >/dev/null 2>&1 || missing+=(docker)
if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  missing+=(docker-compose)
fi
if ((${#missing[@]})); then
  echo "正在安装轻量容器运行时：${missing[*]}"
  brew install "${missing[@]}"
fi

if ! colima status >/dev/null 2>&1; then
  echo "正在启动 Colima（4 CPU / 6 GB 内存）…"
  colima start --cpu 4 --memory 6 --disk 20
fi

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
else
  compose=(docker-compose)
fi

echo "正在拉取并启动 ONLYOFFICE Docs 9.4（首次约需下载 1.3 GB）…"
"${compose[@]}" -f "$COMPOSE_FILE" up -d

echo "等待 ONLYOFFICE 完成初始化…"
for _ in $(seq 1 60); do
  if curl --noproxy '*' -fsS http://127.0.0.1:8088/healthcheck 2>/dev/null | grep -qi true; then
    echo "ONLYOFFICE Docs 已就绪：http://127.0.0.1:8088"
    exit 0
  fi
  sleep 3
done

echo "ONLYOFFICE 尚未在预期时间内就绪，可运行以下命令查看日志："
echo "  docker logs --tail 120 codescope-onlyoffice"
exit 1
