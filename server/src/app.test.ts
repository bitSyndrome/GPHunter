import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { localDayKey } from "@gph/shared";

const TOKEN = "test-token";

function startServer(
  rate = { capacity: 1000, refillPerSec: 1000 },
  tzOffsetMinutes = 0,
) {
  const db = openDb(":memory:", TOKEN);
  const app = createApp(db, {
    corsOrigin: "*",
    rateLimit: rate,
    scriptsDir: new URL("../../scripts", import.meta.url).pathname,
    tzOffsetMinutes,
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
    "local:winbox:D:\\proj\\T-Mi",
    "drive letter normalized to uppercase",
  );

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

test("heatmap buckets activity by the configured local day, not UTC", async () => {
  // 23:00Z two days ago: still "yesterday-ish" in UTC, but already the next
  // calendar day in KST (+09:00). Built relative to now so the instant always
  // sits inside the 30-day window, whenever the suite runs.
  const utcDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const ts = `${utcDay}T23:00:00.000Z`;
  const kstDay = localDayKey(Date.parse(ts), 540);
  assert.notEqual(utcDay, kstDay, "fixture must straddle the KST date line");

  const post = async (base: string) =>
    fetch(`${base}/api/v1/events`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify({
        device_id: "d",
        event_type: "session_end",
        session_id: "s1",
        ts,
        project: { key: "k", name: "n" },
        metrics: { turns: 4 },
      }),
    });
  const heatmapOf = async (base: string) => {
    const [p] = await (
      await fetch(`${base}/api/v1/projects`, { headers: authed() })
    ).json();
    return new Map<string, number>(
      (p.heatmap as { day: string; value: number }[]).map((h) => [h.day, h.value]),
    );
  };

  // UTC server: the turns land on the UTC day.
  const utc = startServer(undefined, 0);
  await post(utc.base);
  const utcMap = await heatmapOf(utc.base);
  assert.equal(utcMap.get(utcDay), 4);
  assert.equal(utcMap.get(kstDay) ?? 0, 0);
  utc.server.close();

  // KST server: the same instant lands on the *next* day — the bug this fixes.
  const kst = startServer(undefined, 540);
  await post(kst.base);
  const kstMap = await heatmapOf(kst.base);
  assert.equal(kstMap.get(kstDay), 4);
  assert.equal(kstMap.get(utcDay) ?? 0, 0);
  kst.server.close();
});

test("project detail sparkline uses the same local days as the heatmap", async () => {
  const utcDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const ts = `${utcDay}T23:00:00.000Z`;
  const kstDay = localDayKey(Date.parse(ts), 540);

  const { server, base } = startServer(undefined, 540);
  const res = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({
      device_id: "d",
      event_type: "session_end",
      ts,
      project: { key: "k", name: "n" },
      metrics: { turns: 3 },
    }),
  });
  const { project_id } = await res.json();
  const detail = await (
    await fetch(`${base}/api/v1/projects/${project_id}`, { headers: authed() })
  ).json();
  // Detail and list must agree, or the modal contradicts the card.
  assert.deepEqual(detail.activity, [{ day: kstDay, turns: 3 }]);
  server.close();
});

/* ── Body limits ────────────────────────────────── */

function scanEvent(day: string) {
  return {
    device_id: "d",
    hostname: "a-reasonably-long-hostname",
    event_type: "session_end",
    session_id: `scan:${day}`,
    ts: `${day}T12:00:00Z`,
    project: {
      key: "github.com/someuser/some-project",
      alt_keys: ["local:host:/home/someuser/dev/some-project"],
      name: "some-project",
      path: "/home/someuser/dev/some-project",
      repo_url: "git@github.com:someuser/some-project.git",
    },
    metrics: { turns: 1, duration_sec: 0, files_changed: 0 },
    maturity_signals: {
      has_readme: true,
      has_tests: true,
      has_ci: false,
      has_deploy: false,
      git_tags: 1,
      version: "0.1.0",
    },
    summary: "1 commit(s) (scan)",
  };
}

test("bulk ingest accepts a body larger than the single-event limit", async () => {
  const { server, base } = startServer();
  // ~600 scan events is comfortably over the 256kb single-event cap; the
  // schema allowed this all along while the body parser rejected it.
  const events = Array.from({ length: 600 }, (_, i) =>
    scanEvent(`20${10 + (i % 15)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`),
  );
  const body = JSON.stringify({ events });
  assert.ok(body.length > 256 * 1024, "fixture must exceed the small limit");

  const res = await fetch(`${base}/api/v1/events/bulk`, {
    method: "POST",
    headers: authed(),
    body,
  });
  assert.equal(res.status, 200);
  server.close();
});

test("an oversized body fails as JSON, not an HTML stack trace", async () => {
  const { server, base } = startServer();
  const padded = Array.from({ length: 2000 }, () => ({
    ...scanEvent("2020-01-01"),
    summary: "x".repeat(900),
  }));
  const res = await fetch(`${base}/api/v1/events/bulk`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ events: padded }),
  });
  assert.equal(res.status, 413);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.equal((await res.json()).error, "payload too large");
  server.close();
});

test("a single event over the small limit is still rejected", async () => {
  const { server, base } = startServer();
  const res = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ pad: "x".repeat(300 * 1024) }),
  });
  assert.equal(res.status, 413);
  server.close();
});

test("malformed JSON returns 400, not 500", async () => {
  const { server, base } = startServer();
  const res = await fetch(`${base}/api/v1/events`, {
    method: "POST",
    headers: authed(),
    body: "{nope",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "malformed JSON body");
  server.close();
});
