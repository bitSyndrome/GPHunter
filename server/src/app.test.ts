import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

const TOKEN = "test-token";

function startServer(rate = { capacity: 1000, refillPerSec: 1000 }) {
  const db = openDb(":memory:", TOKEN);
  const app = createApp(db, {
    corsOrigin: "*",
    rateLimit: rate,
    scriptsDir: new URL("../../scripts", import.meta.url).pathname,
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return { server, base };
}

function authed(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...extra };
}

test("rejects requests without a token", async () => {
  const { server, base } = startServer();
  const res = await fetch(`${base}/api/v1/projects`);
  assert.equal(res.status, 401);
  server.close();
});

test("ingests an event and lists the project", async () => {
  const { server, base } = startServer();

  const post = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "dev-1",
      hostname: "laptop",
      event_type: "session_end",
      project: {
        key: "github.com/user/repo",
        name: "repo",
        repo_url: "git@github.com:user/repo.git",
      },
      metrics: { turns: 5 },
      maturity_signals: { has_readme: true },
      summary: "did stuff",
    }),
  });
  assert.equal(post.status, 200);
  const body = await post.json();
  assert.equal(body.ghost_tier, "fresh");
  assert.ok(typeof body.project_id === "number");

  const list = await fetch(`${base}/api/v1/projects`, { headers: authed() });
  const projects = await list.json();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "repo");
  assert.equal(projects[0].total_turns, 5);
  assert.equal(projects[0].maturity_score, 20);
  assert.equal(projects[0].device_count, 1);

  server.close();
});

test("merges same project_key across devices", async () => {
  const { server, base } = startServer();
  const ev = (device_id: string, turns: number) => ({
    device_id,
    event_type: "session_end",
    project: { key: "github.com/user/repo", name: "repo" },
    metrics: { turns },
  });

  for (const [dev, turns] of [["laptop", 3], ["desktop", 4]] as const) {
    await fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify(ev(dev, turns)),
    });
  }

  const projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 1, "two devices -> one merged project");
  assert.equal(projects[0].total_turns, 7);
  assert.equal(projects[0].device_count, 2);

  server.close();
});

test("local keys differing only in Windows drive-letter case dedupe", async () => {
  const { server, base } = startServer();
  const ev = (key: string, turns: number) => ({
    device_id: "winbox",
    event_type: "session_end",
    project: { key, name: "T-Mi", path: key.split(":").slice(2).join(":") },
    metrics: { turns },
  });

  // Same folder, two drive-letter casings (e.g. `cd d:` vs launched as `D:\`).
  for (const [key, turns] of [
    ["local:winbox:d:\\proj\\T-Mi", 2],
    ["local:winbox:D:\\proj\\T-Mi", 3],
  ] as const) {
    await fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify(ev(key, turns)),
    });
  }

  const projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 1, "drive-letter casing must not split projects");
  assert.equal(projects[0].total_turns, 5);
  assert.equal(
    projects[0].project_key,
    "local:winbox:d:\\proj\\t-mi",
    "windows key canonicalized to lowercase",
  );

  server.close();
});

test("windows keys differing in path case / separators / host case dedupe", async () => {
  const { server, base } = startServer();
  const ev = (key: string, turns: number) => ({
    device_id: "winbox",
    event_type: "session_end",
    project: { key, name: "App", path: key.split(":").slice(2).join(":") },
    metrics: { turns },
  });

  // Same folder seen as: backslash, forward-slash + trailing, folder-case + HOST-case.
  for (const [key, turns] of [
    ["local:WinBox:D:\\Code\\App", 2],
    ["local:winbox:D:/code/app/", 3],
    ["local:WINBOX:d:\\CODE\\App\\", 4],
  ] as const) {
    await fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify(ev(key, turns)),
    });
  }

  const projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 1, "case/separator/host variants must not split");
  assert.equal(projects[0].total_turns, 9);

  server.close();
});

test("adding a remote later merges into the existing local project", async () => {
  const { server, base } = startServer();
  const local = "local:laptop:/home/me/proj";
  const remote = "github.com/me/proj";

  // 1) Local-only project.
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "laptop",
      event_type: "session_end",
      project: { key: local, name: "proj" },
      metrics: { turns: 2 },
    }),
  });

  // 2) Remote added -> hook now sends remote primary + local alt_key.
  const res = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "laptop",
      event_type: "session_end",
      project: { key: remote, alt_keys: [local], name: "proj" },
      metrics: { turns: 3 },
    }),
  });
  assert.equal(res.status, 200);

  const projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 1, "history preserved as one project");
  assert.equal(projects[0].total_turns, 5);
  assert.equal(projects[0].project_key, remote, "primary promoted to remote");

  server.close();
});

test("two pre-existing projects merge when a shared remote links them", async () => {
  const { server, base } = startServer();
  const local = "local:laptop:/home/me/proj";
  const remote = "github.com/me/proj";

  // Project A: local-only (e.g. created before remote existed).
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "laptop",
      event_type: "session_end",
      project: { key: local, name: "proj" },
      metrics: { turns: 2 },
    }),
  });
  // Project B: remote-only (e.g. desktop cloned the repo).
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "desktop",
      event_type: "session_end",
      project: { key: remote, name: "proj" },
      metrics: { turns: 3 },
    }),
  });
  let projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 2, "distinct until linked");

  // Laptop adds the remote -> payload carries both keys -> merge.
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "laptop",
      event_type: "session_end",
      project: { key: remote, alt_keys: [local], name: "proj" },
      metrics: { turns: 1 },
    }),
  });

  projects = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(projects.length, 1, "merged into one");
  assert.equal(projects[0].total_turns, 6, "2 + 3 + 1");
  assert.equal(projects[0].device_count, 2);

  server.close();
});

test("projects include a 30-day contribution heatmap", async () => {
  const { server, base } = startServer();
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "d",
      event_type: "session_end",
      project: { key: "k", name: "n" },
      metrics: { turns: 7 },
    }),
  });
  const [p] = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(p.heatmap.length, 30, "30 days");
  // Today's bucket (last entry) reflects the 7 turns just logged.
  assert.equal(p.heatmap[29].value, 7);
  assert.equal(p.heatmap[0].value, 0, "older days are zero-filled");
  server.close();
});

test("bulk ingest backfills and is idempotent by session_id", async () => {
  const { server, base } = startServer();
  const mkEvents = () => ({
    events: [
      {
        device_id: "d",
        event_type: "session_end",
        session_id: "scan:2026-06-01",
        ts: "2026-06-01T12:00:00Z",
        project: { key: "github.com/me/r", name: "r" },
        metrics: { turns: 3 },
      },
      {
        device_id: "d",
        event_type: "session_end",
        session_id: "scan:2026-06-02",
        ts: "2026-06-02T12:00:00Z",
        project: { key: "github.com/me/r", name: "r" },
        metrics: { turns: 5 },
      },
    ],
  });

  const bulk = (body: unknown) =>
    fetch(`${base}/api/v1/events/bulk`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const turns = async () =>
    (await (await fetch(`${base}/api/v1/projects`, { headers: authed() })).json())[0]
      .total_turns;

  const first = await bulk(mkEvents());
  assert.equal(first.ingested, 2);
  assert.equal(first.skipped, 0);
  assert.equal(await turns(), 8, "3 + 5 backfilled");

  // Re-run identical scan -> all unchanged, no double count.
  const second = await bulk(mkEvents());
  assert.equal(second.ingested, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.skipped, 2);
  assert.equal(await turns(), 8, "still 8 after identical re-scan");

  // Re-scan with a higher count on day 2 (5 -> 9) REPLACES, not adds.
  const grown = mkEvents();
  grown.events[1].metrics.turns = 9;
  const third = await bulk(grown);
  assert.equal(third.updated, 1, "day 2 updated");
  assert.equal(third.skipped, 1, "day 1 unchanged");
  assert.equal(await turns(), 12, "3 + 9 (replaced, not 3+5+9)");
  server.close();
});

test("normal hook sessions are NOT deduped (SessionStart + SessionEnd)", async () => {
  const { server, base } = startServer();
  const ev = (event_type: string, t: number) => ({
    device_id: "d",
    event_type,
    session_id: "claude-session-123", // same id for both, like real hooks
    project: { key: "k", name: "n" },
    metrics: { turns: t },
  });
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify(ev("session_start", 0)),
  });
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify(ev("session_end", 6)),
  });
  const [p] = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(p.total_turns, 6, "SessionEnd turns counted, not skipped");
  assert.equal(p.total_sessions, 1);
  server.close();
});

test("serves agent scripts and install.sh without auth", async () => {
  const { server, base } = startServer();

  const py = await fetch(`${base}/api/v1/agent/ghost_hunter.py`); // no token
  assert.equal(py.status, 200);
  assert.match(await py.text(), /Ghost Project Hunter/);

  const bad = await fetch(`${base}/api/v1/agent/config.ts`);
  assert.equal(bad.status, 404, "allowlist blocks non-agent files");

  const sh = await fetch(`${base}/api/v1/install.sh`);
  assert.equal(sh.status, 200);
  const body = await sh.text();
  assert.match(body, /SERVER="http/);
  assert.match(body, /api\/v1\/agent\//);
  assert.match(body, /ghost-hunter login/);

  const ps = await fetch(`${base}/api/v1/install.ps1`);
  assert.equal(ps.status, 200);
  const psBody = await ps.text();
  assert.match(psBody, /\$Server = "http/);
  assert.match(psBody, /Invoke-WebRequest/);
  assert.match(psBody, /ghost-hunter\.cmd/);

  server.close();
});

test("rate limits /events past the bucket capacity", async () => {
  const { server, base } = startServer({ capacity: 3, refillPerSec: 0 });
  const body = JSON.stringify({
    device_id: "d",
    event_type: "session_end",
    project: { key: "k", name: "n" },
    metrics: { turns: 1 },
  });
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body,
    });
    codes.push(res.status);
    if (res.status === 429) {
      assert.ok(res.headers.get("retry-after"), "sends Retry-After");
    }
  }
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200], "first 3 allowed");
  assert.equal(codes[3], 429, "4th over capacity");
  assert.equal(codes[4], 429);
  server.close();
});

test("notification config saves with auto-detected channel; rejects junk URLs", async () => {
  const { server, base } = startServer();

  // Unconfigured → null.
  const empty = await (
    await fetch(`${base}/api/v1/notifications`, { headers: authed() })
  ).json();
  assert.equal(empty, null);

  // Junk URL rejected.
  const bad = await fetch(`${base}/api/v1/notifications`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ webhook_url: "https://example.com/nope" }),
  });
  assert.equal(bad.status, 400);

  // Slack URL → kind auto-detected.
  const saved = await (
    await fetch(`${base}/api/v1/notifications`, {
      method: "PUT",
      headers: authed(),
      body: JSON.stringify({
        webhook_url: "https://hooks.slack.com/services/T0/B0/xyz",
      }),
    })
  ).json();
  assert.equal(saved.kind, "slack");
  assert.equal(saved.enabled, true);

  // Discord URL updates the same config.
  const disc = await (
    await fetch(`${base}/api/v1/notifications`, {
      method: "PUT",
      headers: authed(),
      body: JSON.stringify({
        webhook_url: "https://discord.com/api/webhooks/1/abc",
        enabled: false,
      }),
    })
  ).json();
  assert.equal(disc.kind, "discord");
  assert.equal(disc.enabled, false);

  // Delete clears it.
  await fetch(`${base}/api/v1/notifications`, {
    method: "DELETE",
    headers: authed(),
  });
  const gone = await (
    await fetch(`${base}/api/v1/notifications`, { headers: authed() })
  ).json();
  assert.equal(gone, null);

  server.close();
});

test("summarize returns 503 when no LLM is configured", async () => {
  const { server, base } = startServer(); // startServer passes no llm config
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "d",
      event_type: "session_end",
      project: { key: "k", name: "n" },
      metrics: { turns: 1 },
    }),
  });
  const [p] = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();

  const res = await fetch(`${base}/api/v1/projects/${p.id}/summarize`, {
    method: "POST",
    headers: authed(),
  });
  assert.equal(res.status, 503, "AI feature is off without an API key");
  const body = await res.json();
  assert.match(body.hint, /GPH_LLM_API_KEY/);

  server.close();
});

test("retire stamps an epitaph + tombstone date; revive clears them", async () => {
  const { server, base } = startServer();
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "d",
      event_type: "session_end",
      project: { key: "k", name: "n", path: "/home/me/n" },
      metrics: { turns: 3 },
    }),
  });
  const [p] = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(p.path, "/home/me/n", "path exposed for revive command");

  // 보내주기: archive with an epitaph.
  const retired = await (
    await fetch(`${base}/api/v1/projects/${p.id}`, {
      method: "PATCH",
      headers: authed(),
      body: JSON.stringify({ archived: true, epitaph: "좋은 실험이었다" }),
    })
  ).json();
  assert.equal(retired.archived, true);
  assert.equal(retired.epitaph, "좋은 실험이었다");
  assert.ok(retired.retired_at, "tombstone date stamped");

  // 되살리기: un-archive clears epitaph + date.
  const revived = await (
    await fetch(`${base}/api/v1/projects/${p.id}`, {
      method: "PATCH",
      headers: authed(),
      body: JSON.stringify({ archived: false }),
    })
  ).json();
  assert.equal(revived.archived, false);
  assert.equal(revived.epitaph, null, "epitaph cleared on revive");
  assert.equal(revived.retired_at, null, "tombstone date cleared on revive");

  server.close();
});

test("regret sort ranks near-finished ghosts above early throwaways", async () => {
  const { server, base } = startServer();
  const old = "2020-01-01T00:00:00Z"; // long abandoned → ghost/buried
  const send = (key: string) =>
    fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify({
        device_id: "d",
        event_type: "session_end",
        ts: old,
        project: { key, name: key },
        metrics: { turns: 50 }, // equal investment → equal ghost_score
      }),
    });
  await send("almost");
  await send("early");

  const byGhost = await (
    await fetch(`${base}/api/v1/projects?sort=ghost`, { headers: authed() })
  ).json();
  const idOf = (n: string) => byGhost.find((p: { name: string }) => p.name === n).id;
  // Same idle time + turns, so ghost_score ties; only completion differs.
  await fetch(`${base}/api/v1/projects/${idOf("almost")}`, {
    method: "PATCH",
    headers: authed(),
    body: JSON.stringify({ completion_pct: 95 }),
  });
  await fetch(`${base}/api/v1/projects/${idOf("early")}`, {
    method: "PATCH",
    headers: authed(),
    body: JSON.stringify({ completion_pct: 5 }),
  });

  const byRegret = await (
    await fetch(`${base}/api/v1/projects?sort=regret`, { headers: authed() })
  ).json();
  assert.equal(byRegret[0].name, "almost", "near-finished ghost ranks first");
  assert.ok(byRegret[0].regret_score > byRegret[1].regret_score);
  assert.equal(byRegret[0].completion, 95);

  server.close();
});

test("patch archives a project and removes it from default list", async () => {
  const { server, base } = startServer();
  await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "d",
      event_type: "session_end",
      project: { key: "k", name: "n" },
      metrics: { turns: 1 },
    }),
  });
  const [p] = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();

  const patched = await (
    await fetch(`${base}/api/v1/projects/${p.id}`, {
      method: "PATCH",
      headers: authed(),
      body: JSON.stringify({ archived: true, completion_pct: 80 }),
    })
  ).json();
  assert.equal(patched.archived, true);
  assert.equal(patched.completion_pct, 80);

  const visible = await (
    await fetch(`${base}/api/v1/projects`, { headers: authed() })
  ).json();
  assert.equal(visible.length, 0);

  const withArchived = await (
    await fetch(`${base}/api/v1/projects?archived=true`, { headers: authed() })
  ).json();
  assert.equal(withArchived.length, 1);

  server.close();
});
