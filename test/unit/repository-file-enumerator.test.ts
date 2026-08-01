import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ReviewFileExclusionPolicy } from "../../src/core/file-exclusion/review-file-exclusion-policy";
import { NodeRepositoryFileEnumerator } from "../../src/adapters/repository-files/node-repository-file-enumerator";

const createRepository = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "review-range-t503-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "ignored/\n*.generated.ts\n**/root-generated.ts\nsrc/**/nested-generated.ts\n", "utf8");
  await writeFile(path.join(root, "src", "b.ts"), "// comment\n\nconst b = 1;\n", "utf8");
  await writeFile(path.join(root, "src", "a.ts"), "\n// comment only\nconst a = 1;\n", "utf8");
  await writeFile(path.join(root, "src", "skip.generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "root-generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "src", "nested-generated.ts"), "const generated = true;\n", "utf8");
  await writeFile(path.join(root, "dist", "bundle.js"), "const bundle = true;\n", "utf8");
  await writeFile(path.join(root, "ignored", "secret.ts"), "const secret = true;\n", "utf8");
  await writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  await symlink(path.join(root, "src", "a.ts"), path.join(root, "linked-a.ts"));
  return root;
};

test("enumerates deterministic included files and preserves exclusion reasons", async () => {
  const root = await createRepository();
  const enumerator = new NodeRepositoryFileEnumerator(new ReviewFileExclusionPolicy());

  const result = await enumerator.enumerate(root);

  assert.deepEqual(result.included.map((file) => file.path), [".gitignore", "src/a.ts", "src/b.ts"]);
  assert.deepEqual(result.included.map((file) => file.nonEmptyLineCount), [4, 2, 2]);
  assert.equal(result.excluded.find((file) => file.path === "dist")?.reason.kind, "default-glob");
  assert.equal(result.excluded.find((file) => file.path === "ignored")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "src/skip.generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "root-generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "src/nested-generated.ts")?.reason.kind, "gitignore");
  assert.equal(result.excluded.find((file) => file.path === "binary.dat")?.reason.kind, "binary");
  assert.equal(result.excluded.find((file) => file.path === "linked-a.ts")?.reason.kind, "symbolic-link");
});

test("counts comment lines as non-empty and excludes whitespace-only lines", () => {
  assert.equal(NodeRepositoryFileEnumerator.countNonEmptyLines("\n  \n// comment\n# comment\ncode\n"), 3);
});
