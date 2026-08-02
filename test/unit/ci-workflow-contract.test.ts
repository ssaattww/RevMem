import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const packageJsonPath = path.join(projectRoot, "package.json");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const requireScript = (
  scripts: Readonly<Record<string, string>>,
  scriptName: string
): string => {
  const script = scripts[scriptName];
  assert.ok(script, `package.json must define ${scriptName}`);
  return script;
};

test("unit and focused suites execute the integrated design contract", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;
  const scripts = manifest.scripts ?? {};

  for (const scriptName of ["test:unit", "test:t302"]) {
    assert.match(
      requireScript(scripts, scriptName),
      /test-dist\/test\/unit\/design-document-structure\.test\.js/u,
      `${scriptName} must execute the design document contract test`
    );
  }
});

test("temporary Git suite executes the T207 history integration scenario", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;

  assert.match(
    requireScript(manifest.scripts ?? {}, "test:git"),
    /test-dist\/test\/integration\/t207-git-history\.integration\.test\.js/u
  );
});

test("T502 focused coverage is runnable locally and included in the default unit suite", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;
  const scripts = manifest.scripts ?? {};

  assert.match(
    requireScript(scripts, "test:t502"),
    /test-dist\/test\/unit\/global-review-mapping-display-priority\.test\.js/u
  );
  assert.match(
    requireScript(scripts, "test:unit"),
    /test-dist\/test\/unit\/global-review-mapping-display-priority\.test\.js/u
  );
});

test("CI executes positive and negative architecture gates with diagnostic logs", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /- name: Architecture validation/u);
  assert.match(workflow, /npm run validate:architecture\b/u);
  assert.match(workflow, /tee test-output\/ci\/architecture\.log/u);
  assert.match(workflow, /- name: Architecture negative contract/u);
  assert.match(workflow, /npm run validate:architecture:negative\b/u);
  assert.match(workflow, /tee test-output\/ci\/architecture-negative\.log/u);
});

test("CI executes the canonical T502 focused command", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /npm run test:t502\b/u);
});
