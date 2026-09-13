#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.onlyoffice.yml"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" stop
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f "$COMPOSE_FILE" stop
else
  echo "未找到 Docker Compose"
  exit 1
fi
