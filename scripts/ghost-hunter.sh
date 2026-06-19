#!/usr/bin/env bash
#
# ghost-hunter.sh — pure-shell Ghost Project Hunter agent (no Node required).
# Mirrors the `ghost-hunter` CLI: shares ~/.config/ghost-hunter with the Node
# version, so the two are interchangeable.
#
#   ghost-hunter.sh login <serverUrl> <token>   save server + token
#   ghost-hunter.sh init                         install Claude Code hooks
#   ghost-hunter.sh hook                         (called by Claude; reads stdin)
#   ghost-hunter.sh log "<project>" "<summary>"  manual activity log
#   ghost-hunter.sh flush                        send queued (offline) events
#   ghost-hunter.sh status                        show config + server health
#
# HARD RULE for `hook`: never block Claude — bounded timeouts, always exit 0,
# queue to outbox on failure.

CONFIG_DIR="${GPH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/ghost-hunter}"
[ -n "${GPH_CONFIG_DIR:-}" ] || CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ghost-hunter"
CONFIG_FILE="$CONFIG_DIR/config.json"
OUTBOX="$CONFIG_DIR/outbox"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
HOOK_TIMEOUT=1.5

# ── JSON helpers (prefer jq, then python3, then sed) ──────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

json_get() { # <json-string> <key>  -> value ("" if absent)
  local json="$1" key="$2"
  if have jq; then
    printf '%s' "$json" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
  elif have python3; then
    printf '%s' "$json" | python3 -c \
      "import sys,json;
try:
 d=json.load(sys.stdin); print(d.get('$key',''))
except Exception: print('')" 2>/dev/null
  else
    printf '%s' "$json" | sed -nE "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -1
  fi
}

# JSON-escape a string value.
json_str() {
  if have jq; then jq -Rn --arg v "$1" '$v'
  elif have python3; then python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$1"
  else printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; fi
}

cfg() { [ -f "$CONFIG_FILE" ] && json_get "$(cat "$CONFIG_FILE")" "$1"; }

gen_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif have uuidgen; then uuidgen
  elif have python3; then python3 -c 'import uuid;print(uuid.uuid4())'
  else echo "dev-$(date +%s)-$$"; fi
}

# Run a command with a timeout if `timeout` exists; else run plain.
t() { if have timeout; then timeout "$1" "${@:2}"; else "${@:2}"; fi; }

# ── collectors ───────────────────────────────────────────────────────────────
project_keys() { # <cwd>  -> prints: primary_key<TAB>local_key<TAB>repo_url
  local cwd abs name remote rkey host local_key
  cwd="$1"; abs="$(cd "$cwd" 2>/dev/null && pwd || echo "$cwd")"
  name="$(basename "$abs")"
  host="$(hostname 2>/dev/null || echo "${HOSTNAME:-host}")"
  local_key="local:$host:$abs"
  remote="$(t 0.8 git -C "$abs" remote get-url origin 2>/dev/null)"
  if [ -n "$remote" ]; then
    rkey="$(printf '%s' "$remote" \
      | sed -E 's#^[a-zA-Z]+://([^@/]+@)?#:#; s#^git@##; s#:#/#; s#\.git/?$##' \
      | tr 'A-Z' 'a-z' | sed -E 's#^/+##; s#/+$##')"
    printf '%s\t%s\t%s\t%s\n' "$rkey" "$local_key" "$remote" "$name"
  else
    printf '%s\t%s\t%s\t%s\n' "$local_key" "" "" "$name"
  fi
}

count_turns() { # <transcript_path>
  [ -n "$1" ] && [ -f "$1" ] || { echo 0; return; }
  grep -cE '"type"[[:space:]]*:[[:space:]]*"assistant"' "$1" 2>/dev/null || echo 0
}

files_changed() { # <cwd>
  local n; n="$(t 0.8 git -C "$1" status --porcelain 2>/dev/null | grep -c .)"
  echo "${n:-0}"
}

bool() { [ "$1" = "1" ] && echo true || echo false; }

scan_maturity() { # <cwd>  -> JSON object
  local d="$1" readme=0 tests=0 ci=0 deploy=0 tags=0 version=null
  [ -f "$d/README.md" ] || [ -f "$d/README" ] || [ -f "$d/readme.md" ] && readme=1
  [ -d "$d/test" ] || [ -d "$d/tests" ] || [ -d "$d/__tests__" ] || [ -d "$d/spec" ] && tests=1
  if [ "$tests" = 0 ] && [ -f "$d/package.json" ]; then
    if have jq; then jq -e '.scripts.test // empty' "$d/package.json" >/dev/null 2>&1 && tests=1
    elif have python3; then python3 -c "import json,sys;d=json.load(open('$d/package.json'));sys.exit(0 if d.get('scripts',{}).get('test') else 1)" 2>/dev/null && tests=1; fi
  fi
  [ -d "$d/.github/workflows" ] || [ -f "$d/.gitlab-ci.yml" ] || [ -d "$d/.circleci" ] && ci=1
  for f in Dockerfile vercel.json fly.toml netlify.toml Procfile; do [ -f "$d/$f" ] && deploy=1; done
  tags="$(t 0.8 git -C "$d" tag 2>/dev/null | grep -c .)"; tags="${tags:-0}"
  if [ -f "$d/package.json" ]; then
    local v; v="$(json_get "$(cat "$d/package.json")" version)"
    [ -n "$v" ] && version="$(json_str "$v")"
  fi
  printf '{"has_readme":%s,"has_tests":%s,"has_ci":%s,"has_deploy":%s,"git_tags":%s,"version":%s}' \
    "$(bool $readme)" "$(bool $tests)" "$(bool $ci)" "$(bool $deploy)" "$tags" "$version"
}

build_payload() { # <event_type> <cwd> <turns> <session_id> <summary> [name_override]
  local etype="$1" cwd="$2" turns="$3" sid="$4" summary="$5" name_override="$6"
  local keys primary local_key repo name files maturity alt sidjson sumjson
  keys="$(project_keys "$cwd")"
  primary="$(printf '%s' "$keys" | cut -f1)"
  local_key="$(printf '%s' "$keys" | cut -f2)"
  repo="$(printf '%s' "$keys" | cut -f3)"
  name="$(printf '%s' "$keys" | cut -f4)"
  [ -n "$name_override" ] && name="$name_override"
  files="$(files_changed "$cwd")"
  maturity="$(scan_maturity "$cwd")"
  alt="[]"; [ -n "$local_key" ] && alt="[$(json_str "$local_key")]"
  local repojson="null"; [ -n "$repo" ] && repojson="$(json_str "$repo")"
  sidjson="null"; [ -n "$sid" ] && sidjson="$(json_str "$sid")"
  sumjson=""; [ -n "$summary" ] && sumjson=",\"summary\":$(json_str "$summary")"
  printf '{"device_id":%s,"hostname":%s,"event_type":"%s","session_id":%s,"ts":"%s","project":{"key":%s,"alt_keys":%s,"name":%s,"path":%s,"repo_url":%s},"metrics":{"turns":%s,"duration_sec":0,"files_changed":%s},"maturity_signals":%s%s}' \
    "$(json_str "$(cfg deviceId)")" "$(json_str "$(cfg hostname)")" "$etype" "$sidjson" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_str "$primary")" "$alt" "$(json_str "$name")" \
    "$(json_str "$cwd")" "$repojson" "$turns" "$files" "$maturity" "$sumjson"
}

post_event() { # <payload>  -> 0 on 2xx
  local server token code body
  server="$(cfg serverUrl)"; token="$(cfg token)"
  [ -n "$server" ] && [ -n "$token" ] || return 1
  if [ -n "${GPH_DEBUG:-}" ]; then
    body="$(curl -sS --max-time "$HOOK_TIMEOUT" -X POST "$server/api/v1/events" \
      -H "authorization: Bearer $token" -H "content-type: application/json" -d "$1" 2>/dev/null)"
    printf 'DEBUG payload: %s\nDEBUG response: %s\n' "$1" "$body" >&2
  fi
  code="$(curl -sS --max-time "$HOOK_TIMEOUT" -o /dev/null -w '%{http_code}' \
    -X POST "$server/api/v1/events" \
    -H "authorization: Bearer $token" -H "content-type: application/json" \
    -d "$1" 2>/dev/null)"
  [ "${code:0:1}" = "2" ]
}

enqueue() { mkdir -p "$OUTBOX" 2>/dev/null; printf '%s' "$1" > "$OUTBOX/$(date +%s)-$$-$RANDOM.json" 2>/dev/null; }

# ── commands ─────────────────────────────────────────────────────────────────
cmd_login() {
  [ -n "$1" ] && [ -n "$2" ] || { echo "Usage: ghost-hunter.sh login <serverUrl> <token>" >&2; exit 1; }
  mkdir -p "$CONFIG_DIR"
  local did host
  did="$(cfg deviceId)"; [ -n "$did" ] || did="$(gen_uuid)"
  host="$(hostname 2>/dev/null || echo "${HOSTNAME:-host}")"
  cat > "$CONFIG_FILE" <<EOF
{
  "serverUrl": $(json_str "${1%/}"),
  "token": $(json_str "$2"),
  "deviceId": $(json_str "$did"),
  "hostname": $(json_str "$host")
}
EOF
  chmod 600 "$CONFIG_FILE"
  echo "✓ Saved config to $CONFIG_FILE"
}

cmd_init() {
  [ -f "$CONFIG_FILE" ] || { echo "Run 'ghost-hunter.sh login <url> <token>' first." >&2; exit 1; }
  local self; self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  local cmd="bash $self hook"
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  if have jq; then
    local tmp; tmp="$(mktemp)"
    [ -f "$CLAUDE_SETTINGS" ] || echo '{}' > "$CLAUDE_SETTINGS"
    jq --arg cmd "$cmd" '
      def ensure(ev):
        .hooks[ev] = ((.hooks[ev] // [])
          | if any(.[]?; (.hooks[]?.command // "") | contains("ghost-hunter")) then .
            else . + [{"hooks":[{"type":"command","command":$cmd,"timeout":2}]}] end);
      .hooks = (.hooks // {}) | ensure("SessionStart") | ensure("SessionEnd")
    ' "$CLAUDE_SETTINGS" > "$tmp" && mv "$tmp" "$CLAUDE_SETTINGS"
    echo "✓ Installed hooks in $CLAUDE_SETTINGS"
  else
    echo "jq not found — add these hooks to $CLAUDE_SETTINGS manually:"
    echo "  SessionStart/SessionEnd -> command: \"$cmd\" (timeout 2)"
  fi
}

cmd_hook() {
  [ -f "$CONFIG_FILE" ] || exit 0           # not configured -> no-op
  local input cwd etype sid trans turns payload
  input="$(t 0.3 cat 2>/dev/null)"          # read hook JSON from stdin
  cwd="$(json_get "$input" cwd)"; [ -n "$cwd" ] || cwd="$PWD"
  etype="session_end"
  [ "$(json_get "$input" hook_event_name)" = "SessionStart" ] && etype="session_start"
  sid="$(json_get "$input" session_id)"
  trans="$(json_get "$input" transcript_path)"
  turns=0; [ "$etype" = "session_end" ] && turns="$(count_turns "$trans")"
  payload="$(build_payload "$etype" "$cwd" "$turns" "$sid" "")"
  flush_outbox 10 >/dev/null 2>&1
  post_event "$payload" || enqueue "$payload"
  exit 0
}

cmd_log() {
  [ -f "$CONFIG_FILE" ] || { echo "Not configured." >&2; exit 1; }
  local payload; payload="$(build_payload "session_end" "$PWD" 1 "" "$2" "$1")"
  if post_event "$payload"; then echo "✓ Logged \"${1:-cwd}\""; else echo "✗ Server unreachable"; exit 1; fi
}

cmd_scan() {
  [ -f "$CONFIG_FILE" ] || { echo "Not configured." >&2; exit 1; }
  local days=365 name="" cwd="$PWD"
  while [ $# -gt 0 ]; do
    case "$1" in
      --days) days="$2"; shift 2 ;;
      --name) name="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  local server token; server="$(cfg serverUrl)"; token="$(cfg token)"
  # Compute project identity + maturity once.
  local keys primary local_key repo defname maturity alt repojson
  keys="$(project_keys "$cwd")"
  primary="$(printf '%s' "$keys" | cut -f1)"
  local_key="$(printf '%s' "$keys" | cut -f2)"
  repo="$(printf '%s' "$keys" | cut -f3)"
  defname="$(printf '%s' "$keys" | cut -f4)"
  [ -n "$name" ] || name="$defname"
  maturity="$(scan_maturity "$cwd")"
  alt="[]"; [ -n "$local_key" ] && alt="[$(json_str "$local_key")]"
  repojson="null"; [ -n "$repo" ] && repojson="$(json_str "$repo")"

  local devjson hostjson namejson keyjson pathjson
  devjson="$(json_str "$(cfg deviceId)")"; hostjson="$(json_str "$(cfg hostname)")"
  namejson="$(json_str "$name")"; keyjson="$(json_str "$primary")"; pathjson="$(json_str "$cwd")"

  # Commit counts per day.
  local counts; counts="$(git -C "$cwd" log --since="$days days ago" \
    --date=short --pretty=%cd 2>/dev/null | sort | uniq -c)"
  [ -n "$counts" ] || { echo "No commits found (not a git repo, or none in range)." >&2; exit 1; }

  local events="" total=0 day count
  while read -r count day; do
    [ -n "$day" ] || continue
    total=$((total + count))
    local ev
    ev="$(printf '{"device_id":%s,"hostname":%s,"event_type":"session_end","session_id":"scan:%s","ts":"%sT12:00:00Z","project":{"key":%s,"alt_keys":%s,"name":%s,"path":%s,"repo_url":%s},"metrics":{"turns":%s,"duration_sec":0,"files_changed":0},"maturity_signals":%s,"summary":"%s commit(s) (scan)"}' \
      "$devjson" "$hostjson" "$day" "$day" "$keyjson" "$alt" "$namejson" "$pathjson" "$repojson" "$count" "$maturity" "$count")"
    events="$events${events:+,}$ev"
  done <<EOF
$counts
EOF

  local body resp
  body="{\"events\":[$events]}"
  resp="$(curl -sS --max-time 30 -X POST "$server/api/v1/events/bulk" \
    -H "authorization: Bearer $token" -H "content-type: application/json" \
    -d "$body" 2>/dev/null)"
  if printf '%s' "$resp" | grep -q '"ingested"'; then
    echo "✓ Scanned \"$name\": $total commit(s) over ${days}d → $resp"
  else
    echo "✗ Scan failed (server unreachable or rejected): $resp" >&2
    exit 1
  fi
}

flush_outbox() {
  local max="${1:-1000}" n=0 f
  [ -d "$OUTBOX" ] || { echo 0; return; }
  for f in $(ls -1 "$OUTBOX"/*.json 2>/dev/null | head -n "$max"); do
    if post_event "$(cat "$f")"; then rm -f "$f"; n=$((n+1)); else break; fi
  done
  echo "$n"
}

cmd_flush() { echo "✓ Flushed $(flush_outbox 1000) queued event(s)"; }

cmd_status() {
  [ -f "$CONFIG_FILE" ] || { echo "Not configured. Run: ghost-hunter.sh login <url> <token>"; exit 0; }
  local server queued; server="$(cfg serverUrl)"
  queued="$(ls -1 "$OUTBOX"/*.json 2>/dev/null | grep -c . || echo 0)"
  echo "server:  $server"
  echo "device:  $(cfg hostname) ($(cfg deviceId | cut -c1-8)…)"
  echo "outbox:  $queued queued"
  if curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$server/api/v1/health" 2>/dev/null | grep -q '^2'; then
    echo "health:  ok ✓"
  else
    echo "health:  unreachable ✗"
  fi
}

case "${1:-}" in
  login)  shift; cmd_login "$@" ;;
  init)   shift; cmd_init "$@" ;;
  hook)   shift; cmd_hook "$@" ;;
  log)    shift; cmd_log "$@" ;;
  scan)   shift; cmd_scan "$@" ;;
  flush)  shift; cmd_flush "$@" ;;
  status) shift; cmd_status "$@" ;;
  *) echo "usage: ghost-hunter.sh {login|init|hook|log|scan|flush|status}" >&2; exit 1 ;;
esac
