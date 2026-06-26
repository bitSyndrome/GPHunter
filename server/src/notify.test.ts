import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openDb } from "./db.ts";
import { ingestEvent } from "./repo.ts";
import { buildDigest, sendDigest } from "./notify.ts";

/** Capture one webhook POST and return its parsed JSON body. */
function captureServer(): Promise<{ url: string; received: Promise<unknown> }> {
  return new Promise((resolve) => {
    let resolveBody: (v: unknown) => void;
    const received = new Promise<unknown>((r) => (resolveBody = r));
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.writeHead(200).end("ok");
        resolveBody(JSON.parse(raw));
        server.close();
      });
    });
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, received });
    });
  });
}

test("buildDigest summarizes current state; null when empty", () => {
  const db = openDb(":memory:", "t");
  assert.equal(buildDigest(db, 1), null, "no projects → no digest");

  ingestEvent(db, 1, {
    device_id: "d",
    event_type: "session_end",
    project: { key: "github.com/me/app", name: "app" },
    metrics: { turns: 5, duration_sec: 0, files_changed: 0 },
  });
  const digest = buildDigest(db, 1);
  assert.ok(digest);
  assert.match(digest!.title, /Ghost Project Hunter/);
  assert.ok(digest!.lines.some((l) => l.includes("활성")));
});

test("sendDigest posts Slack `text` and Discord `content`", async () => {
  const digest = { title: "T", lines: ["a", "b"] };

  const slack = await captureServer();
  await sendDigest("slack", slack.url, digest);
  const slackBody = (await slack.received) as { text?: string; content?: string };
  assert.equal(typeof slackBody.text, "string");
  assert.equal(slackBody.content, undefined);
  assert.match(slackBody.text!, /T\na\nb/);

  const discord = await captureServer();
  await sendDigest("discord", discord.url, digest);
  const discordBody = (await discord.received) as {
    text?: string;
    content?: string;
  };
  assert.equal(typeof discordBody.content, "string");
  assert.equal(discordBody.text, undefined);
});
