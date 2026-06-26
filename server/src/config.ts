import path from "node:path";

/**
 * LLM provider for the AI memory-aid (Phase 3). Provider-agnostic: any
 * OpenAI-compatible `/chat/completions` endpoint works — Anthropic Claude,
 * OpenAI, OpenRouter, local Ollama/LM Studio — by pointing baseUrl + model at it.
 * Disabled (feature off) whenever apiKey is empty, keeping setup trivial.
 */
export interface LLMConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  seedToken: string;
  corsOrigin: string;
  rateCapacity: number;
  rateRefillPerSec: number;
  scriptsDir: string;
  llm: LLMConfig;
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
    llm: {
      // Defaults target Anthropic's OpenAI-compatible endpoint; override any of
      // these to use OpenAI, OpenRouter, a local model, etc.
      baseUrl: process.env.GPH_LLM_BASE_URL ?? "https://api.anthropic.com/v1",
      apiKey: process.env.GPH_LLM_API_KEY || null,
      model: process.env.GPH_LLM_MODEL ?? "claude-haiku-4-5",
    },
  };
}
