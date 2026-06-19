import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface CliConfig {
  serverUrl: string;
  token: string;
  deviceId: string;
  hostname: string;
}

export function configDir(): string {
  const base =
    process.env.GPH_CONFIG_DIR ??
    process.env.XDG_CONFIG_HOME ??
    path.join(os.homedir(), ".config");
  return process.env.GPH_CONFIG_DIR
    ? base
    : path.join(base, "ghost-hunter");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function outboxDir(): string {
  return path.join(configDir(), "outbox");
}

export function loadConfig(): CliConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const cfg = JSON.parse(raw) as Partial<CliConfig>;
    if (!cfg.serverUrl || !cfg.token) return null;
    return {
      serverUrl: cfg.serverUrl,
      token: cfg.token,
      deviceId: cfg.deviceId ?? crypto.randomUUID(),
      hostname: cfg.hostname ?? os.hostname(),
    };
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CliConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", {
    mode: 0o600,
  });
}

/** Create a config, generating deviceId/hostname if absent. */
export function makeConfig(serverUrl: string, token: string): CliConfig {
  const existing = loadConfig();
  return {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    token,
    deviceId: existing?.deviceId ?? crypto.randomUUID(),
    hostname: os.hostname(),
  };
}
