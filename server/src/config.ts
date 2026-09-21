import path from "node:path";
import { parseUtcOffsetMinutes } from "@gph/shared";

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  seedToken: string;
  corsOrigin: string;
  rateCapacity: number;
  rateRefillPerSec: number;
  scriptsDir: string;
  /** Minutes east of UTC used to bucket activity into calendar days. */
  tzOffsetMinutes: number;
}

/**
 * Day bucketing offset. Defaults to the server's own local offset, which is
 * what a self-hosted single-user install wants: the heatmap matches the clock
 * on the wall. Override with GPH_TZ_OFFSET (e.g. "+09:00") when the server
 * runs somewhere other than where the user works.
 */
function loadTzOffsetMinutes(): number {
  const raw = process.env.GPH_TZ_OFFSET;
  if (raw === undefined || raw.trim() === "") {
    // getTimezoneOffset() counts minutes *west* of UTC, so negate it.
    return -new Date().getTimezoneOffset();
  }
  const parsed = parseUtcOffsetMinutes(raw);
  if (parsed === null) {
    const fallback = -new Date().getTimezoneOffset();
    console.warn(
      `[gph-server] WARNING: ignoring invalid GPH_TZ_OFFSET ${JSON.stringify(raw)}; ` +
        `expected a form like "+09:00". Falling back to the server offset (${fallback} min).`,
    );
    return fallback;
  }
  return parsed;
}

export function loadConfig(): Config {
  const seedToken = process.env.GPH_SEED_TOKEN ?? "dev-token";
  if (seedToken === "dev-token") {
    console.warn(
      "[gph-server] WARNING: using default seed token 'dev-token'. Set GPH_SEED_TOKEN in production.",
    );
  }
  return {
    host: process.env.GPH_HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8787),
    dbPath:
      process.env.GPH_DB_PATH ??
      path.join(process.cwd(), "data", "gph.sqlite"),
    seedToken,
    corsOrigin: process.env.GPH_CORS_ORIGIN ?? "*",
    rateCapacity: Number(process.env.GPH_RATE_CAPACITY ?? 60),
    rateRefillPerSec: Number(process.env.GPH_RATE_REFILL ?? 1),
    // Agent scripts to serve for download (repo /scripts by default).
    scriptsDir:
      process.env.GPH_SCRIPTS_DIR ??
      path.resolve(import.meta.dirname, "..", "..", "scripts"),
    tzOffsetMinutes: loadTzOffsetMinutes(),
  };
}
