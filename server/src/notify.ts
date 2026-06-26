import type { NotifyKind } from "@gph/shared";
import type { DB } from "./db.ts";
import {
  listProjects,
  getStats,
  dueNotificationConfigs,
  markDigestSent,
} from "./repo.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Digest {
  title: string;
  lines: string[];
}

/**
 * Build the weekly digest from current state: ghost counts, the most
 * regrettable (near-finished but abandoned) ghosts, and what's hottest now.
 * Returns null when the user has no projects worth reporting.
 */
export function buildDigest(db: DB, userId: number): Digest | null {
  const stats = getStats(db, userId);
  if (stats.total_projects === 0) return null;

  const regret = listProjects(db, userId, "regret", false).slice(0, 3);
  const active = listProjects(db, userId, "active", false).slice(0, 3);

  const lines: string[] = [
    `활성 ${stats.active} · 유령 ${stats.ghosts} · 무덤 ${stats.buried} (총 ${stats.total_projects})`,
  ];
  if (regret.length > 0) {
    lines.push("");
    lines.push("💔 가장 아까운 유령");
    for (const p of regret) {
      lines.push(
        `· ${p.name} — ${Math.round(p.days_since_active)}일 방치, 완성도 ${p.completion}%`,
      );
    }
  }
  if (active.length > 0) {
    lines.push("");
    lines.push("🔥 이번 주 가장 활발");
    for (const p of active) {
      lines.push(`· ${p.name} — ${p.total_turns} 턴`);
    }
  }
  return { title: "👻 Ghost Project Hunter 리포트", lines };
}

/** Webhook request body for the given channel (Slack & Discord differ). */
function digestBody(kind: NotifyKind, digest: Digest): unknown {
  const text = `${digest.title}\n${digest.lines.join("\n")}`;
  // Slack incoming webhooks read `text`; Discord webhooks read `content`.
  return kind === "slack" ? { text } : { content: text };
}

/**
 * POST a digest to the configured webhook. Throws on network/HTTP failure so the
 * caller can surface it (the "테스트 전송" button shows the error inline).
 */
export async function sendDigest(
  kind: NotifyKind,
  url: string,
  digest: Digest,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(digestBody(kind, digest)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`webhook HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Send the weekly digest to every config whose last send is ≥7 days old.
 * Failures are logged and skipped so one bad webhook can't stall the rest.
 * Returns the number of digests sent.
 */
export async function runDueDigests(db: DB, nowMs: number): Promise<number> {
  const due = dueNotificationConfigs(db, nowMs, WEEK_MS);
  let sent = 0;
  for (const cfg of due) {
    const digest = buildDigest(db, cfg.user_id);
    if (!digest) continue; // nothing to report yet
    try {
      await sendDigest(cfg.kind, cfg.webhook_url, digest);
      markDigestSent(db, cfg.user_id, new Date(nowMs).toISOString());
      sent++;
    } catch (err) {
      console.error(
        `[gph-server] digest send failed for user ${cfg.user_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return sent;
}

/**
 * Start the background digest scheduler: checks hourly for configs due a weekly
 * send. Returns a stop() to clear the timer (tests don't start it).
 */
export function startDigestScheduler(db: DB): () => void {
  const tick = () => {
    void runDueDigests(db, Date.now());
  };
  const timer = setInterval(tick, 60 * 60 * 1000); // hourly
  timer.unref?.(); // don't keep the process alive on its own
  return () => clearInterval(timer);
}
