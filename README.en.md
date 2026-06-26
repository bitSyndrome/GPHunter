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
- **Ghost leaderboard** — four sorts: 🏆 Most Active / 👻 Most Haunted /
  💔 Most Regrettable / 🔥 Momentum.
- **💔 Most Regrettable** — surfaces ghosts that were nearly finished when
  abandoned. Weights the ghost score by completion
  (`ghost_score × (0.25 + 0.75 × completion/100)`).
- **Revive / Retire** — act straight from the card. **Revive** copies a
  `cd <path> && claude` jump-back command (un-archives if retired); **Retire**
  lays the project to rest with a one-line epitaph.
- **🤖 AI memory-aid (optional)** — summarizes "what you were doing + the next
  step" from recent session notes. **Provider-agnostic** — any OpenAI-compatible
  endpoint (Claude, OpenAI, Gemini, Ollama) works by config alone. On demand
  (only calls the LLM when you click).
- **🔔 Slack/Discord notifications (optional)** — paste a webhook URL on the home
  page to get a weekly ghost report. The channel is auto-detected from the URL.
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
  infrastructure. AI and notifications stay off without a key/webhook, so the
  base setup remains trivial.

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

### Method C — Windows (one-line PowerShell, recommended)

The server ships a PowerShell installer that does a global install: it downloads
the Python agent to `%USERPROFILE%\ghost-hunter` and creates a
`%USERPROFILE%\bin\ghost-hunter.cmd` wrapper on PATH. (`$env:AGENT="node"` to use
the Node bundle.)

```powershell
irm http://<host>:8787/api/v1/install.ps1 | iex
# open a NEW terminal, then:
ghost-hunter login http://<host>:8787 <token>
ghost-hunter init
```

Manual alternative — grab the Python agent and run it (stdlib only, needs `git`).
The Hook embeds absolute interpreter + script paths, so no PATH setup is needed.

```bash
python scripts/ghost_hunter.py login http://localhost:8787 <token>
python scripts/ghost_hunter.py init
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
  - 💔 **Most Regrettable** — ghost tier and above, by **completion-weighted**
    regret score (nearly-finished-but-abandoned projects rise to the top).
  - 🔥 **Momentum** — by activity momentum.
- **Ghost tiers** (time since last activity — shown on cards as a Material icon + label)
  | Tier | Threshold |
  |---|---|
  | 🔥 Fresh | < 3 days |
  | ❄️ Cooling | 3 – 14 days |
  | 👻 Haunting | 14 – 30 days |
  | 🪦 Buried | 30+ days |
- **Gauges**
  - **Momentum** — last-7-day activity ÷ the project's own peak 7-day activity
    (0–100%).
  - **Maturity** — README/tests/CI/deploy-config/tags/version heuristic (0–100%).
    A manual completion value overrides it.
- **Contribution heatmap** — each card's `HeatMap` grid (last 30 days, oldest→
  newest wrapping every 10 cells); shaded in 5 levels by daily turns (GitHub-style).
- **Actions** — top-right of each card (always visible):
  - 📌 **Pin** — keep on top regardless of sort.
  - ↩️ **Revive** — copy a `cd <path> && claude` jump-back command (un-archives if
    retired). For reopening a ghost to continue working.
  - 👋 **Retire** — lay it to rest with a one-line epitaph (archive). Retired cards
    show `🪦 <epitaph>` below.
- **Detail panel** (click the title) — sparkline · recent session summary · manual
  completion · **🤖 AI memory-aid** (generate/regenerate → "what you were doing +
  next step").
- **Notification settings** — the 🔔 button in the header configures the
  Slack/Discord webhook (see below).

> UI icons are unified on Google **Material Symbols** (Rounded).

---

## 🤖 AI memory-aid (optional)

Helps you recall "what was I doing?" when you reopen an abandoned project. It
generates a **one-line summary + next step** from recent session notes. It is
**on demand** (only calls the LLM when you click the button in the detail panel),
keeping cost minimal.

**Provider-agnostic** — any OpenAI-compatible `/chat/completions` endpoint works
by changing config in `.env`. Without a key the feature is off (503).

```ini
# Anthropic Claude (default)
GPH_LLM_BASE_URL=https://api.anthropic.com/v1
GPH_LLM_MODEL=claude-haiku-4-5
# Google Gemini (OpenAI-compatible endpoint)
#   GPH_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
#   GPH_LLM_MODEL=gemini-2.5-flash
# OpenAI: https://api.openai.com/v1 (gpt-4o-mini) · Ollama: http://localhost:11434/v1
GPH_LLM_API_KEY=             # blank = disabled
```

> Verify your config with a single live call:
> `node --env-file=.env --experimental-strip-types scripts/llm-smoke.ts`

---

## 🔔 Notifications — Slack / Discord (optional)

Click the **🔔 Notification settings** button in the dashboard header and paste a
webhook URL. The channel kind is **auto-detected** from the URL (Slack
`hooks.slack.com` / Discord `discord.com/api/webhooks`).

- **Save / Send test / Delete** in one modal. "Send test" posts to the channel
  immediately, even before saving.
- **Weekly report** — active/ghost/buried counts, 💔 top-3 most regrettable ghosts,
  🔥 hottest this week. Sent every 7 days by the server scheduler.
- Config is stored per user in the DB. Nothing is sent without a webhook.

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
- **Canonical keys** — local keys are canonicalized server-side at ingestion so the
  same folder never splits (regardless of agent implementation or version):
  - Windows paths are **case-insensitive** with unified separators (`\`) and no
    trailing slash (`D:\Proj\Foo` = `d:/proj/foo/`), and the host is lowercased.
    POSIX paths keep their case.
  - A **backfill migration** at server startup also merges duplicates that were
    split before canonicalization existed (idempotent — it cleans up legacy data
    retroactively).

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
- [x] 💔 Most Regrettable sort · revive/retire actions
- [x] Transcript AI summary (multi-LLM — Claude/OpenAI/Gemini/Ollama)
- [x] Slack/Discord weekly digest notifications
- [ ] Deployment (Docker/Fly.io + persistent volume + HTTPS) — deferred
- [ ] Token issuance UX

---

> Top principle: **the Hook must never block Claude** (timeouts · always exit 0 ·
> outbox queue on failure).
