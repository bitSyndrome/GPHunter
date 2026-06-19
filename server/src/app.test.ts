import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";

const TOKEN = "test-token";

function startServer() {
  const db = openDb(":memory:", TOKEN);
  const app = createApp(db, "*");
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
