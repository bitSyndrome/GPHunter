import path from "node:path";

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  seedToken: string;
  corsOrigin: string;
  rateCapacity: number;
  rateRefillPerSec: number;
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
  };
}
