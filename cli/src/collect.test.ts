import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  deriveProjectIdentity,
  scanMaturity,
  countTurns,
  filesChanged,
} from "./collect.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gph-"));
}

test("deriveProjectIdentity falls back to local key (no git)", () => {
  const dir = tmpDir();
  const id = deriveProjectIdentity(dir);
  assert.ok(id.key.startsWith("local:"));
  assert.equal(id.altKeys.length, 0);
  assert.equal(id.name, path.basename(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("deriveProjectIdentity uses remote primary + local alt when git remote set", () => {
  const dir = tmpDir();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:me/repo.git"],
      { cwd: dir },
    );
    const id = deriveProjectIdentity(dir);
    assert.equal(id.key, "github.com/me/repo");
    assert.equal(id.altKeys.length, 1);
    assert.ok(id.altKeys[0].startsWith("local:"));
    assert.equal(id.repo_url, "git@github.com:me/repo.git");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanMaturity detects signals", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# hi");
    fs.mkdirSync(path.join(dir, "tests"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ version: "0.2.0" }),
    );
    const m = scanMaturity(dir);
    assert.equal(m.has_readme, true);
    assert.equal(m.has_tests, true);
    assert.equal(m.has_ci, false);
    assert.equal(m.version, "0.2.0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("countTurns counts assistant lines, 0 on missing file", () => {
  assert.equal(countTurns(undefined), 0);
  assert.equal(countTurns("/no/such/file.jsonl"), 0);
  const dir = tmpDir();
  const f = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    f,
    [
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "assistant" }),
      "malformed{",
      JSON.stringify({ type: "assistant" }),
    ].join("\n"),
  );
  assert.equal(countTurns(f), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("filesChanged returns 0 outside a git repo", () => {
  const dir = tmpDir();
  assert.equal(filesChanged(dir), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
