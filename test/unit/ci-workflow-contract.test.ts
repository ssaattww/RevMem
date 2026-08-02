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

test("unit, npm test, focused CI execute the complete T304 tree contract", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;
  const scripts = manifest.scripts ?? {};
  const initialTreeTest = /test-dist\/test\/unit\/pull-request-progress-tree\.test\.js/u;
  const r3FollowupTest = /test-dist\/test\/unit\/t304-review-followup-r3\.test\.js/u;

  for (const [scriptName, pattern, description] of [
    ["test:unit", initialTreeTest, "initial T304 tree contract"],
    ["test:unit", r3FollowupTest, "T304 R3 follow-up contract"],
    ["test:t304", initialTreeTest, "initial T304 tree contract"],
    ["test:t304", r3FollowupTest, "T304 R3 follow-up contract"]
  ] as const) {
    assert.match(
      requireScript(scripts, scriptName),
      pattern,
      `${scriptName} must execute the ${description}`
    );
  }
  assert.match(
    requireScript(scripts, "test"),
    /npm run test:unit\b/u,
    "npm test must include the unit suite containing T304"
  );

  const workflow = await readFile(workflowPath, "utf8");
  assert.match(
    workflow,
    /- name: T304 PR progress tree tests[\s\S]*?npm run test:t304\b[\s\S]*?tee test-output\/ci\/test-t304\.log/u,
    "CI must invoke the package-owned T304 focused script and preserve its log"
  );
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

test("CI executes positive and negative architecture gates with diagnostic logs", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /- name: Architecture validation/u);
  assert.match(workflow, /npm run validate:architecture\b/u);
  assert.match(workflow, /tee test-output\/ci\/architecture\.log/u);
  assert.match(workflow, /- name: Architecture negative contract/u);
  assert.match(workflow, /npm run validate:architecture:negative\b/u);
  assert.match(workflow, /tee test-output\/ci\/architecture-negative\.log/u);
});
