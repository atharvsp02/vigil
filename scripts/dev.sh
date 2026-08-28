#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

CHECKOUT_PORT="${CHECKOUT_PORT:-4000}"
OBSERVABILITY_PORT="${OBSERVABILITY_PORT:-4101}"
DEPLOYS_PORT="${DEPLOYS_PORT:-4102}"
HARNESS_PORT="${HARNESS_PORT:-8790}"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

ensure_secret() {
  local key="$1"
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$(openssl rand -hex 24)" >> "$ENV_FILE"
    echo "generated $key into .env"
  fi
}

ensure_secret ADMIN_TOKEN
ensure_secret MCP_BEARER_TOKEN
ensure_secret REPLAY_TOKEN

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY missing from .env; the harness cannot call a model without it" >&2
fi

stop_port() {
  local port="$1"
  local pid
  pid="$(ss -ltnpH "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

wait_for() {
  local url="$1" name="$2" tries="${3:-40}"
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      echo "  $name ready"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "  $name FAILED to become ready; see $LOG_DIR" >&2
  return 1
}

echo "building workspace"
pnpm -s build >/dev/null

for port in "$CHECKOUT_PORT" "$OBSERVABILITY_PORT" "$DEPLOYS_PORT" "$HARNESS_PORT"; do
  stop_port "$port"
done

echo "starting services"

ADMIN_TOKEN="$ADMIN_TOKEN" \
REPLAY_TOKEN="$REPLAY_TOKEN" \
PORT="$CHECKOUT_PORT" \
DATABASE_PATH="${DATABASE_PATH:-$ROOT/.dev-logs/checkout.sqlite}" \
  nohup setsid node packages/checkout-service/dist/index.js \
  > "$LOG_DIR/checkout.log" 2>&1 < /dev/null &

CHECKOUT_BASE_URL="http://127.0.0.1:$CHECKOUT_PORT" \
CHECKOUT_REPLAY_TOKEN="$REPLAY_TOKEN" \
PORT="$OBSERVABILITY_PORT" \
MCP_BEARER_TOKEN="$MCP_BEARER_TOKEN" \
  nohup setsid node packages/mcp-servers/dist/observability/index.js \
  > "$LOG_DIR/mcp-observability.log" 2>&1 < /dev/null &

CHECKOUT_BASE_URL="http://127.0.0.1:$CHECKOUT_PORT" \
PORT="$DEPLOYS_PORT" \
CHECKOUT_ADMIN_TOKEN="$ADMIN_TOKEN" \
MCP_BEARER_TOKEN="$MCP_BEARER_TOKEN" \
  nohup setsid node packages/mcp-servers/dist/deploys/index.js \
  > "$LOG_DIR/mcp-deploys.log" 2>&1 < /dev/null &

nohup setsid npx -y @truefoundry/trueforge --port "$HARNESS_PORT" \
  > "$LOG_DIR/trueforge.log" 2>&1 < /dev/null &

wait_for "http://127.0.0.1:$CHECKOUT_PORT/health" "checkout service"
wait_for "http://127.0.0.1:$OBSERVABILITY_PORT/health" "mcp observability"
wait_for "http://127.0.0.1:$DEPLOYS_PORT/health" "mcp deploys"
wait_for "http://127.0.0.1:$HARNESS_PORT/" "trueforge harness" 60

echo
echo "checkout service    http://127.0.0.1:$CHECKOUT_PORT"
echo "mcp observability   http://127.0.0.1:$OBSERVABILITY_PORT/mcp"
echo "mcp deploys         http://127.0.0.1:$DEPLOYS_PORT/mcp"
echo "trueforge harness   http://127.0.0.1:$HARNESS_PORT"
echo "logs                $LOG_DIR"
