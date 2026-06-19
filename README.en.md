# 👻 Ghost Project Hunter

> **🌐 Language:** English · [한국어](README.md)

> Track the **forgotten "ghost projects"** among the many you spin up with AI
> coding tools (Claude Code) — on a game-style leaderboard.

AI makes it trivial to start projects, but just as many get abandoned and
forgotten. Ghost Project Hunter **automatically collects Claude Code session
activity via Hooks** and shows, on a single screen, which projects are alive and
which are dangerously abandoned — ranked.

![Ghost Project Hunter dashboard](docs/dashboard.png)

---

## ✨ Features

- **Automatic collection** — Claude Code `SessionStart`/`SessionEnd` Hooks
  capture activity with zero manual input. (Both a Node CLI and a pure shell
  agent are provided.)
- **Ghost leaderboard** — three sorts: 🏆 Most Active / 👻 Most Haunted /
  🔥 Momentum.
- **Contribution heatmap** — a GitHub-style last-30-days grid on every card; the
  more you work (turns) in a day, the darker the cell.
- **Investment-weighted ghost score** — a long-loved-but-dropped project ranks
  as a more dangerous ghost than a throwaway. (`days_idle × log10(turns + 10)`)
- **Multi-device sync** — laptop and desktop working the same git repo **merge
  into one project automatically**. Adding a git remote later does not break the
  history (alias merge).
- **Failure isolation** — the Hook uses timeouts, always `exit 0`, and offline
  queuing so it **never blocks Claude**.
- **Lightweight install** — the database is a single SQLite file. No extra
  infrastructure.

---

## 🏗 How it works

```
[Claude Code]
   │ Hook(SessionStart/End) → stdin JSON (cwd, transcript_path, …)
   ▼
[ghost-hunter agent]  (Node CLI or shell)
   │ derive project key from normalized git remote · collect turns/changes/maturity
   │ POST /api/v1/events (Bearer token), queue to outbox on failure
   ▼
[API server: Node + Express + SQLite]   ← many devices post to one server
   │ project upsert (alias merge) · ghost-score / momentum computation
   ▼
[Dashboard: React + Vite + Tailwind]   ← leaderboard
```

Workspace layout:

| Workspace | Description |
|---|---|
| `shared` (`@gph/shared`) | Event zod schema + ghost-score/momentum/maturity pure logic (single source) |
| `server` (`@gph/server`) | Express + SQLite API (`/api/v1/...`) |
| `cli` (`ghost-hunter`) | Claude Code Hook agent + install CLI |
| `web` (`@gph/web`) | React leaderboard dashboard |

> Design details: [plan.md](plan.md) · progress checklist: [checklist.md](checklist.md).

---

## 🚀 Quick start

### Requirements
- Node.js **20+** (Node 22 recommended — uses native TypeScript execution)
- git (used for project identity and maturity signals)

### 1) Install & build

```bash
git clone <repo> && cd GPHunter
npm install            # install all workspaces
npm run build:shared   # build the shared package (other packages depend on it)
```

### 2) Configure (`.env`)

```bash
cp .env.example .env
```

At minimum, change the token (this value is the auth secret):

```ini
GPH_SEED_TOKEN=your-random-string   # generate with: openssl rand -hex 32
PORT=8787            # API port
WEB_PORT=5273        # dashboard port
GPH_HOST=0.0.0.0     # 0.0.0.0 = reachable from other PCs
GPH_DB_PATH=./data/gph.sqlite
```

See [.env.example](.env.example) for all options.

### 3) Run the server

```bash
npm run start          # start both api + web in the background
npm run status         # show running state + access URLs
```

Example `npm run status` output:

```
api:  http://localhost:8787   (LAN: http://192.168.0.142:8787)
web:  http://localhost:5273   (LAN: http://192.168.0.142:5273)
```

Open the dashboard (`http://localhost:5273`) and enter your `GPH_SEED_TOKEN` in
the token field to sign in.

---

## 📡 Activity collection (client)

For data to appear, install the **agent** on the machine you work on. Pick any
method below — they share the config dir (`~/.config/ghost-hunter`), so they are
interchangeable.

> 💡 **Easiest**: click **📥 에이전트 설치 (Install agent)** in the dashboard
> header for copy-paste commands with your server URL filled in. The server hosts
> the agent scripts, so any machine can `curl` and run them:
>
> ```bash
> # Global install (to ~/.local/bin/ghost-hunter, macOS/Linux)
> curl -fsSL http://<host>:8787/api/v1/install.sh | sh
> #   Python:  ... | AGENT=py sh     custom dir:  ... | BIN=/usr/local/bin sh
>
> # Or grab a file and run it directly
> curl -O http://<host>:8787/api/v1/agent/ghost_hunter.py     # Python (incl. Windows)
> curl -O http://<host>:8787/api/v1/agent/ghost-hunter.cjs    # Node single file
> ```
> (The Node single file must be pre-built via `npm run build:agent`.)

### Method A — Node CLI (global command)

```bash
cd cli && npm link        # register ghost-hunter, ghost-hunter-hook on PATH
                          # (for distribution: npm i -g ghost-hunter)
cd ..

ghost-hunter login http://localhost:8787 <token>   # save server/token per device
ghost-hunter init                                  # inject Claude Code Hooks
ghost-hunter status                                # verify connection
```

### Method B — pure shell (no Node required, macOS/Linux)

Works with just `curl` + `git`, and embeds an **absolute path** in the Hook so no
PATH setup is needed (more robust under fnm/nvm version switching).

```bash
scripts/ghost-hunter.sh login http://localhost:8787 <token>
scripts/ghost-hunter.sh init     # merges into settings.json if jq is available
scripts/ghost-hunter.sh status
```

### Method C — Python (cross-platform, incl. Windows)

Python 3 standard library only (no extra install); needs just `git`.
**Recommended on Windows.** The Hook embeds the absolute interpreter + script
paths, so no PATH setup is needed.

```bash
python scripts/ghost_hunter.py login http://localhost:8787 <token>
python scripts/ghost_hunter.py init      # inject Hooks into ~/.claude/settings.json
python scripts/ghost_hunter.py status
```

> All three agents (Node / shell / Python) share the same config dir
> (`~/.config/ghost-hunter`) and project-key rules, so they interoperate freely.

> After setup, every Claude Code session you open and close reports activity
> automatically. Even if the server is down, events queue in the outbox and are
> sent on the next run.

### Manual logging (one-off, no Hook)

```bash
ghost-hunter log "project-name" "what you did"        # based on current folder
# or
scripts/ghost-hunter.sh log "project-name" "what you did"
```

---

## 📊 Using the dashboard

- **Sort tabs**
  - 🏆 **Most Active** — most activity (turns) in the last 7 days.
  - 👻 **Most Haunted** — ghost tier and above, by ghost score.
  - 🔥 **Momentum** — by activity momentum.
- **Ghost tiers** (time since last activity)
  | Tier | Threshold |
  |---|---|
  | 🔥 Fresh | < 3 days |
  | 🌤 Cooling | 3 – 14 days |
  | 👻 Haunting | 14 – 30 days |
  | 🪦 Buried | 30+ days |
- **Gauges**
  - **Momentum** — last-7-day activity ÷ the project's own peak 7-day activity
    (0–100%).
  - **Maturity** — README/tests/CI/deploy-config/tags/version heuristic (0–100%).
    A manual completion value overrides it.
- **Contribution heatmap** — a last-30-days grid (week columns × weekday rows)
  on each card; shaded in 5 levels by daily turns (GitHub-style).
- **Actions** — hover a card for 📌 pin / 🗄 archive; click the title for details
  (sparkline, recent summary, manual completion).

---

## 🔗 Multi-device sync

The Hook always sends **both a local and a remote key**.

- Local key: `local:<host>:<abs-path>` (always present, machine-scoped)
- Remote key: normalized `git remote get-url origin` → `github.com/user/repo`
  (preferred when present)

The server identifies the same project by any key.

- Two devices on the **same remote** → merged into one project, `device_count`
  increases.
- Start local, **add a remote later** → the local alias finds the existing
  project and the primary key is promoted to the remote (history preserved).
- Two projects split across keys get **auto-merged** when linked (summed, then
  cleaned up).

---

## 🌐 External access

Both api and web bind to `0.0.0.0`, so other PCs on the same network can connect.

- Dashboard: from an external browser, `http://<host-ip>:5273`
- Agent on an external PC: `ghost-hunter login http://<host-ip>:8787 <token>`

If it does not connect, open the ports in the host **firewall**:

```bash
sudo ufw allow 5273/tcp && sudo ufw allow 8787/tcp
```

---

## 🧰 Command reference

### Server management (`npm run …` = `scripts/dev.sh`)

```bash
npm run start          # start api + web
npm run stop           # stop both
npm run restart        # restart (no port conflicts)
npm run status         # state + LAN URLs
npm run logs api       # tail logs (api | web)
```

Per-service: `npm run start -- web`, `npm run restart -- api`, etc.
PIDs/logs are stored in `.run/`.

### Agent (`ghost-hunter` / `scripts/ghost-hunter.sh`)

```
login <serverUrl> <token>   save server + token (per device)
init                        install Claude Code Hooks
hook                        (called by Claude — reads events from stdin)
log "<project>" "<summary>" manual activity log
scan [--days N] [--name X]  backfill past git commits as activity (default 365d)
flush                       send queued offline events
status                      config + server health
```

> **Backfill existing projects**: run `ghost-hunter scan` in a repo that already
> has commits to fill the contribution heatmap from git history. Each day is keyed
> by `scan:<date>`, so re-running is **safe** — and if a day gains more commits, a
> re-scan **updates** that day to the latest count (no double counting).

---

## 🧪 Development

```bash
npm test                       # shared pure-logic tests
npm run dev -w server          # API hot reload
npm run dev -w web             # dashboard hot reload
node --test --experimental-strip-types \
  shared/src/index.test.ts server/src/app.test.ts cli/src/collect.test.ts
```

Script verification:

```bash
bash scripts/e2e-mixed.sh      # shell + Node mixed multi-device merge E2E
```

The server runs without a build step via Node native TypeScript execution
(`--experimental-strip-types`); only `shared` is built to `dist` for the other
workspaces to import.

---

## 🔐 Security notes

- The token is a **shared secret**. For external/LAN sharing, use a long random
  value and keep it only in `.env` (gitignored).
- `/api/v1/events` is protected by an in-memory token-bucket rate limit
  (`GPH_RATE_CAPACITY`/`GPH_RATE_REFILL`).
- When exposing to the internet, put **HTTPS** in front via a reverse proxy
  (deployment phase).

---

## 🗺 Roadmap

- [x] Backend/DB · CLI Hook (Node + shell) · leaderboard UI · multi-device merge
  (MVP done)
- [ ] Deployment (Docker/Fly.io + persistent volume + HTTPS) — deferred
- [ ] Token issuance UX · transcript AI summary · Gemini CLI adapter

---

> Top principle: **the Hook must never block Claude** (timeouts · always exit 0 ·
> outbox queue on failure).
