import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { EventPayload } from "@gph/shared";
import { type CliConfig, outboxDir } from "./config.ts";

const POST_TIMEOUT_MS = 1500;

/** POST one event. Returns true on 2xx, false on any failure (never throws). */
export async function postEvent(
  cfg: CliConfig,
  payload: EventPayload,
): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.serverUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** POST many events at once (scan backfill). Longer timeout than a hook. */
export async function postBulk(
  cfg: CliConfig,
  events: EventPayload[],
): Promise<{ ingested: number; updated: number; skipped: number } | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await fetch(`${cfg.serverUrl}/api/v1/events/bulk`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ events }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      ingested: number;
      updated: number;
      skipped: number;
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Persist a payload to the outbox for a later flush. */
export function enqueue(payload: EventPayload): void {
  try {
    const dir = outboxDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
  } catch {
    /* outbox best-effort */
  }
}

/**
 * Try to flush queued events. Stops at the first failure (server likely still
 * down) to stay within the hook's time budget. Returns count flushed.
 */
export async function flushOutbox(cfg: CliConfig, max = 20): Promise<number> {
  let files: string[];
  try {
    files = fs
      .readdirSync(outboxDir())
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(0, max);
  } catch {
    return 0;
  }

  let flushed = 0;
  for (const f of files) {
    const full = path.join(outboxDir(), f);
    let payload: EventPayload;
    try {
      payload = JSON.parse(fs.readFileSync(full, "utf8")) as EventPayload;
    } catch {
      fs.rmSync(full, { force: true }); // drop corrupt entry
      continue;
    }
    const ok = await postEvent(cfg, payload);
    if (!ok) break;
    fs.rmSync(full, { force: true });
    flushed++;
  }
  return flushed;
}
