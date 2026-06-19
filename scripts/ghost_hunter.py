#!/usr/bin/env python3
"""Ghost Project Hunter — cross-platform agent (Windows / macOS / Linux).

Pure Python 3 standard library (needs only `git` on PATH). Shares its config
dir (~/.config/ghost-hunter) with the Node and shell versions, so all three are
interchangeable.

  python ghost_hunter.py login <serverUrl> <token>   save server + token
  python ghost_hunter.py init                         install Claude Code hooks
  python ghost_hunter.py hook                         (called by Claude; reads stdin)
  python ghost_hunter.py log "<project>" "<summary>"  manual activity log
  python ghost_hunter.py scan [--days N] [--name X]   backfill past git commits
  python ghost_hunter.py flush                        send queued (offline) events
  python ghost_hunter.py status                       show config + server health

HARD RULE for `hook`: never block Claude — bounded timeouts, always exit 0,
queue to the outbox on failure.
"""
import json
import os
import re
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

POST_TIMEOUT = 1.5
GIT_TIMEOUT = 0.8
HEATMAP_DAYS = 30  # kept for parity; server owns the real window


# ── paths / config ───────────────────────────────────────────────────────────
def config_dir() -> Path:
    env = os.environ.get("GPH_CONFIG_DIR")
    if env:
        return Path(env)
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "ghost-hunter"


def config_path() -> Path:
    return config_dir() / "config.json"


def outbox_dir() -> Path:
    return config_dir() / "outbox"


def claude_settings_path() -> Path:
    return Path.home() / ".claude" / "settings.json"


def load_config():
    try:
        cfg = json.loads(config_path().read_text(encoding="utf-8"))
    except Exception:
        return None
    if not cfg.get("serverUrl") or not cfg.get("token"):
        return None
    cfg.setdefault("deviceId", str(uuid.uuid4()))
    cfg.setdefault("hostname", socket.gethostname())
    return cfg


def save_config(cfg: dict) -> None:
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = config_path()
    p.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(p, 0o600)  # best-effort; no-op semantics on Windows
    except OSError:
        pass


# ── git / collectors ─────────────────────────────────────────────────────────
def git(args, cwd, timeout=GIT_TIMEOUT):
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if out.returncode != 0:
            return None
        return out.stdout.strip()
    except Exception:
        return None


def normalize_repo_url(remote: str):
    s = (remote or "").strip()
    if not s:
        return None
    m = re.match(r"^[a-z]+://(?:[^@/]+@)?([^/]+)/(.+?)(?:\.git)?/?$", s, re.I)
    if not m:
        m = re.match(r"^(?:[^@]+@)?([^:]+):(.+?)(?:\.git)?/?$", s)
    if not m:
        return None
    host = m.group(1).lower()
    path = re.sub(r"^/+", "", m.group(2)).lower()
    return f"{host}/{path}"


def derive_project_identity(cwd: str) -> dict:
    abs_path = os.path.abspath(cwd)
    name = os.path.basename(abs_path) or abs_path
    local_key = f"local:{socket.gethostname()}:{abs_path}"
    remote = git(["remote", "get-url", "origin"], abs_path)
    remote_key = normalize_repo_url(remote) if remote else None
    if remote_key:
        return {
            "key": remote_key,
            "alt_keys": [local_key],
            "name": name,
            "path": abs_path,
            "repo_url": remote,
        }
    return {"key": local_key, "alt_keys": [], "name": name, "path": abs_path, "repo_url": None}


def count_turns(transcript_path) -> int:
    if not transcript_path or not os.path.isfile(transcript_path):
        return 0
    turns = 0
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    if json.loads(line).get("type") == "assistant":
                        turns += 1
                except Exception:
                    continue
    except Exception:
        return 0
    return turns


def files_changed(cwd: str) -> int:
    out = git(["status", "--porcelain"], cwd)
    if not out:
        return 0
    return len([ln for ln in out.splitlines() if ln.strip()])


def _exists(cwd, *names):
    return any((Path(cwd) / n).exists() for n in names)


def scan_maturity(cwd: str) -> dict:
    version = None
    has_tests = _exists(cwd, "test", "tests", "__tests__", "spec")
    pkg = Path(cwd) / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            version = data.get("version")
            if not has_tests and (data.get("scripts") or {}).get("test"):
                has_tests = True
        except Exception:
            pass
    tags = git(["tag"], cwd)
    return {
        "has_readme": _exists(cwd, "README.md", "README", "readme.md", "README.rst"),
        "has_tests": has_tests,
        "has_ci": _exists(cwd, ".github/workflows", ".gitlab-ci.yml", ".circleci"),
        "has_deploy": _exists(cwd, "Dockerfile", "vercel.json", "fly.toml", "netlify.toml", "Procfile"),
        "git_tags": len([t for t in tags.splitlines() if t.strip()]) if tags else 0,
        "version": version,
    }


def commits_by_day(cwd: str, since_days: int) -> dict:
    out = git(
        ["log", f"--since={since_days} days ago", "--date=short", "--pretty=%cd"],
        cwd,
        timeout=10,
    )
    counts: dict[str, int] = {}
    if out:
        for line in out.splitlines():
            day = line.strip()
            if day:
                counts[day] = counts.get(day, 0) + 1
    return counts


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── networking ───────────────────────────────────────────────────────────────
def _post(cfg, path, body, timeout):
    url = f"{cfg['serverUrl']}/api/v1{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg['token']}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()


def post_event(cfg, payload, timeout=POST_TIMEOUT) -> bool:
    try:
        status, _ = _post(cfg, "/events", payload, timeout)
        return 200 <= status < 300
    except Exception:
        return False


def post_bulk(cfg, events, timeout=30):
    try:
        status, raw = _post(cfg, "/events/bulk", {"events": events}, timeout)
        if not (200 <= status < 300):
            return None
        return json.loads(raw)
    except Exception:
        return None


def enqueue(payload) -> None:
    try:
        d = outbox_dir()
        d.mkdir(parents=True, exist_ok=True)
        fname = f"{int(datetime.now().timestamp())}-{uuid.uuid4()}.json"
        (d / fname).write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        pass


def flush_outbox(cfg, limit=1000) -> int:
    try:
        files = sorted(p for p in outbox_dir().glob("*.json"))[:limit]
    except Exception:
        return 0
    n = 0
    for f in files:
        try:
            payload = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            f.unlink(missing_ok=True)
            continue
        if post_event(cfg, payload):
            f.unlink(missing_ok=True)
            n += 1
        else:
            break
    return n


# ── payload ──────────────────────────────────────────────────────────────────
def build_payload(cfg, identity, event_type, *, turns=0, ts=None,
                  session_id=None, summary=None, name=None, maturity=None):
    return {
        "device_id": cfg["deviceId"],
        "hostname": cfg["hostname"],
        "event_type": event_type,
        "session_id": session_id,
        "ts": ts or now_iso(),
        "project": {
            "key": identity["key"],
            "alt_keys": identity["alt_keys"],
            "name": name or identity["name"],
            "path": identity["path"],
            "repo_url": identity["repo_url"],
        },
        "metrics": {"turns": turns, "duration_sec": 0, "files_changed": 0},
        "maturity_signals": maturity if maturity is not None else scan_maturity(identity["path"]),
        "summary": summary,
    }


# ── commands ─────────────────────────────────────────────────────────────────
def require_config():
    cfg = load_config()
    if not cfg:
        sys.stderr.write("Not configured. Run: ghost_hunter.py login <serverUrl> <token>\n")
        sys.exit(1)
    return cfg


def cmd_login(argv):
    if len(argv) < 2:
        sys.stderr.write("Usage: ghost_hunter.py login <serverUrl> <token>\n")
        sys.exit(1)
    existing = load_config() or {}
    cfg = {
        "serverUrl": argv[0].rstrip("/"),
        "token": argv[1],
        "deviceId": existing.get("deviceId") or str(uuid.uuid4()),
        "hostname": socket.gethostname(),
    }
    save_config(cfg)
    print(f"✓ Saved config to {config_path()}")
    print(f"  device: {cfg['hostname']} ({cfg['deviceId'][:8]}…)")


def cmd_init(argv):
    if not load_config():
        sys.stderr.write("Run 'ghost_hunter.py login <url> <token>' first.\n")
        sys.exit(1)
    script = os.path.abspath(__file__)
    command = f'"{sys.executable}" "{script}" hook'
    path = claude_settings_path()
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        settings = {}
    hooks = settings.setdefault("hooks", {})
    changed = False
    for event in ("SessionStart", "SessionEnd"):
        groups = hooks.setdefault(event, [])
        already = any(
            "ghost" in (h.get("command", ""))
            for g in groups
            for h in g.get("hooks", [])
        )
        if not already:
            groups.append({"hooks": [{"type": "command", "command": command, "timeout": 2}]})
            changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        print(f"✓ Installed SessionStart/SessionEnd hooks in {path}")
    else:
        print(f"• Claude hooks already present in {path}")
    print("\nDone. New Claude Code sessions will now report activity. \U0001f47b")


def cmd_hook(argv):
    # Watchdog: guarantee we never exceed the hook budget.
    threading.Timer(1.8, lambda: os._exit(0)).start()
    try:
        cfg = load_config()
        if not cfg:
            return
        raw = "" if sys.stdin.isatty() else sys.stdin.read()
        data = {}
        if raw.strip():
            try:
                data = json.loads(raw)
            except Exception:
                data = {}
        cwd = data.get("cwd") or os.getcwd()
        identity = derive_project_identity(cwd)
        event_type = "session_start" if data.get("hook_event_name") == "SessionStart" else "session_end"
        turns = count_turns(data.get("transcript_path")) if event_type == "session_end" else 0
        payload = build_payload(
            cfg, identity, event_type,
            turns=turns, session_id=data.get("session_id"),
        )
        payload["metrics"]["files_changed"] = files_changed(cwd)
        flush_outbox(cfg, 10)
        if not post_event(cfg, payload):
            enqueue(payload)
    except Exception:
        pass
    finally:
        os._exit(0)


def cmd_log(argv):
    cfg = require_config()
    identity = derive_project_identity(os.getcwd())
    name = argv[0] if argv else identity["name"]
    summary = argv[1] if len(argv) > 1 else None
    payload = build_payload(cfg, identity, "session_end", turns=1, name=name, summary=summary)
    if post_event(cfg, payload):
        print(f'✓ Logged "{name}"')
    else:
        print("✗ Server unreachable")
        sys.exit(1)


def cmd_scan(argv):
    cfg = require_config()
    days, name = 365, None
    i = 0
    while i < len(argv):
        if argv[i] == "--days" and i + 1 < len(argv):
            days = int(argv[i + 1]); i += 2
        elif argv[i] == "--name" and i + 1 < len(argv):
            name = argv[i + 1]; i += 2
        else:
            i += 1
    cwd = os.getcwd()
    identity = derive_project_identity(cwd)
    name = name or identity["name"]
    by_day = commits_by_day(cwd, days)
    if not by_day:
        sys.stderr.write("No commits found (not a git repo, or none in range).\n")
        sys.exit(1)
    maturity = scan_maturity(cwd)
    total = sum(by_day.values())
    events = [
        build_payload(
            cfg, identity, "session_end",
            turns=count, ts=f"{day}T12:00:00Z",
            session_id=f"scan:{day}", name=name,
            summary=f"{count} commit(s) (scan)", maturity=maturity,
        )
        for day, count in sorted(by_day.items())
    ]
    result = post_bulk(cfg, events)
    if result:
        print(
            f'✓ Scanned "{name}": {len(by_day)} active days, {total} commits over {days}d '
            f"({result['ingested']} new, {result['updated']} updated, {result['skipped']} unchanged)"
        )
    else:
        for ev in events:
            enqueue(ev)
        print(f"• Server unreachable — queued {len(events)} day(s) to outbox (run 'flush' later)")


def cmd_flush(argv):
    cfg = require_config()
    print(f"✓ Flushed {flush_outbox(cfg)} queued event(s)")


def cmd_status(argv):
    cfg = load_config()
    if not cfg:
        print("Not configured. Run: ghost_hunter.py login <serverUrl> <token>")
        return
    try:
        queued = len(list(outbox_dir().glob("*.json")))
    except Exception:
        queued = 0
    print(f"server:  {cfg['serverUrl']}")
    print(f"device:  {cfg['hostname']} ({cfg['deviceId'][:8]}…)")
    print(f"token:   {cfg['token'][:4]}…")
    print(f"outbox:  {queued} queued")
    try:
        req = urllib.request.Request(f"{cfg['serverUrl']}/api/v1/health")
        with urllib.request.urlopen(req, timeout=3) as resp:
            print(f"health:  {'ok ✓' if resp.status == 200 else f'HTTP {resp.status}'}")
    except Exception:
        print("health:  unreachable ✗")


def usage():
    sys.stderr.write(
        "usage: ghost_hunter.py {login|init|hook|log|scan|flush|status}\n"
    )


def main():
    # Windows consoles (cp949/cp1252) choke on ✓/👻 — force safe UTF-8 output.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    argv = sys.argv[1:]
    cmd = argv[0] if argv else ""
    rest = argv[1:]
    handlers = {
        "login": cmd_login, "init": cmd_init, "hook": cmd_hook,
        "log": cmd_log, "scan": cmd_scan, "flush": cmd_flush, "status": cmd_status,
    }
    handler = handlers.get(cmd)
    if not handler:
        usage()
        sys.exit(1)
    handler(rest)


if __name__ == "__main__":
    main()
