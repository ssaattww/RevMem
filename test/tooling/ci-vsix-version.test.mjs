import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../tools/resolve-ci-vsix-version.mjs", import.meta.url));
function repository(context) {
  const cwd = mkdtempSync(path.join(tmpdir(), "ci-vsix-version-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "CI version contract");
  git("config", "user.email", "ci-version@example.invalid");
  const commit = (version) => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "fixture", version }));
    git("add", "package.json");
    git("commit", "--allow-empty", "-m", version);
    return git("rev-parse", "HEAD");
  };
  const resolve = (head, base, env = {}) => {
    const output = path.join(cwd, "github-output");
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script, "--head", head, "--base", base], {
      cwd, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, ...env },
    });
    return { ...result, output: readFileSync(output, "utf8") };
  };
  return { cwd, git, commit, resolve };
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("uses the main release at the branch point and exactly seven PR HEAD digits", (context) => {
  const fixture = repository(context);
  const base = fixture.commit("0.0.1-pre");
  fixture.git("tag", "0.1.52-pre");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("99.0.0");
  const result = fixture.resolve(head, base);
  const version = success(result);
  assert.equal(version.version, `0.1.52-pre+${head.slice(0, 7)}`);
  assert.equal(version.branchPointSha, base);
  assert.equal(version.headSha, head);
  assert.equal(version.baseVersionSource, "tag:0.1.52-pre");
  assert.match(result.output, new RegExp(`^version=0\\.1\\.52-pre\\+${head.slice(0, 7)}$`, "m"));
});

test("later main releases and unrelated tags do not change the fork version", (context) => {
  const fixture = repository(context);
  fixture.commit("0.0.1-pre");
  fixture.git("tag", "v1.2.3");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("8.0.0");
  fixture.git("tag", "99.0.0");
  fixture.git("checkout", "main");
  const base = fixture.commit("9.0.0");
  fixture.git("tag", "9.0.0");
  fixture.git("checkout", "--detach", head);
  assert.equal(success(fixture.resolve(head, base)).version, `1.2.3+${head.slice(0, 7)}`);
});

test("ignores unversioned tags and supports annotated release tags", (context) => {
  const fixture = repository(context);
  fixture.commit("0.0.1-pre");
  fixture.git("tag", "-a", "v2.3.4-rc.1", "-m", "release");
  const base = fixture.commit("0.0.1-pre");
  fixture.git("tag", "not-a-version");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("9.0.0");
  assert.equal(success(fixture.resolve(head, base)).version, `2.3.4-rc.1+${head.slice(0, 7)}`);
});

test("without a reachable release tag reads the branch-point manifest, not PR or current main", (context) => {
  const fixture = repository(context);
  const fork = fixture.commit("1.4.0-beta.2+build.8");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("2.0.0");
  fixture.git("checkout", "main");
  const base = fixture.commit("3.0.0");
  fixture.git("checkout", "feature");
  const result = success(fixture.resolve(head, base));
  assert.equal(result.version, `1.4.0-beta.2+build.8.${head.slice(0, 7)}`);
  assert.equal(result.branchPointSha, fork);
  assert.equal(result.baseVersionSource, `manifest:${fork}`);
});

test("preserves leading zeroes in a numeric seven-digit hash", async () => {
  const { formatCiVersion } = await import(new URL("../../tools/resolve-ci-vsix-version.mjs", import.meta.url));
  assert.equal(formatCiVersion("1.2.3", "0000123" + "a".repeat(33)), "1.2.3+0000123");
});

test("does not derive identity from GITHUB_SHA or run number", (context) => {
  const fixture = repository(context);
  const base = fixture.commit("1.2.3");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("9.0.0");
  const result = success(fixture.resolve(head, base, { GITHUB_SHA: "f".repeat(40), GITHUB_RUN_NUMBER: "9999" }));
  assert.equal(result.version, `1.2.3+${head.slice(0, 7)}`);
});

test("rejects packaging a checkout different from the supplied PR HEAD", (context) => {
  const fixture = repository(context);
  const base = fixture.commit("1.2.3");
  fixture.git("checkout", "-b", "feature");
  const head = fixture.commit("2.0.0");
  fixture.git("checkout", "main");
  const result = fixture.resolve(head, base);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout.*HEAD/iu);
  assert.equal(result.output, "");
});

test("rejects malformed or unavailable SHA inputs without emitting a version", (context) => {
  const fixture = repository(context);
  const base = fixture.commit("1.2.3");
  for (const head of ["abcdef0", "--help", "a".repeat(40)]) {
    const result = fixture.resolve(head, base);
    assert.notEqual(result.status, 0);
    assert.equal(result.output, "");
  }
});

test("rejects invalid branch-point versions and disconnected history", (context) => {
  const fixture = repository(context);
  const base = fixture.commit("not-semver");
  assert.notEqual(fixture.resolve(base, base).status, 0);
  fixture.git("checkout", "--orphan", "unrelated");
  const head = fixture.commit("1.0.0");
  const result = fixture.resolve(head, base);
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});
