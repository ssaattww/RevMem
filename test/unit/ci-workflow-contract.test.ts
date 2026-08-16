import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const packageJsonPath = path.join(projectRoot, "package.json");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");
const diagnosticRunnerPath = path.join(projectRoot, "tools", "run-ci-command.mjs");

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

test("T505 focused coverage executes each dedicated suite once and is required by CI", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;
  const focused = requireScript(manifest.scripts ?? {}, "test:t505");

  for (const suiteName of [
    "global-understanding-ui",
    "t505-global-understanding-source",
    "t505-refresh-invalidation",
    "t505-review-findings"
  ]) {
    const suitePath = new RegExp(
      `test-dist/test/unit/${suiteName}\\.test\\.js`,
      "gu"
    );
    assert.equal(
      focused.match(suitePath)?.length ?? 0,
      1,
      `test:t505 must execute ${suiteName}.test.js exactly once`
    );
  }

  const workflow = await readFile(workflowPath, "utf8");
  assert.match(
    workflow,
    /- name: T505 Global understanding tests[\s\S]*?npm run test:t505\b[\s\S]*?tee test-output\/ci\/test-t505\.log/u,
    "CI must invoke the package-owned T505 focused script and preserve its log"
  );
});

test("CI diagnostics preserve stdout, stderr, combined logs, and result metadata", async () => {
  const [workflow, runner] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(diagnosticRunnerPath, "utf8")
  ]);

  assert.match(
    workflow,
    /node tools\/run-ci-command\.mjs/u,
    "CI commands must execute through the diagnostic runner"
  );
  assert.match(workflow, /test-output\/ci\//u);
  assert.match(runner, /\.stdout\.log/u);
  assert.match(runner, /\.stderr\.log/u);
  assert.match(runner, /\.log/u);
  assert.match(runner, /\.result\.json/u);
});
