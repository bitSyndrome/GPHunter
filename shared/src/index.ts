import { z } from "zod";

/* ────────────────────────────────────────────────────────────
 * Ghost Project Hunter — shared contracts & pure logic
 * Single source of truth for: event schema, ghost tier/score,
 * momentum, and maturity scoring. Used by server, cli, web.
 * ──────────────────────────────────────────────────────────── */

/* ── Constants ─────────────────────────────────────────────── */

export const GHOST_TIERS = ["fresh", "cooling", "ghost", "buried"] as const;
export type GhostTier = (typeof GHOST_TIERS)[number];

/** Day thresholds (inclusive lower bound) for each tier. */
export const GHOST_TIER_THRESHOLDS = {
  fresh: 0, // < 3 days
  cooling: 3, // 3 – 14 days
  ghost: 14, // 14 – 30 days
  buried: 30, // >= 30 days
} as const;

export const GHOST_TIER_LABELS: Record<GhostTier, string> = {
  fresh: "🔥 생생함",
  cooling: "🌤 식는 중",
  ghost: "👻 유령화 진행 중",
  buried: "🪦 무덤 안착",
};

/** Maturity heuristic weights — sum to 100. */
export const MATURITY_WEIGHTS = {
  has_readme: 20,
  has_tests: 25,
  has_ci: 20,
  has_deploy: 15,
  git_tags: 10, // applied if git_tags >= 1
  version: 10, // applied if version >= 0.1.0
} as const;

export const MS_PER_DAY = 86_400_000;

/* ── Event ingestion (POST /api/v1/events) ─────────────────── */

export const EventTypeSchema = z.enum(["session_start", "session_end"]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const ProjectInputSchema = z.object({
  /** Primary stable identity (remote preferred), e.g. "github.com/user/repo" or "local:host:/path". */
  key: z.string().min(1).max(512),
  /**
   * Additional identities the client can see for the same project (e.g. the
   * local path key alongside the remote key). Lets the server merge a project
   * when a git remote is added later. Server treats key + alt_keys as aliases.
   */
  alt_keys: z.array(z.string().min(1).max(512)).max(8).nullish(),
  name: z.string().min(1).max(200),
  // nullish: shell clients send explicit null for absent fields, JS clients omit.
  path: z.string().max(1024).nullish(),
  repo_url: z.string().max(512).nullish(),
  description: z.string().max(500).nullish(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const MetricsSchema = z.object({
  turns: z.number().int().nonnegative().default(0),
  duration_sec: z.number().int().nonnegative().default(0),
  files_changed: z.number().int().nonnegative().default(0),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const MaturitySignalsSchema = z.object({
  has_readme: z.boolean().default(false),
  has_tests: z.boolean().default(false),
  has_ci: z.boolean().default(false),
  has_deploy: z.boolean().default(false),
  git_tags: z.number().int().nonnegative().default(0),
  version: z.string().nullable().default(null),
});
export type MaturitySignals = z.infer<typeof MaturitySignalsSchema>;

export const EventSchema = z.object({
  device_id: z.string().min(1).max(128),
  hostname: z.string().max(200).nullish(),
  event_type: EventTypeSchema,
  session_id: z.string().max(200).nullish(),
  ts: z.string().datetime().nullish(), // ISO; server falls back to receipt time
  project: ProjectInputSchema,
  metrics: MetricsSchema.nullish(),
  maturity_signals: MaturitySignalsSchema.nullish(),
  summary: z.string().max(1000).nullish(),
});
export type EventPayload = z.infer<typeof EventSchema>;

export const EventResponseSchema = z.object({
  project_id: z.number().int(),
  ghost_tier: z.enum(GHOST_TIERS),
  ghost_score: z.number(),
});
export type EventResponse = z.infer<typeof EventResponseSchema>;

/* ── Project read model (GET /api/v1/projects) ─────────────── */

export const ProjectSortSchema = z
  .enum(["ghost", "active", "momentum"])
  .default("active");
export type ProjectSort = z.infer<typeof ProjectSortSchema>;

export const ProjectSchema = z.object({
  id: z.number().int(),
  project_key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  repo_url: z.string().nullable(),
  first_seen_at: z.string(),
  last_active_at: z.string(),
  total_sessions: z.number().int(),
  total_turns: z.number().int(),
  maturity_score: z.number(),
  completion_pct: z.number().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  device_count: z.number().int(),
  // computed
  days_since_active: z.number(),
  ghost_tier: z.enum(GHOST_TIERS),
  ghost_score: z.number(),
  momentum: z.number(), // 0..100
  // last-N-days contribution heatmap (oldest -> newest), value = turns that day
  heatmap: z.array(z.object({ day: z.string(), value: z.number() })),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Days shown in the per-project contribution heatmap. */
export const HEATMAP_DAYS = 30;

/** Bucket a daily contribution value into a 0..4 intensity level (GitHub-style). */
export function heatmapLevel(value: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value <= 2) return 1;
  if (value <= 5) return 2;
  if (value <= 9) return 3;
  return 4;
}

export const ProjectPatchSchema = z
  .object({
    archived: z.boolean(),
    pinned: z.boolean(),
    completion_pct: z.number().min(0).max(100).nullable(),
    name: z.string().min(1).max(200),
    description: z.string().max(500).nullable(),
  })
  .partial();
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;

export const StatsSchema = z.object({
  total_projects: z.number().int(),
  active: z.number().int(),
  ghosts: z.number().int(),
  buried: z.number().int(),
});
export type Stats = z.infer<typeof StatsSchema>;

/* ── Pure computation ──────────────────────────────────────── */

/** Whole days elapsed between two epoch-ms timestamps (>= 0). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / MS_PER_DAY);
}

export function computeGhostTier(daysSinceActive: number): GhostTier {
  if (daysSinceActive >= GHOST_TIER_THRESHOLDS.buried) return "buried";
  if (daysSinceActive >= GHOST_TIER_THRESHOLDS.ghost) return "ghost";
  if (daysSinceActive >= GHOST_TIER_THRESHOLDS.cooling) return "cooling";
  return "fresh";
}

/**
 * Ghost score for the "Most Haunted" leaderboard.
 * Weights abandonment by investment so a long-loved-but-dropped
 * project outranks a one-session throwaway.
 *   score = daysSinceActive * log10(totalTurns + 10)
 */
export function computeGhostScore(
  daysSinceActive: number,
  totalTurns: number,
): number {
  return daysSinceActive * Math.log10(Math.max(0, totalTurns) + 10);
}

/**
 * Momentum 0..100: recent 7-day activity relative to the project's own
 * peak 7-day activity. 100 = currently as hot as it has ever been.
 */
export function computeMomentum(
  recent7dTurns: number,
  peak7dTurns: number,
): number {
  if (peak7dTurns <= 0) return 0;
  return Math.round(Math.min(1, recent7dTurns / peak7dTurns) * 100);
}

/** Parse a semver-ish string and return true if >= 0.1.0. */
export function versionAtLeast010(version: string | null | undefined): boolean {
  if (!version) return false;
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 0 || minor >= 1;
}

/** Maturity score 0..100 from raw signals. */
export function computeMaturityScore(s: MaturitySignals): number {
  let score = 0;
  if (s.has_readme) score += MATURITY_WEIGHTS.has_readme;
  if (s.has_tests) score += MATURITY_WEIGHTS.has_tests;
  if (s.has_ci) score += MATURITY_WEIGHTS.has_ci;
  if (s.has_deploy) score += MATURITY_WEIGHTS.has_deploy;
  if (s.git_tags >= 1) score += MATURITY_WEIGHTS.git_tags;
  if (versionAtLeast010(s.version)) score += MATURITY_WEIGHTS.version;
  return score;
}

/** Normalize a git remote URL into a stable cross-machine project key. */
export function normalizeRepoUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  // git@host:user/repo.git  |  ssh://git@host/user/repo.git  |  https://host/user/repo.git
  let m = trimmed.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) m = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = m[2].replace(/^\/+/, "").toLowerCase();
  return `${host}/${path}`;
}
