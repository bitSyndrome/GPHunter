#!/usr/bin/env node
/**
 * Claude Code hook entrypoint.
 *
 * HARD RULE: never block or fail Claude.
 *  - global watchdog forces exit(0) before the 2s hook budget
 *  - every step is wrapped; all failures are swallowed
 *  - unreachable server -> enqueue to outbox, exit 0
 */
import { loadConfig } from "./config.ts";
import {
  deriveProjectIdentity,
  countTurns,
  filesChanged,
  scanMaturity,
} from "./collect.ts";
import { postEvent, enqueue, flushOutbox } from "./send.ts";
import type { EventPayload, EventType } from "@gph/shared";

// Watchdog: guarantee we never exceed the hook budget.
const watchdog = setTimeout(() => process.exit(0), 1800);
watchdog.unref();

interface HookInput {
  hook_event_name?: string;
  cwd?: string;
  session_id?: string;
  transcript_path?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const t = setTimeout(() => resolve(data), 300);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function mapEventType(name: string | undefined): EventType {
  return name === "SessionStart" ? "session_start" : "session_end";
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return; // not configured -> no-op

  let input: HookInput = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw) as HookInput;
  } catch {
    /* ignore bad input */
  }

  const cwd = input.cwd ?? process.cwd();
  const identity = deriveProjectIdentity(cwd);
  const eventType = mapEventType(input.hook_event_name);

  const payload: EventPayload = {
    device_id: cfg.deviceId,
    hostname: cfg.hostname,
    event_type: eventType,
    session_id: input.session_id,
    ts: new Date().toISOString(),
    project: {
      key: identity.key,
      alt_keys: identity.altKeys,
      name: identity.name,
      path: identity.path,
      repo_url: identity.repo_url,
    },
    metrics: {
      turns: eventType === "session_end" ? countTurns(input.transcript_path) : 0,
      duration_sec: 0,
      files_changed: filesChanged(cwd),
    },
    maturity_signals: scanMaturity(cwd),
  };

  // Opportunistically drain the outbox, then send the current event.
  await flushOutbox(cfg, 10);
  const ok = await postEvent(cfg, payload);
  if (!ok) enqueue(payload);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
