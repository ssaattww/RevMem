import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/review-file-exclusion-policy";
import { NodeRepositoryFileEnumerator } from "../../src/adapters/repository-files/node-repository-file-enumerator";

interface TestRepository {
  readonly root: string;
  readonly fileSymlinkCreated: boolean;
}

const createFileSymlinkWhenSupported = async (root: string): Promise<boolean> => {
  try {
    await symlink(path.join(root, "src", "a.ts"), path.join(root, "linked-a.ts"));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) return false;
    throw error;
  }
};

const createRepository = async (): Promise<TestRepository> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await writeFile(
    path.join(root, ".gitignore"),
    "ignored/\n!ignored/keep.ts\n*.generated.ts\n**/root-generated.ts\nsrc/**/nested-generated.ts\n",
    "utf8"
  );
  await writeFile(path.join(root, "src", "b.ts"), "// comment\n\nconst b = 1;\n", "utf8");
  await writeFile(path.join(root, "src", "a.ts"), "\n// comment only\nconst a = 1;\n", "utf8");
  await writeFile(path.join(root, "src", "skip.generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "root-generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "src", "nested-generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "dist", "bundle.js"), "const bundle = true;\n", "utf8");
  await writeFile(path.join(root, "ignored", "secret.ts"), "const secret = true;\n", "utf8");
  await writeFile(path.join(root, "ignored", "keep.ts"), "const keep = true;\n", "utf8");
  await writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  return { root, fileSymlinkCreated: await createFileSymlinkWhenSupported(root) };
};

const enumerate = (policy = new ReviewFileExclusionPolicy()): NodeRepositoryFileEnumerator =>
  new NodeRepositoryFileEnumerator(policy);

test("enumerates deterministic included files and preserves file and directory exclusion reasons", async () => {
  const { root, fileSymlinkCreated } = await createRepository();
  const result = await enumerate().enumerate(root);

  assert.deepEqual(result.included.map((file) => file.path), [".gitignore", "src/a.ts", "src/b.ts"]);
  assert.deepEqual(result.included.map((file) => file.nonEmptyLineCount), [5, 2, 2]);
  assert.equal(result.excludedDirectories.find((entry) => entry.path === "dist")?.reason.kind, "default-glob");
  assert.equal(result.excludedDirectories.find((entry) => entry.path === "ignored")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "src/skip.generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "root-generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "src/nested-generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "binary.dat")?.reason.kind, "binary");
  assert.equal(result.excluded.find((file) => file.path === "linked-a.ts")?.reason.kind, fileSymlinkCreated ? "symbolic-link" : undefined);
  assert.equal(result.included.some((file) => file.path === "ignored/keep.ts"), false);
  assert.equal(result.excluded.some((file) => file.path === "dist" || file.path === "ignored"), false);

  // T504 may only aggregate included lines. T505's excluded-file count must not absorb pruned directories.
  assert.equal(result.included.reduce((sum, file) => sum + file.nonEmptyLineCount, 0), 9);
  assert.equal(result.excluded.length, fileSymlinkCreated ? 5 : 4);
  assert.equal(result.excludedDirectories.length, 2);
  assert.deepEqual(result.excludedDirectories.map((entry) => entry.path), ["dist", "ignored"]);
});

test("does not infer subtree exclusion from file-oriented or sentinel-only user globs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-prune-"));
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await writeFile(path.join(root, "src", "direct.ts"), "direct\n", "utf8");
  await writeFile(path.join(root, "src", "nested", "deep.ts"), "deep\n", "utf8");
  await writeFile(path.join(root, "src", "visible.ts"), "visible\n", "utf8");

  for (const glob of ["src/*", "src/.*", ".enumeration-probe"]) {
    const result = await enumerate(new ReviewFileExclusionPolicy({ userGlobs: [glob] })).enumerate(root);
    assert.equal(result.included.some((file) => file.path === "src/nested/deep.ts"), true, glob);
    assert.equal(result.excludedDirectories.some((directory) => directory.path === "src"), false, glob);
  }
});

test("prunes only a policy subtree that an explicit recursive glob excludes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-recursive-prune-"));
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await writeFile(path.join(root, "src", "nested", "deep.ts"), "deep\n", "utf8");
  const policy = new ReviewFileExclusionPolicy({ userGlobs: ["src/**"] });

  assert.deepEqual(policy.evaluateDirectory("src"), {
    excluded: true,
    normalizedPath: "src",
    reason: { kind: "user-glob", pattern: "src/**" }
  });
  assert.equal(new ReviewFileExclusionPolicy({ userGlobs: ["src/*"] }).evaluateDirectory("src").excluded, false);
  const result = await enumerate(policy).enumerate(root);
  assert.deepEqual(result.included, []);
  assert.deepEqual(result.excludedDirectories, [{
    path: "src",
    reason: { kind: "user-glob", pattern: "src/**" }
  }]);
});

test("keeps directory-only gitignore rules bound to directory entries and honors negation", async () => {
  const fileRoot = await mkdtemp(path.join(tmpdir(), "review-range-t503-gitignore-file-"));
  await writeFile(path.join(fileRoot, ".gitignore"), "cache/\n", "utf8");
  await writeFile(path.join(fileRoot, "cache"), "regular\n", "utf8");
  const fileResult = await enumerate().enumerate(fileRoot);
  assert.equal(fileResult.included.some((file) => file.path === "cache"), true);

  const directoryRoot = await mkdtemp(path.join(tmpdir(), "review-range-t503-gitignore-directory-"));
  await writeFile(path.join(directoryRoot, ".gitignore"), "cache/\n", "utf8");
  await mkdir(path.join(directoryRoot, "cache"));
  await writeFile(path.join(directoryRoot, "cache", "entry.ts"), "entry\n", "utf8");
  const directoryResult = await enumerate().enumerate(directoryRoot);
  assert.deepEqual(directoryResult.excludedDirectories, [{
    path: "cache",
    reason: { kind: "gitignore", pattern: "cache/" }
  }]);

  const negatedRoot = await mkdtemp(path.join(tmpdir(), "review-range-t503-gitignore-negated-"));
  await writeFile(path.join(negatedRoot, ".gitignore"), "cache/\n!cache/\n", "utf8");
  await mkdir(path.join(negatedRoot, "cache"));
  await writeFile(path.join(negatedRoot, "cache", "entry.ts"), "entry\n", "utf8");
  const negatedResult = await enumerate().enumerate(negatedRoot);
  assert.equal(negatedResult.included.some((file) => file.path === "cache/entry.ts"), true);
  assert.equal(negatedResult.excludedDirectories.some((directory) => directory.path === "cache"), false);
});

test("counts CRLF, LF, CR, mixed separators, trailing separators, and empty lines", () => {
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("a\nb\n"), 2);
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("a\r\nb\r\n"), 2);
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("a\rb\r"), 2);
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("a\r\n\r b \n\r\nc\r"), 3);
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("\r\n \r\n\r"), 0);
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("\n  \n// comment\n# comment\ncode\n"), 3);
});

test("excludes malformed non-NUL UTF-8 bytes from the T503 included boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-invalid-utf8-"));
  await writeFile(path.join(root, "invalid.ts"), Buffer.from([0x63, 0x33, 0xc3, 0x28, 0x0a]));

  const result = await enumerate().enumerate(root);

  assert.deepEqual(result.included, []);
  assert.deepEqual(result.excluded, [{
    path: "invalid.ts",
    reason: { kind: "invalid-encoding", encoding: "utf-8" }
  }]);
});

test("sorts canonical-equivalent Unicode paths with a locale-independent total order", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-unicode-sort-"));
  const composed = "\u00e9.ts";
  const decomposed = "e\u0301.ts";
  await writeFile(path.join(root, composed), "composed\n", "utf8");
  await writeFile(path.join(root, decomposed), "decomposed\n", "utf8");

  const result = await enumerate().enumerate(root);
  assert.deepEqual(result.included.map((file) => file.path), [decomposed, composed]);
});

test("does not follow Windows directory junctions without requiring file-symlink privilege", {
  skip: process.platform !== "win32"
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-junction-"));
  const target = path.join(root, "target");
  const junction = path.join(root, "linked-directory");
  await mkdir(target);
  await writeFile(path.join(target, "entry.ts"), "entry\n", "utf8");
  await symlink(target, junction, "junction");

  const result = await enumerate().enumerate(root);
  assert.equal(result.excluded.find((file) => file.path === "linked-directory")?.reason.kind, "symbolic-link");
  assert.equal(result.included.some((file) => file.path === "linked-directory/entry.ts"), false);
});
