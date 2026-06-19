import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token        TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  hostname     TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  project_key    TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  repo_url       TEXT,
  path           TEXT,
  first_seen_at  TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_turns    INTEGER NOT NULL DEFAULT 0,
  maturity_score INTEGER NOT NULL DEFAULT 0,
  completion_pct INTEGER,
  pinned         INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, project_key)
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  device_id     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  session_id    TEXT,
  ts            TEXT NOT NULL,
  turns         INTEGER NOT NULL DEFAULT 0,
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER NOT NULL DEFAULT 0,
  summary       TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
`;

/** Open (or create) the database, run migrations, and seed the default user/token. */
export function openDb(dbPath: string, seedToken: string): DB {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seed(db, seedToken);
  return db;
}

function seed(db: DB, seedToken: string): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT user_id FROM tokens WHERE token = ?")
    .get(seedToken) as { user_id: number } | undefined;
  if (existing) return;

  const tx = db.transaction(() => {
    let user = db.prepare("SELECT id FROM users LIMIT 1").get() as
      | { id: number }
      | undefined;
    if (!user) {
      const info = db
        .prepare("INSERT INTO users (name, created_at) VALUES (?, ?)")
        .run("default", now);
      user = { id: Number(info.lastInsertRowid) };
    }
    db.prepare(
      "INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)",
    ).run(seedToken, user.id, now);
  });
  tx();
}
