import express, { type Express } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import {
  EventSchema,
  EventResponseSchema,
  BulkEventSchema,
  BulkEventResponseSchema,
  ProjectPatchSchema,
  ProjectSortSchema,
  computeGhostScore,
  computeGhostTier,
  daysBetween,
} from "@gph/shared";
import type { DB } from "./db.ts";
import { authMiddleware, type AuthedRequest } from "./auth.ts";
import { rateLimit, type RateLimitOptions } from "./ratelimit.ts";
import {
  ingestEvent,
  listProjects,
  getProject,
  patchProject,
  getStats,
} from "./repo.ts";

export interface AppOptions {
  corsOrigin: string;
  rateLimit: RateLimitOptions;
  scriptsDir: string;
}

// Agent scripts downloadable without auth (they contain no secrets).
const AGENT_FILES: Record<string, { file: string; type: string }> = {
  "ghost_hunter.py": { file: "ghost_hunter.py", type: "text/x-python" },
  "ghost-hunter.sh": { file: "ghost-hunter.sh", type: "text/x-shellscript" },
  // single-file Node bundle (built via `npm run build:agent`)
  "ghost-hunter.cjs": { file: "dist/ghost-hunter.cjs", type: "text/javascript" },
};

export function createApp(db: DB, opts: AppOptions): Express {
  const app = express();
  app.set("trust proxy", true); // honor X-Forwarded-For for client IP
  app.use(cors({ origin: opts.corsOrigin }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ── Agent distribution (unauthenticated) ──────────────────────────────────
  app.get("/api/v1/agent/:name", (req, res) => {
    const entry = AGENT_FILES[req.params.name];
    if (!entry) {
      res.status(404).json({ error: "unknown agent" });
      return;
    }
    const full = path.join(opts.scriptsDir, entry.file);
    fs.readFile(full, "utf8", (err, data) => {
      if (err) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.type(entry.type).send(data);
    });
  });

  // One-line global installer: curl -fsSL <server>/api/v1/install.sh | sh
  //   AGENT=node|py|sh (default node)   BIN=<dir> (default ~/.local/bin)
  app.get("/api/v1/install.sh", (req, res) => {
    const server = `${req.protocol}://${req.get("host")}`;
    res.type("text/x-shellscript").send(
      `#!/usr/bin/env sh
# Ghost Project Hunter — global agent installer
set -e
SERVER="${server}"
AGENT="\${AGENT:-node}"            # node | py | sh
BIN="\${BIN:-\$HOME/.local/bin}"
case "\$AGENT" in
  node) FILE=ghost-hunter.cjs ;;
  py)   FILE=ghost_hunter.py ;;
  sh)   FILE=ghost-hunter.sh ;;
  *) echo "unknown AGENT '\$AGENT' (use node|py|sh)"; exit 1 ;;
esac
mkdir -p "\$BIN"
echo "Downloading \$FILE from \$SERVER ..."
if ! curl -fsSL "\$SERVER/api/v1/agent/\$FILE" -o "\$BIN/ghost-hunter"; then
  echo "X Download failed. The Node bundle needs 'npm run build:agent' on the server."
  echo "  Try Python:  curl -fsSL \$SERVER/api/v1/install.sh | AGENT=py sh"
  exit 1
fi
chmod +x "\$BIN/ghost-hunter"
echo "OK Installed to \$BIN/ghost-hunter"
case ":\$PATH:" in
  *":\$BIN:"*) : ;;
  *) echo "!  \$BIN is not on PATH — add: export PATH=\$BIN:\\\$PATH" ;;
esac
echo ""
echo "Next:"
echo "  ghost-hunter login \$SERVER <TOKEN>"
echo "  ghost-hunter init"
`,
    );
  });

  const api = express.Router();
  api.use(authMiddleware(db));

  // Ingest a hook event (rate limited — main abuse vector).
  api.post("/events", rateLimit(opts.rateLimit), (req: AuthedRequest, res) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid event", details: parsed.error.flatten() });
      return;
    }
    const result = ingestEvent(db, req.userId!, parsed.data);
    const days = daysBetween(Date.parse(result.last_active_at), Date.now());
    res.json(
      EventResponseSchema.parse({
        project_id: result.project_id,
        ghost_tier: computeGhostTier(days),
        ghost_score: Math.round(computeGhostScore(days, result.total_turns) * 100) / 100,
      }),
    );
  });

  // Bulk ingest (scan backfill). Rate-limited as a single call.
  api.post("/events/bulk", rateLimit(opts.rateLimit), (req: AuthedRequest, res) => {
    const parsed = BulkEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid bulk", details: parsed.error.flatten() });
      return;
    }
    let ingested = 0;
    let updated = 0;
    let skipped = 0;
    const ids = new Set<number>();
    for (const ev of parsed.data.events) {
      const r = ingestEvent(db, req.userId!, ev);
      ids.add(r.project_id);
      if (r.updated) updated++;
      else if (r.skipped) skipped++;
      else ingested++;
    }
    res.json(
      BulkEventResponseSchema.parse({
        ingested,
        updated,
        skipped,
        project_ids: [...ids],
      }),
    );
  });

  // Leaderboard list.
  api.get("/projects", (req: AuthedRequest, res) => {
    const sort = ProjectSortSchema.parse(req.query.sort ?? "active");
    const includeArchived = req.query.archived === "true";
    res.json(listProjects(db, req.userId!, sort, includeArchived));
  });

  // Detail + sparkline.
  api.get("/projects/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const project = getProject(db, req.userId!, id);
    if (!project) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(project);
  });

  // Manual override.
  api.patch("/projects/:id", (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const parsed = ProjectPatchSchema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      res.status(400).json({ error: "invalid patch" });
      return;
    }
    const updated = patchProject(db, req.userId!, id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(updated);
  });

  api.get("/stats", (req: AuthedRequest, res) => {
    res.json(getStats(db, req.userId!));
  });

  app.use("/api/v1", api);
  return app;
}
