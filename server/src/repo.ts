import {
  computeGhostScore,
  computeGhostTier,
  computeMaturityScore,
  computeMomentum,
  daysBetween,
  HEATMAP_DAYS,
  MS_PER_DAY,
  type EventPayload,
  type Project,
  type ProjectPatch,
  type ProjectSort,
  type Stats,
} from "@gph/shared";
import type { DB } from "./db.ts";

interface ProjectRow {
  id: number;
  project_key: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  path: string | null;
  first_seen_at: string;
  last_active_at: string;
  total_sessions: number;
  total_turns: number;
  maturity_score: number;
  completion_pct: number | null;
  pinned: number;
  archived: number;
}

/* ── Ingest ────────────────────────────────────────────────── */

/** All identity keys carried by a payload (primary first, deduped). */
function candidateKeys(payload: EventPayload): string[] {
  return [...new Set([payload.project.key, ...(payload.project.alt_keys ?? [])])];
}

/** Project ids in this user's space matching any of the given keys. */
function matchingProjectIds(db: DB, userId: number, keys: string[]): number[] {
  if (keys.length === 0) return [];
  const ph = keys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT project_id AS id FROM project_aliases
         WHERE user_id = ? AND alias_key IN (${ph})
       UNION
       SELECT id FROM projects
         WHERE user_id = ? AND project_key IN (${ph})`,
    )
    .all(userId, ...keys, userId, ...keys) as { id: number }[];
  return [...new Set(rows.map((r) => r.id))].sort((a, b) => a - b);
}

/** Fold loser projects into the survivor (oldest), preserving history. */
function mergeProjects(db: DB, survivorId: number, loserIds: number[]): void {
  for (const loser of loserIds) {
    const l = db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(loser) as ProjectRow;
    db.prepare("UPDATE events SET project_id = ? WHERE project_id = ?").run(
      survivorId,
      loser,
    );
    db.prepare(
      "UPDATE project_aliases SET project_id = ? WHERE project_id = ?",
    ).run(survivorId, loser);
    db.prepare(
      `UPDATE projects SET
         total_sessions = total_sessions + @s,
         total_turns = total_turns + @t,
         first_seen_at = MIN(first_seen_at, @first),
         last_active_at = MAX(last_active_at, @last),
         maturity_score = MAX(maturity_score, @mat),
         completion_pct = COALESCE(completion_pct, @comp),
         pinned = MAX(pinned, @pin),
         repo_url = COALESCE(repo_url, @repo)
       WHERE id = @id`,
    ).run({
      id: survivorId,
      s: l.total_sessions,
      t: l.total_turns,
      first: l.first_seen_at,
      last: l.last_active_at,
      mat: l.maturity_score,
      comp: l.completion_pct,
      pin: l.pinned,
      repo: l.repo_url,
    });
    db.prepare("DELETE FROM projects WHERE id = ?").run(loser);
  }
}

function isRemoteKey(key: string): boolean {
  return !key.startsWith("local:");
}

export function ingestEvent(
  db: DB,
  userId: number,
  payload: EventPayload,
): {
  project_id: number;
  last_active_at: string;
  total_turns: number;
  skipped?: boolean;
  updated?: boolean;
} {
  const nowIso = new Date().toISOString();
  const ts = payload.ts ?? nowIso;
  const turns = payload.metrics?.turns ?? 0;
  const isStart = payload.event_type === "session_start";
  const maturity = payload.maturity_signals
    ? computeMaturityScore(payload.maturity_signals)
    : null;
  const keys = candidateKeys(payload);

  const tx = db.transaction(() => {
    // Device upsert.
    db.prepare(
      `INSERT INTO devices (id, user_id, hostname, created_at, last_seen_at)
       VALUES (@id, @uid, @host, @now, @now)
       ON CONFLICT(id) DO UPDATE SET hostname = @host, last_seen_at = @now`,
    ).run({
      id: payload.device_id,
      uid: userId,
      host: payload.hostname ?? null,
      now: nowIso,
    });

    // Resolve project by any alias; merge if multiple matched.
    const matches = matchingProjectIds(db, userId, keys);

    // Scan idempotency (scan: events only — NOT normal hook sessions, whose
    // SessionStart/SessionEnd legitimately share a session_id). Re-scanning a
    // day REPLACES its value with the latest commit count instead of adding.
    const isScan = payload.session_id?.startsWith("scan:") ?? false;
    if (isScan && matches.length === 1) {
      const prior = db
        .prepare(
          "SELECT id, turns FROM events WHERE project_id = ? AND session_id = ? LIMIT 1",
        )
        .get(matches[0], payload.session_id) as
        | { id: number; turns: number }
        | undefined;
      if (prior) {
        const delta = turns - prior.turns;
        if (delta !== 0) {
          db.prepare("UPDATE events SET turns = ?, ts = ? WHERE id = ?").run(
            turns,
            ts,
            prior.id,
          );
          db.prepare(
            `UPDATE projects SET total_turns = total_turns + ?,
               last_active_at = MAX(last_active_at, ?) WHERE id = ?`,
          ).run(delta, ts, matches[0]);
        }
        const row = db
          .prepare(
            "SELECT last_active_at, total_turns FROM projects WHERE id = ?",
          )
          .get(matches[0]) as { last_active_at: string; total_turns: number };
        return {
          project_id: matches[0],
          updated: delta !== 0,
          skipped: delta === 0,
          ...row,
        };
      }
    }

    let projectId: number;
    if (matches.length === 0) {
      const info = db
        .prepare(
          `INSERT INTO projects
            (user_id, project_key, name, description, repo_url, path,
             first_seen_at, last_active_at, total_sessions, total_turns, maturity_score)
           VALUES (@uid, @key, @name, @desc, @repo, @path, @ts, @ts, @sessions, @turns, @maturity)`,
        )
        .run({
          uid: userId,
          key: payload.project.key,
          name: payload.project.name,
          desc: payload.project.description ?? null,
          repo: payload.project.repo_url ?? null,
          path: payload.project.path ?? null,
          ts,
          sessions: isStart ? 1 : 0,
          turns,
          maturity: maturity ?? 0,
        });
      projectId = Number(info.lastInsertRowid);
    } else {
      projectId = matches[0];
      if (matches.length > 1) mergeProjects(db, projectId, matches.slice(1));

      const current = db
        .prepare("SELECT project_key FROM projects WHERE id = ?")
        .get(projectId) as { project_key: string };
      // Promote a local primary key to the remote one when a remote appears.
      const promote =
        !isRemoteKey(current.project_key) && isRemoteKey(payload.project.key);

      db.prepare(
        `UPDATE projects SET
           project_key = @primaryKey,
           name = @name,
           description = COALESCE(@desc, description),
           repo_url = COALESCE(@repo, repo_url),
           path = COALESCE(@path, path),
           last_active_at = MAX(last_active_at, @ts),
           total_sessions = total_sessions + @sessionInc,
           total_turns = total_turns + @turns,
           maturity_score = COALESCE(@maturity, maturity_score)
         WHERE id = @id`,
      ).run({
        id: projectId,
        primaryKey: promote ? payload.project.key : current.project_key,
        name: payload.project.name,
        desc: payload.project.description ?? null,
        repo: payload.project.repo_url ?? null,
        path: payload.project.path ?? null,
        ts,
        sessionInc: isStart ? 1 : 0,
        turns,
        maturity,
      });
    }

    // Register every candidate key as an alias of this project.
    const upsertAlias = db.prepare(
      `INSERT INTO project_aliases (user_id, alias_key, project_id)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, alias_key) DO UPDATE SET project_id = excluded.project_id`,
    );
    for (const k of keys) upsertAlias.run(userId, k, projectId);

    db.prepare(
      `INSERT INTO events
         (project_id, device_id, event_type, session_id, ts, turns, duration_sec, files_changed, summary)
       VALUES (@pid, @dev, @type, @sid, @ts, @turns, @dur, @files, @summary)`,
    ).run({
      pid: projectId,
      dev: payload.device_id,
      type: payload.event_type,
      sid: payload.session_id ?? null,
      ts,
      turns,
      dur: payload.metrics?.duration_sec ?? 0,
      files: payload.metrics?.files_changed ?? 0,
      summary: payload.summary ?? null,
    });

    const row = db
      .prepare("SELECT last_active_at, total_turns FROM projects WHERE id = ?")
      .get(projectId) as { last_active_at: string; total_turns: number };
    return { project_id: projectId, ...row };
  });

  return tx();
}

/* ── Daily activity → momentum + contribution heatmap ──────── */

interface DailyMetrics {
  recent7d: number;
  peak7d: number;
  heatmap: { day: string; value: number }[]; // last HEATMAP_DAYS, oldest→newest
}

/** UTC date strings (YYYY-MM-DD) for the last n days, oldest → newest. */
function lastNDates(nowMs: number, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(nowMs - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return out;
}

/** Per-project daily turn totals → momentum and heatmap, in one query. */
function dailyMetricsMap(
  db: DB,
  userId: number,
  nowMs: number,
): Map<number, DailyMetrics> {
  const rows = db
    .prepare(
      `SELECT e.project_id AS pid, date(e.ts) AS day, SUM(e.turns) AS turns
       FROM events e JOIN projects p ON p.id = e.project_id
       WHERE p.user_id = ?
       GROUP BY e.project_id, date(e.ts)`,
    )
    .all(userId) as { pid: number; day: string; turns: number }[];

  const byProject = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const m = byProject.get(r.pid) ?? new Map<string, number>();
    m.set(r.day, r.turns);
    byProject.set(r.pid, m);
  }

  const dates = lastNDates(nowMs, HEATMAP_DAYS);
  const recentThreshold = nowMs - 7 * MS_PER_DAY;
  const out = new Map<number, DailyMetrics>();

  for (const [pid, dayMap] of byProject) {
    const days = [...dayMap.entries()].map(([day, turns]) => ({
      dayMs: Date.parse(day),
      turns,
    }));

    let recent7d = 0;
    for (const d of days) if (d.dayMs >= recentThreshold) recent7d += d.turns;

    // Peak rolling 7-day window anchored on each active day.
    let peak7d = 0;
    for (const anchor of days) {
      const end = anchor.dayMs + 7 * MS_PER_DAY;
      let sum = 0;
      for (const d of days) {
        if (d.dayMs >= anchor.dayMs && d.dayMs < end) sum += d.turns;
      }
      if (sum > peak7d) peak7d = sum;
    }

    const heatmap = dates.map((day) => ({ day, value: dayMap.get(day) ?? 0 }));
    out.set(pid, { recent7d, peak7d, heatmap });
  }
  return out;
}

/** Zero-filled heatmap for projects with no activity in the window. */
function emptyHeatmap(nowMs: number): { day: string; value: number }[] {
  return lastNDates(nowMs, HEATMAP_DAYS).map((day) => ({ day, value: 0 }));
}

function deviceCountMap(db: DB, userId: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT e.project_id AS pid, COUNT(DISTINCT e.device_id) AS c
       FROM events e JOIN projects p ON p.id = e.project_id
       WHERE p.user_id = ?
       GROUP BY e.project_id`,
    )
    .all(userId) as { pid: number; c: number }[];
  return new Map(rows.map((r) => [r.pid, r.c]));
}

function toView(
  row: ProjectRow,
  nowMs: number,
  daily: DailyMetrics | undefined,
  deviceCount: number,
): Project {
  const days = daysBetween(Date.parse(row.last_active_at), nowMs);
  return {
    id: row.id,
    project_key: row.project_key,
    name: row.name,
    description: row.description,
    repo_url: row.repo_url,
    first_seen_at: row.first_seen_at,
    last_active_at: row.last_active_at,
    total_sessions: row.total_sessions,
    total_turns: row.total_turns,
    maturity_score: row.maturity_score,
    completion_pct: row.completion_pct,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    device_count: deviceCount,
    days_since_active: Math.round(days * 10) / 10,
    ghost_tier: computeGhostTier(days),
    ghost_score: Math.round(computeGhostScore(days, row.total_turns) * 100) / 100,
    momentum: computeMomentum(daily?.recent7d ?? 0, daily?.peak7d ?? 0),
    heatmap: daily?.heatmap ?? emptyHeatmap(nowMs),
  };
}

/* ── Reads ─────────────────────────────────────────────────── */

export function listProjects(
  db: DB,
  userId: number,
  sort: ProjectSort,
  includeArchived: boolean,
): Project[] {
  const nowMs = Date.now();
  const rows = db
    .prepare("SELECT * FROM projects WHERE user_id = ?")
    .all(userId) as ProjectRow[];
  const daily = dailyMetricsMap(db, userId, nowMs);
  const devs = deviceCountMap(db, userId);

  let views = rows.map((r) =>
    toView(r, nowMs, daily.get(r.id), devs.get(r.id) ?? 0),
  );
  if (!includeArchived) views = views.filter((v) => !v.archived);

  const momRecent = (id: number) => daily.get(id)?.recent7d ?? 0;
  if (sort === "ghost") {
    views = views.filter(
      (v) => v.ghost_tier === "ghost" || v.ghost_tier === "buried",
    );
    views.sort(byPinned((a, b) => b.ghost_score - a.ghost_score));
  } else if (sort === "momentum") {
    views.sort(byPinned((a, b) => b.momentum - a.momentum));
  } else {
    // active: recent 7-day turns desc, tiebreak by recency
    views.sort(
      byPinned(
        (a, b) =>
          momRecent(b.id) - momRecent(a.id) ||
          Date.parse(b.last_active_at) - Date.parse(a.last_active_at),
      ),
    );
  }
  return views;
}

function byPinned(cmp: (a: Project, b: Project) => number) {
  return (a: Project, b: Project) =>
    Number(b.pinned) - Number(a.pinned) || cmp(a, b);
}

export function getProject(
  db: DB,
  userId: number,
  id: number,
): (Project & { activity: { day: string; turns: number }[]; recent_summary: string | null }) | null {
  const nowMs = Date.now();
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(id, userId) as ProjectRow | undefined;
  if (!row) return null;

  const daily = dailyMetricsMap(db, userId, nowMs).get(id);
  const devs = deviceCountMap(db, userId).get(id) ?? 0;
  const activity = db
    .prepare(
      `SELECT date(ts) AS day, SUM(turns) AS turns
       FROM events WHERE project_id = ? GROUP BY date(ts) ORDER BY day`,
    )
    .all(id) as { day: string; turns: number }[];
  const recent = db
    .prepare(
      `SELECT summary FROM events
       WHERE project_id = ? AND summary IS NOT NULL
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(id) as { summary: string } | undefined;

  return {
    ...toView(row, nowMs, daily, devs),
    activity,
    recent_summary: recent?.summary ?? null,
  };
}

export function patchProject(
  db: DB,
  userId: number,
  id: number,
  patch: ProjectPatch,
): Project | null {
  const owned = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!owned) return null;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  const map: Record<string, unknown> = {
    archived: patch.archived !== undefined ? Number(patch.archived) : undefined,
    pinned: patch.pinned !== undefined ? Number(patch.pinned) : undefined,
    completion_pct: patch.completion_pct,
    name: patch.name,
    description: patch.description,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = @${col}`);
      params[col] = val;
    }
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = @id`).run(
      params,
    );
  }

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  if (!row) return null;
  const nowMs = Date.now();
  return toView(
    row,
    nowMs,
    dailyMetricsMap(db, userId, nowMs).get(id),
    deviceCountMap(db, userId).get(id) ?? 0,
  );
}

export function getStats(db: DB, userId: number): Stats {
  const projects = listProjects(db, userId, "active", false);
  return {
    total_projects: projects.length,
    active: projects.filter(
      (p) => p.ghost_tier === "fresh" || p.ghost_tier === "cooling",
    ).length,
    ghosts: projects.filter((p) => p.ghost_tier === "ghost").length,
    buried: projects.filter((p) => p.ghost_tier === "buried").length,
  };
}
