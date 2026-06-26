import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { canonicalKey, migrateCanonicalKeys } from "./repo.ts";

test("canonicalKey is idempotent and folds windows case/separators/host", () => {
  const a = canonicalKey("local:WinBox:D:\\Code\\App\\");
  const b = canonicalKey("local:winbox:D:/code/app");
  assert.equal(a, "local:winbox:d:\\code\\app");
  assert.equal(a, b);
  assert.equal(canonicalKey(a), a, "idempotent");
  // POSIX paths stay case-sensitive; only trailing slash trimmed.
  assert.equal(canonicalKey("local:Box:/home/Me/Proj/"), "local:box:/home/Me/Proj");
  // Remote keys pass through untouched.
  assert.equal(canonicalKey("github.com/u/r"), "github.com/u/r");
});

/**
 * Reproduces the real-world bug: two rows split before canonicalization existed
 * (one stored `d:` lowercase, the other `D:` uppercase), each with its own alias.
 * The startup backfill must merge them into one project, summing history.
 */
test("migrateCanonicalKeys merges pre-split drive-letter duplicates", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT);
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_key TEXT,
      name TEXT, description TEXT, repo_url TEXT, path TEXT,
      first_seen_at TEXT, last_active_at TEXT,
      total_sessions INTEGER DEFAULT 0, total_turns INTEGER DEFAULT 0,
      maturity_score INTEGER DEFAULT 0, completion_pct INTEGER,
      pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
      UNIQUE (user_id, project_key));
    CREATE TABLE project_aliases (
      user_id INTEGER, alias_key TEXT, project_id INTEGER,
      PRIMARY KEY (user_id, alias_key));
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, device_id TEXT,
      event_type TEXT, session_id TEXT, ts TEXT, turns INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0, files_changed INTEGER DEFAULT 0, summary TEXT);
    INSERT INTO users (id, name, created_at) VALUES (1, 'u', '2026-01-01T00:00:00Z');
  `);
  const lower = "local:box:d:\\proj\\app";
  const upper = "local:box:D:\\proj\\app";
  const addProject = db.prepare(
    `INSERT INTO projects (user_id, project_key, name, path, first_seen_at, last_active_at, total_sessions, total_turns)
     VALUES (1, ?, 'app', ?, ?, ?, ?, ?)`,
  );
  const id1 = Number(
    addProject.run(lower, lower, "2026-06-19T00:00:00Z", "2026-06-19T00:00:00Z", 1, 4).lastInsertRowid,
  );
  const id2 = Number(
    addProject.run(upper, upper, "2026-06-23T00:00:00Z", "2026-06-26T00:00:00Z", 2, 8).lastInsertRowid,
  );
  const addAlias = db.prepare(
    "INSERT INTO project_aliases (user_id, alias_key, project_id) VALUES (1, ?, ?)",
  );
  addAlias.run(lower, id1);
  addAlias.run(upper, id2);
  const addEvent = db.prepare(
    "INSERT INTO events (project_id, device_id, event_type, ts, turns) VALUES (?, 'd', 'session_end', ?, ?)",
  );
  addEvent.run(id1, "2026-06-19T00:00:00Z", 4);
  addEvent.run(id2, "2026-06-23T00:00:00Z", 8);

  migrateCanonicalKeys(db);

  const projects = db.prepare("SELECT * FROM projects").all() as {
    id: number;
    project_key: string;
    total_turns: number;
    total_sessions: number;
    first_seen_at: string;
    last_active_at: string;
  }[];
  assert.equal(projects.length, 1, "duplicates must collapse to one project");
  assert.equal(projects[0].project_key, "local:box:d:\\proj\\app");
  assert.equal(projects[0].total_turns, 12, "history summed");
  assert.equal(projects[0].total_sessions, 3);
  assert.equal(projects[0].first_seen_at, "2026-06-19T00:00:00Z", "oldest kept");
  assert.equal(projects[0].last_active_at, "2026-06-26T00:00:00Z", "newest kept");

  const survivor = projects[0].id;
  const events = db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ?")
    .get(survivor) as { n: number };
  assert.equal(events.n, 2, "all events repointed to survivor");

  // Idempotent: a second pass changes nothing.
  migrateCanonicalKeys(db);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n,
    1,
  );

  db.close();
});
