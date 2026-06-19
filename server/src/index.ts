import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

const config = loadConfig();
const db = openDb(config.dbPath, config.seedToken);
const app = createApp(db, config.corsOrigin);

app.listen(config.port, () => {
  console.log(`[gph-server] listening on http://localhost:${config.port}`);
  console.log(`[gph-server] db: ${config.dbPath}`);
});
