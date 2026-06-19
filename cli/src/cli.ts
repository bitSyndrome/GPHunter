#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  saveConfig,
  makeConfig,
  configPath,
  outboxDir,
} from "./config.ts";
import {
  deriveProjectIdentity,
  scanMaturity,
  commitsByDay,
} from "./collect.ts";
import { postEvent, postBulk, enqueue, flushOutbox } from "./send.ts";
import type { EventPayload } from "@gph/shared";

const HOOK_COMMAND = "ghost-hunter-hook";
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

/** Idempotently add SessionStart/SessionEnd hooks to Claude settings.json. */
function injectClaudeHooks(): boolean {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8"));
  } catch {
    /* fresh settings */
  }
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;
  let changed = false;

  for (const event of ["SessionStart", "SessionEnd"]) {
    const groups = (hooks[event] ??= []) as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    const already = groups.some((g) =>
      g.hooks?.some((h) => h.command?.includes(HOOK_COMMAND)),
    );
    if (!already) {
      groups.push({ hooks: [{ command: HOOK_COMMAND, type: "command", timeout: 2 } as never] });
      changed = true;
    }
  }

  if (changed) {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  }
  return changed;
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error(
      "Not configured. Run: ghost-hunter login <serverUrl> <token>",
    );
    process.exit(1);
  }
  return cfg;
}

async function cmdLogin(args: string[]): Promise<void> {
  const [serverUrl, token] = args;
  if (!serverUrl || !token) {
    console.error("Usage: ghost-hunter login <serverUrl> <token>");
    process.exit(1);
  }
  const cfg = makeConfig(serverUrl, token);
  saveConfig(cfg);
  console.log(`✓ Saved config to ${configPath()}`);
  console.log(`  device: ${cfg.hostname} (${cfg.deviceId.slice(0, 8)}…)`);
}

async function cmdInit(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  if (flags.server && flags.token) {
    saveConfig(makeConfig(flags.server, flags.token));
    console.log(`✓ Saved config to ${configPath()}`);
  } else if (!loadConfig()) {
    console.error(
      "No config yet. Run: ghost-hunter init --server <url> --token <token>",
    );
    process.exit(1);
  }
  const changed = injectClaudeHooks();
  console.log(
    changed
      ? `✓ Installed SessionStart/SessionEnd hooks in ${CLAUDE_SETTINGS}`
      : `• Claude hooks already present in ${CLAUDE_SETTINGS}`,
  );
  console.log("\nDone. New Claude Code sessions will now report activity. 👻");
}

async function cmdLog(args: string[]): Promise<void> {
  const cfg = requireConfig();
  const cwd = process.cwd();
  const identity = deriveProjectIdentity(cwd);
  const name = args[0] || identity.name;
  const summary = args[1];
  const payload: EventPayload = {
    device_id: cfg.deviceId,
    hostname: cfg.hostname,
    event_type: "session_end",
    ts: new Date().toISOString(),
    project: {
      key: identity.key,
      alt_keys: identity.altKeys,
      name,
      path: identity.path,
      repo_url: identity.repo_url,
    },
    metrics: { turns: 1, duration_sec: 0, files_changed: 0 },
    maturity_signals: scanMaturity(cwd),
    summary,
  };
  const ok = await postEvent(cfg, payload);
  console.log(ok ? `✓ Logged "${name}"` : "✗ Server unreachable (not queued)");
  process.exit(ok ? 0 : 1);
}

async function cmdScan(args: string[]): Promise<void> {
  const cfg = requireConfig();
  const flags = parseFlags(args);
  const days = Number(flags.days ?? 365);
  const cwd = process.cwd();
  const identity = deriveProjectIdentity(cwd);
  const name = flags.name || identity.name;

  const byDay = commitsByDay(cwd, days);
  if (byDay.size === 0) {
    console.error("No commits found (not a git repo, or none in range).");
    process.exit(1);
  }

  const maturity = scanMaturity(cwd);
  const events: EventPayload[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({
      device_id: cfg.deviceId,
      hostname: cfg.hostname,
      event_type: "session_end",
      session_id: `scan:${day}`, // idempotency key (re-run safe)
      ts: `${day}T12:00:00Z`,
      project: {
        key: identity.key,
        alt_keys: identity.altKeys,
        name,
        path: identity.path,
        repo_url: identity.repo_url,
      },
      metrics: { turns: count, duration_sec: 0, files_changed: 0 },
      maturity_signals: maturity,
      summary: `${count} commit(s) (scan)`,
    }));

  const totalCommits = [...byDay.values()].reduce((a, b) => a + b, 0);
  const result = await postBulk(cfg, events);
  if (result) {
    console.log(
      `✓ Scanned "${name}": ${byDay.size} active days, ${totalCommits} commits over ${days}d ` +
        `(${result.ingested} new, ${result.skipped} already recorded)`,
    );
  } else {
    for (const ev of events) enqueue(ev);
    console.log(
      `• Server unreachable — queued ${events.length} day(s) to outbox (run 'ghost-hunter flush' later)`,
    );
  }
}

async function cmdFlush(): Promise<void> {
  const cfg = requireConfig();
  const n = await flushOutbox(cfg, 1000);
  console.log(`✓ Flushed ${n} queued event(s)`);
}

async function cmdStatus(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log("Not configured. Run: ghost-hunter login <serverUrl> <token>");
    return;
  }
  let queued = 0;
  try {
    queued = fs.readdirSync(outboxDir()).filter((f) => f.endsWith(".json")).length;
  } catch {
    /* none */
  }
  console.log(`server:  ${cfg.serverUrl}`);
  console.log(`device:  ${cfg.hostname} (${cfg.deviceId.slice(0, 8)}…)`);
  console.log(`token:   ${cfg.token.slice(0, 4)}…`);
  console.log(`outbox:  ${queued} queued`);
  try {
    const res = await fetch(`${cfg.serverUrl}/api/v1/health`);
    console.log(`health:  ${res.ok ? "ok ✓" : `HTTP ${res.status}`}`);
  } catch {
    console.log("health:  unreachable ✗");
  }
}

function usage(): void {
  console.log(`ghost-hunter — track your AI ghost projects

Usage:
  ghost-hunter login <serverUrl> <token>   Save server + token for this device
  ghost-hunter init [--server u --token t] Install Claude Code hooks
  ghost-hunter log "<project>" "<summary>" Manually log activity from cwd
  ghost-hunter scan [--days N] [--name X]  Backfill past git commits as activity
  ghost-hunter flush                       Send queued (offline) events
  ghost-hunter status                      Show config + server health`);
}

const [cmd, ...rest] = process.argv.slice(2);
const run =
  cmd === "login"
    ? cmdLogin(rest)
    : cmd === "init"
      ? cmdInit(rest)
      : cmd === "log"
        ? cmdLog(rest)
        : cmd === "scan"
          ? cmdScan(rest)
          : cmd === "flush"
          ? cmdFlush()
          : cmd === "status"
            ? cmdStatus()
            : (usage(), Promise.resolve());

run.catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
