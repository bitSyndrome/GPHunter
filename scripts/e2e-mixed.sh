#!/usr/bin/env bash
#
# E2E: mixed clients (Node CLI + pure-shell) reporting the SAME git remote from
# two different local paths (= two machines) must merge into ONE project with
# device_count = 2 and summed turns.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

pkill -f "server/src/index.ts" 2>/dev/null; sleep 0.5
TOK="mix-tok"; PORT=8793; DB="$(mktemp -u --suffix=.sqlite)"

# Ensure built artifacts are current.
npm run build:shared >/dev/null 2>&1
npm run build -w cli  >/dev/null 2>&1

GPH_DB_PATH="$DB" GPH_SEED_TOKEN="$TOK" PORT=$PORT \
  node --experimental-strip-types server/src/index.ts >/tmp/gph-mix.log 2>&1 &
SRV=$!; sleep 1.4

REMOTE="git@github.com:me/shared-demo.git"
REPO_A="$(mktemp -d)"; REPO_B="$(mktemp -d)"   # two distinct local paths
for R in "$REPO_A" "$REPO_B"; do
  git -C "$R" init -q
  git -C "$R" remote add origin "$REMOTE"
  echo "# shared-demo" > "$R/README.md"
done

# Transcripts: 3 assistant turns (A) + 2 (B) => 5 total.
TA="$(mktemp)"; printf '%s\n' '{"type":"assistant"}' '{"type":"assistant"}' '{"type":"assistant"}' > "$TA"
TB="$(mktemp)"; printf '%s\n' '{"type":"assistant"}' '{"type":"assistant"}' > "$TB"

# Machine 1: Node CLI client, working in REPO_A.
NODE_CFG="$(mktemp -d)"
GPH_CONFIG_DIR="$NODE_CFG" node cli/dist/cli.js login "http://localhost:$PORT" "$TOK" >/dev/null
echo "{\"hook_event_name\":\"SessionEnd\",\"cwd\":\"$REPO_A\",\"transcript_path\":\"$TA\"}" \
  | GPH_CONFIG_DIR="$NODE_CFG" node cli/dist/hook.js

# Machine 2: pure-shell client, working in REPO_B.
SH_CFG="$(mktemp -d)"
GPH_CONFIG_DIR="$SH_CFG" bash scripts/ghost-hunter.sh login "http://localhost:$PORT" "$TOK" >/dev/null
echo "{\"hook_event_name\":\"SessionEnd\",\"cwd\":\"$REPO_B\",\"transcript_path\":\"$TB\"}" \
  | GPH_CONFIG_DIR="$SH_CFG" bash scripts/ghost-hunter.sh hook

echo "--- client identities ---"
echo "node  cwd=$REPO_A  device=$(grep -o '\"deviceId\"[^,]*' "$NODE_CFG/config.json")"
echo "shell cwd=$REPO_B  device=$(grep -o '\"deviceId\"[^,]*' "$SH_CFG/config.json")"

echo "--- GET /projects ---"
curl -s -H "authorization: Bearer $TOK" "http://localhost:$PORT/api/v1/projects" \
  | node -e '
    const d = JSON.parse(require("fs").readFileSync(0));
    console.log(JSON.stringify(d.map(p => ({
      name: p.name, key: p.project_key, repo: p.repo_url,
      turns: p.total_turns, devices: p.device_count,
    })), null, 2));
    const ok = d.length === 1 && d[0].device_count === 2 && d[0].total_turns === 5
      && d[0].project_key === "github.com/me/shared-demo";
    console.log(ok ? "\nRESULT: PASS ✅ (1 project, 2 devices, 5 turns, merged by remote)"
                   : "\nRESULT: FAIL ❌");
    process.exit(ok ? 0 : 1);
  '
RESULT=$?

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
rm -rf "$REPO_A" "$REPO_B" "$TA" "$TB" "$NODE_CFG" "$SH_CFG" "$DB"*
echo "=== exit $RESULT ==="
exit $RESULT
