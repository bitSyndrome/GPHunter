import express, { type Express } from "express";
import cors from "cors";
import {
  EventSchema,
  EventResponseSchema,
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
}

export function createApp(db: DB, opts: AppOptions): Express {
  const app = express();
  app.set("trust proxy", true); // honor X-Forwarded-For for client IP
  app.use(cors({ origin: opts.corsOrigin }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true });
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
