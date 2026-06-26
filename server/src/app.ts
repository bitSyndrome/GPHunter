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
  NotificationConfigInputSchema,
  detectNotifyKind,
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
  summarizeInput,
  storeSummary,
  getNotificationConfig,
  putNotificationConfig,
  deleteNotificationConfig,
  markDigestSent,
} from "./repo.ts";
import { isLLMEnabled, summarizeProject } from "./llm.ts";
import { buildDigest, sendDigest } from "./notify.ts";
import type { LLMConfig } from "./config.ts";

export interface AppOptions {
  corsOrigin: string;
  rateLimit: RateLimitOptions;
  scriptsDir: string;
  llm?: LLMConfig;
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

  // Windows one-liner: irm <server>/api/v1/install.ps1 | iex
  //   $env:AGENT = py|node (default py)
  app.get("/api/v1/install.ps1", (req, res) => {
    const server = `${req.protocol}://${req.get("host")}`;
    res.type("text/plain; charset=utf-8").send(
      `# Ghost Project Hunter - Windows installer
\$ErrorActionPreference = "Stop"
\$Server = "${server}"
\$Agent  = if (\$env:AGENT) { \$env:AGENT } else { "py" }
\$Dest   = Join-Path \$env:USERPROFILE "ghost-hunter"
\$Bin    = Join-Path \$env:USERPROFILE "bin"
New-Item -ItemType Directory -Force -Path \$Dest, \$Bin | Out-Null

if (\$Agent -eq "node") { \$File = "ghost-hunter.cjs"; \$Runner = "node" }
else                    { \$File = "ghost_hunter.py";  \$Runner = "python" }
\$Target = Join-Path \$Dest \$File

Write-Host "Downloading \$File from \$Server ..."
Invoke-WebRequest -UseBasicParsing -Uri "\$Server/api/v1/agent/\$File" -OutFile \$Target

# 'ghost-hunter' wrapper so it works from any terminal.
# Use %USERPROFILE% (expanded by cmd at runtime) so the file stays pure ASCII —
# baking an absolute path with a non-ASCII username corrupts it under -Encoding ASCII.
\$Cmd = Join-Path \$Bin "ghost-hunter.cmd"
Set-Content -Path \$Cmd -Encoding ASCII -Value "@\$Runner ""%USERPROFILE%\\ghost-hunter\\\$File"" %*"

# ensure \$Bin is on the user PATH
\$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (\$userPath -notlike "*\$Bin*") {
  [Environment]::SetEnvironmentVariable("Path", "\$userPath;\$Bin", "User")
  Write-Host "Added \$Bin to your user PATH."
}
Write-Host "OK Installed: \$Cmd"
Write-Host ""
Write-Host "Next (open a NEW terminal so PATH refreshes):"
Write-Host "  ghost-hunter login \$Server <TOKEN>"
Write-Host "  ghost-hunter init"
`,
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

  // AI memory-aid: generate a "what was I doing / next step" summary on demand.
  api.post("/projects/:id/summarize", async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    if (!opts.llm || !isLLMEnabled(opts.llm)) {
      res.status(503).json({
        error: "AI summary not configured",
        hint: "Set GPH_LLM_API_KEY (and optionally GPH_LLM_BASE_URL / GPH_LLM_MODEL).",
      });
      return;
    }
    const input = summarizeInput(db, req.userId!, id);
    if (!input) {
      res.status(404).json({ error: "not found" });
      return;
    }
    try {
      const result = await summarizeProject(opts.llm, input);
      const updated = storeSummary(db, req.userId!, id, opts.llm.model, result);
      if (!updated) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(502).json({
        error: "summary generation failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  api.get("/stats", (req: AuthedRequest, res) => {
    res.json(getStats(db, req.userId!));
  });

  // ── Notification webhook (Slack/Discord digest) ───────────────────────────
  api.get("/notifications", (req: AuthedRequest, res) => {
    res.json(getNotificationConfig(db, req.userId!));
  });

  api.put("/notifications", (req: AuthedRequest, res) => {
    const parsed = NotificationConfigInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid config" });
      return;
    }
    const kind = detectNotifyKind(parsed.data.webhook_url);
    if (!kind) {
      res.status(400).json({
        error: "unrecognized webhook",
        hint: "Slack(hooks.slack.com) 또는 Discord(discord.com/api/webhooks) URL이어야 합니다.",
      });
      return;
    }
    res.json(
      putNotificationConfig(
        db,
        req.userId!,
        parsed.data.webhook_url,
        kind,
        parsed.data.enabled,
      ),
    );
  });

  api.delete("/notifications", (req: AuthedRequest, res) => {
    deleteNotificationConfig(db, req.userId!);
    res.json({ ok: true });
  });

  // Send a digest right now — to a URL in the body (preview before saving) or,
  // if omitted, to the saved config. Powers the "테스트 전송" button.
  api.post("/notifications/test", async (req: AuthedRequest, res) => {
    const bodyUrl =
      typeof req.body?.webhook_url === "string" ? req.body.webhook_url : null;
    const saved = getNotificationConfig(db, req.userId!);
    const url = bodyUrl ?? saved?.webhook_url ?? null;
    if (!url) {
      res.status(400).json({ error: "no webhook configured" });
      return;
    }
    const kind = detectNotifyKind(url);
    if (!kind) {
      res.status(400).json({ error: "unrecognized webhook" });
      return;
    }
    const digest = buildDigest(db, req.userId!) ?? {
      title: "👻 Ghost Project Hunter",
      lines: ["테스트 알림입니다. 아직 수집된 프로젝트가 없습니다."],
    };
    try {
      await sendDigest(kind, url, digest);
      if (saved && saved.webhook_url === url) {
        markDigestSent(db, req.userId!, new Date().toISOString());
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({
        error: "send failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.use("/api/v1", api);
  return app;
}
