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
  parseUtcOffsetMinutes,
  localDayKey,
  sqliteDayModifier,
  localDayStartMs,
  lastLocalDays,
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

/* ── Local-day bucketing ────────────────────────── */

test("parseUtcOffsetMinutes accepts the common spellings", () => {
  assert.equal(parseUtcOffsetMinutes("+09:00"), 540);
  assert.equal(parseUtcOffsetMinutes("+0900"), 540);
  assert.equal(parseUtcOffsetMinutes("+9"), 540);
  assert.equal(parseUtcOffsetMinutes("09:00"), 540); // unsigned = east
  assert.equal(parseUtcOffsetMinutes("-05:00"), -300);
  assert.equal(parseUtcOffsetMinutes("-0530"), -330);
  assert.equal(parseUtcOffsetMinutes("+05:45"), 345); // Nepal
  assert.equal(parseUtcOffsetMinutes("Z"), 0);
  assert.equal(parseUtcOffsetMinutes("utc"), 0);
});

test("parseUtcOffsetMinutes rejects junk instead of guessing", () => {
  for (const bad of ["", "   ", "abc", "+9:0", "+09:99", "+25:00", "-20:00"]) {
    assert.equal(
      parseUtcOffsetMinutes(bad),
      null,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
});

test("localDayKey puts early-morning KST work on the right day", () => {
  // The bug this fixes: 2026-09-20 08:00 KST is 2026-09-19T23:00Z, which
  // UTC bucketing filed under the 19th.
  const earlyMorningKst = Date.parse("2026-09-19T23:00:00.000Z");
  assert.equal(localDayKey(earlyMorningKst, 0), "2026-09-19"); // old behaviour
  assert.equal(localDayKey(earlyMorningKst, 540), "2026-09-20"); // fixed
});

test("localDayKey respects local midnight boundaries", () => {
  // 23:59 KST on the 19th, then 00:00 KST on the 20th.
  assert.equal(
    localDayKey(Date.parse("2026-09-19T14:59:59.999Z"), 540),
    "2026-09-19",
  );
  assert.equal(
    localDayKey(Date.parse("2026-09-19T15:00:00.000Z"), 540),
    "2026-09-20",
  );
  // Negative offset: 03:00Z is still the 19th in US Eastern.
  assert.equal(
    localDayKey(Date.parse("2026-09-20T03:00:00.000Z"), -300),
    "2026-09-19",
  );
});

test("sqliteDayModifier formats both signs and zero", () => {
  assert.equal(sqliteDayModifier(540), "+540 minutes");
  assert.equal(sqliteDayModifier(-300), "-300 minutes");
  assert.equal(sqliteDayModifier(0), "+0 minutes");
});

test("localDayStartMs round-trips with localDayKey", () => {
  for (const offset of [0, 540, -300, 345]) {
    const startMs = localDayStartMs("2026-09-20", offset);
    // The first instant of the day maps back to that day...
    assert.equal(localDayKey(startMs, offset), "2026-09-20");
    // ...and one millisecond earlier belongs to the day before.
    assert.equal(localDayKey(startMs - 1, offset), "2026-09-19");
  }
});

test("lastLocalDays returns n consecutive days ending today", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const days = lastLocalDays(now, 3, 540);
  assert.deepEqual(days, ["2026-09-18", "2026-09-19", "2026-09-20"]);
  // Same instant near the KST date boundary rolls the window forward.
  assert.deepEqual(
    lastLocalDays(Date.parse("2026-09-20T15:00:00.000Z"), 1, 540),
    ["2026-09-21"],
  );
});
