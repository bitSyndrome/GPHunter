import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { normalizeRepoUrl, type MaturitySignals } from "@gph/shared";

/** Run a git command; return null on any failure (never throws). */
function git(cwd: string, args: string[], timeout = 800): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/** Commit counts per day (YYYY-MM-DD) over the last `sinceDays` days. */
export function commitsByDay(
  cwd: string,
  sinceDays: number,
): Map<string, number> {
  const out = git(
    cwd,
    ["log", `--since=${sinceDays} days ago`, "--date=short", "--pretty=%cd"],
    10_000,
  );
  const map = new Map<string, number>();
  if (!out) return map;
  for (const line of out.split("\n")) {
    const day = line.trim();
    if (day) map.set(day, (map.get(day) ?? 0) + 1);
  }
  return map;
}

export interface ProjectIdentity {
  key: string; // primary (remote preferred)
  altKeys: string[]; // other identities for the same project (e.g. local)
  name: string;
  path: string;
  repo_url?: string;
}

/**
 * Project identity carrying BOTH the local and (if present) remote keys, so the
 * server can merge history when a git remote is added later.
 *  - local key: local:<host>:<abs path>  (machine-scoped, always present)
 *  - remote key: normalized git remote    (shared across machines, preferred)
 */
export function deriveProjectIdentity(cwd: string): ProjectIdentity {
  const abs = path.resolve(cwd);
  const name = path.basename(abs);
  const localKey = `local:${os.hostname()}:${abs}`;
  const remote = git(abs, ["remote", "get-url", "origin"]);
  const remoteKey = remote ? normalizeRepoUrl(remote) : null;
  if (remoteKey) {
    return {
      key: remoteKey,
      altKeys: [localKey],
      name,
      path: abs,
      repo_url: remote ?? undefined,
    };
  }
  return { key: localKey, altKeys: [], name, path: abs };
}

/** Count assistant turns in a Claude Code transcript (JSONL). 0 on any error. */
export function countTurns(transcriptPath: string | undefined): number {
  if (!transcriptPath) return 0;
  try {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    let turns = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { type?: string };
        if (obj.type === "assistant") turns++;
      } catch {
        /* skip malformed line */
      }
    }
    return turns;
  } catch {
    return 0;
  }
}

/** Number of files with uncommitted changes (rough WIP signal). */
export function filesChanged(cwd: string): number {
  const out = git(cwd, ["status", "--porcelain"]);
  if (!out) return 0;
  return out.split("\n").filter((l) => l.trim()).length;
}

function exists(cwd: string, ...names: string[]): boolean {
  return names.some((n) => fs.existsSync(path.join(cwd, n)));
}

function readPackageVersion(cwd: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function hasTestSignal(cwd: string): boolean {
  if (exists(cwd, "test", "tests", "__tests__", "spec")) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.test);
  } catch {
    return false;
  }
}

/** Scan the project dir for maturity heuristic signals. */
export function scanMaturity(cwd: string): MaturitySignals {
  const tagCount = git(cwd, ["tag"]);
  return {
    has_readme: exists(cwd, "README.md", "README", "readme.md", "README.rst"),
    has_tests: hasTestSignal(cwd),
    has_ci: exists(cwd, ".github/workflows", ".gitlab-ci.yml", ".circleci"),
    has_deploy: exists(
      cwd,
      "Dockerfile",
      "vercel.json",
      "fly.toml",
      "netlify.toml",
      "Procfile",
    ),
    git_tags: tagCount ? tagCount.split("\n").filter((l) => l.trim()).length : 0,
    version: readPackageVersion(cwd),
  };
}
