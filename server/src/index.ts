import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { startDigestScheduler } from "./notify.ts";

const config = loadConfig();
const db = openDb(config.dbPath, config.seedToken);
const app = createApp(db, {
  corsOrigin: config.corsOrigin,
  rateLimit: {
    capacity: config.rateCapacity,
    refillPerSec: config.rateRefillPerSec,
  },
  scriptsDir: config.scriptsDir,
  llm: config.llm,
});

app.listen(config.port, config.host, () => {
  console.log(
    `[gph-server] listening on http://${config.host}:${config.port}`,
  );
  console.log(`[gph-server] db: ${config.dbPath}`);
});

// Weekly Slack/Discord digest scheduler (no-op until a webhook is configured).
startDigestScheduler(db);
