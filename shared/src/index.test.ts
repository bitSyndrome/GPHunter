import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGhostTier,
  computeGhostScore,
  computeMomentum,
  computeMaturityScore,
  versionAtLeast010,
  normalizeRepoUrl,
  daysBetween,
  EventSchema,
  type MaturitySignals,
} from "./index.ts";

test("computeGhostTier boundaries", () => {
  assert.equal(computeGhostTier(0), "fresh");
  assert.equal(computeGhostTier(2.9), "fresh");
  assert.equal(computeGhostTier(3), "cooling");
  assert.equal(computeGhostTier(13.9), "cooling");
  assert.equal(computeGhostTier(14), "ghost");
  assert.equal(computeGhostTier(29.9), "ghost");
  assert.equal(computeGhostTier(30), "buried");
  assert.equal(computeGhostTier(365), "buried");
});

test("computeGhostScore weights investment", () => {
  // Same abandonment age, more turns => higher (more tragic) ghost.
  const throwaway = computeGhostScore(30, 1);
  const loved = computeGhostScore(30, 50);
  assert.ok(loved > throwaway);
  // 0 days => 0 regardless of turns.
  assert.equal(computeGhostScore(0, 999), 0);
});

test("computeMomentum 0..100", () => {
  assert.equal(computeMomentum(0, 0), 0);
  assert.equal(computeMomentum(5, 0), 0);
  assert.equal(computeMomentum(5, 10), 50);
  assert.equal(computeMomentum(20, 10), 100); // capped
});

test("versionAtLeast010", () => {
  assert.equal(versionAtLeast010(null), false);
  assert.equal(versionAtLeast010("0.0.9"), false);
  assert.equal(versionAtLeast010("0.1.0"), true);
  assert.equal(versionAtLeast010("1.2.3"), true);
  assert.equal(versionAtLeast010("v2.0.0"), true);
});

test("computeMaturityScore full and partial", () => {
  const full: MaturitySignals = {
    has_readme: true,
    has_tests: true,
    has_ci: true,
    has_deploy: true,
    git_tags: 3,
    version: "1.0.0",
  };
  assert.equal(computeMaturityScore(full), 100);

  const minimal: MaturitySignals = {
    has_readme: true,
    has_tests: false,
    has_ci: false,
    has_deploy: false,
    git_tags: 0,
    version: null,
  };
  assert.equal(computeMaturityScore(minimal), 20);
});

test("normalizeRepoUrl handles ssh/https/scp forms", () => {
  const expected = "github.com/user/repo";
  assert.equal(normalizeRepoUrl("git@github.com:user/repo.git"), expected);
  assert.equal(normalizeRepoUrl("https://github.com/user/repo.git"), expected);
  assert.equal(normalizeRepoUrl("https://github.com/user/repo"), expected);
  assert.equal(
    normalizeRepoUrl("ssh://git@github.com/user/repo.git"),
    expected,
  );
  assert.equal(normalizeRepoUrl("git@github.com:User/Repo.git"), expected);
  assert.equal(normalizeRepoUrl(""), null);
});

test("daysBetween never negative", () => {
  assert.equal(daysBetween(100, 100), 0);
  assert.equal(daysBetween(200, 100), 0);
  assert.equal(daysBetween(0, 86_400_000), 1);
});

test("EventSchema validates and applies metric defaults", () => {
  const parsed = EventSchema.parse({
    device_id: "dev-1",
    event_type: "session_end",
    project: { key: "github.com/user/repo", name: "repo" },
    metrics: { turns: 5 },
  });
  assert.equal(parsed.metrics?.duration_sec, 0);
  assert.equal(parsed.metrics?.files_changed, 0);
});

test("EventSchema rejects bad event_type", () => {
  assert.throws(() =>
    EventSchema.parse({
      device_id: "d",
      event_type: "nope",
      project: { key: "k", name: "n" },
    }),
  );
});
