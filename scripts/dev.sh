#!/usr/bin/env bash
#
# Ghost Project Hunter — dev process manager
#
#   scripts/dev.sh start [api|web|all]    start service(s)
#   scripts/dev.sh stop  [api|web|all]    stop service(s)
#   scripts/dev.sh restart [api|web|all]  stop then start
#   scripts/dev.sh status                 show running state
#   scripts/dev.sh logs [api|web]         tail a service log
#
# Config via env or .env at repo root:
#   PORT (api, default 8787), WEB_PORT (default 5273),
#   GPH_DB_PATH, GPH_SEED_TOKEN
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"

# Load .env if present (simple KEY=VALUE lines).
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

API_PORT="${PORT:-8787}"
WEB_PORT="${WEB_PORT:-5273}"

pidfile() { echo "$RUN/$1.pid"; }
logfile() { echo "$RUN/$1.log"; }

# Best-effort primary LAN IP for showing external URLs.
lan_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ip" ] || ip="$(ipconfig getifaddr en0 2>/dev/null)"
  echo "${ip:-localhost}"
}

is_running() {
  local pf
  pf="$(pidfile "$1")"
  [[ -f "$pf" ]] && kill -0 "$(cat "$pf")" 2>/dev/null
}

start_one() {
  local svc="$1"
  if is_running "$svc"; then
    echo "• $svc already running (pid $(cat "$(pidfile "$svc")"))"
    return
  fi
  case "$svc" in
    api)
      ( cd "$ROOT" && PORT="$API_PORT" exec node --experimental-strip-types \
        server/src/index.ts ) >"$(logfile api)" 2>&1 &
      echo $! >"$(pidfile api)"
      echo "✓ api started on :$API_PORT (pid $!)"
      ;;
    web)
      ( cd "$ROOT" && exec npm run dev -w web -- \
        --host --port "$WEB_PORT" --strictPort ) >"$(logfile web)" 2>&1 &
      echo $! >"$(pidfile web)"
      echo "✓ web started on :$WEB_PORT (pid $!), LAN: http://$(lan_ip):$WEB_PORT"
      ;;
    *) echo "unknown service: $svc" >&2; exit 1 ;;
  esac
}

stop_one() {
  local svc="$1" pf
  pf="$(pidfile "$svc")"
  if is_running "$svc"; then
    local pid
    pid="$(cat "$pf")"
    # Kill the whole process group (npm spawns children).
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.4
    kill -9 "$pid" 2>/dev/null || true
    echo "✓ $svc stopped"
  else
    echo "• $svc not running"
  fi
  rm -f "$pf"
}

status_one() {
  if is_running "$1"; then
    echo "  $1: running (pid $(cat "$(pidfile "$1")"))"
  else
    echo "  $1: stopped"
  fi
}

expand() { [[ "${1:-all}" == "all" ]] && echo "api web" || echo "$1"; }

cmd="${1:-}"; target="${2:-all}"
case "$cmd" in
  start)   for s in $(expand "$target"); do start_one "$s"; done ;;
  stop)    for s in $(expand "$target"); do stop_one "$s"; done ;;
  restart)
    for s in $(expand "$target"); do stop_one "$s"; done
    sleep 0.5
    for s in $(expand "$target"); do start_one "$s"; done
    ;;
  status)
    echo "Ghost Project Hunter — services"
    status_one api; status_one web
    echo "  api:  http://localhost:$API_PORT   (LAN: http://$(lan_ip):$API_PORT)"
    echo "  web:  http://localhost:$WEB_PORT   (LAN: http://$(lan_ip):$WEB_PORT)"
    ;;
  logs)
    [[ "$target" == "all" ]] && target="api"
    tail -f "$(logfile "$target")"
    ;;
  *)
    echo "usage: scripts/dev.sh {start|stop|restart|status|logs} [api|web|all]" >&2
    exit 1
    ;;
esac
