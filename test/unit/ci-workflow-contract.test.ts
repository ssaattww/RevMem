import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const packageJsonPath = path.join(projectRoot, "package.json");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");
const diagnosticRunnerPath = path.join(projectRoot, "tools", "run-ci-command.mjs");
const extensionHostRunnerPath = path.join(projectRoot, "test", "vscode", "run-extension-host.ts");

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
    /- name: T304 PR progress tree tests[\s\S]*?node tools\/run-ci-command\.mjs test-t304 npm run test:t304\b/u,
    "CI must invoke the package-owned T304 focused script through the diagnostic runner"
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
  assert.match(
    workflow,
    /node tools\/run-ci-command\.mjs architecture npm run validate:architecture\b/u
  );
  assert.match(workflow, /- name: Architecture negative contract/u);
  assert.match(
    workflow,
    /node tools\/run-ci-command\.mjs architecture-negative npm run validate:architecture:negative\b/u
  );
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
    /- name: T505 Global understanding tests[\s\S]*?node tools\/run-ci-command\.mjs test-t505 npm run test:t505\b/u,
    "CI must invoke the package-owned T505 focused script through the diagnostic runner"
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

test("T506 integration and Extension Host acceptance are exposed as one required focused CI command", async () => {
  const [manifestText, workflow, extensionHostRunner] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
    readFile(extensionHostRunnerPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  const focused = requireScript(manifest.scripts ?? {}, "test:t506");

  assert.match(
    focused,
    /test-dist\/test\/integration\/t506-global-multi-context\.integration\.test\.js/u,
    "test:t506 must execute the multi-context Global integration suite."
  );
  assert.match(
    focused,
    /test-dist\/test\/integration\/t506-real-multi-instance-concurrency\.integration\.test\.js/u,
    "test:t506 must execute the real multi-instance state/history concurrency regression."
  );
  assert.match(
    focused,
    /run-extension-host\.js --t506/u,
    "test:t506 must execute the focused T506 Extension Host phases."
  );
  assert.match(extensionHostRunner, /process\.argv\.includes\("--t506"\)/u);
  assert.match(extensionHostRunner, /t506-suite/u);
  assert.match(
    workflow,
    /- name: T506 Global multi-context integration[\s\S]*?node tools\/run-ci-command\.mjs test-t506 xvfb-run -a npm run test:t506\b/u,
    "CI must execute the package-owned T506 focused command under Xvfb through the diagnostic runner."
  );
});

test("T406 GitHub failure and recovery integration is exposed by package and CI", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  const focused = requireScript(manifest.scripts ?? {}, "test:t406");

  for (const suite of [
    "test-dist/test/integration/mock-github.test.js",
    "test-dist/test/integration/t402-pr-diff-acquisition.test.js",
    "test-dist/test/unit/t405-composition-regression.test.js"
  ]) {
    assert.match(
      focused,
      new RegExp(suite.replaceAll(".", "\\."), "u"),
      `test:t406 must execute ${suite}`
    );
  }
  assert.match(
    workflow,
    /- name: T406 GitHub PR integration tests[\s\S]*?node tools\/run-ci-command\.mjs test-t406 npm run test:t406\b/u,
    "CI must invoke the package-owned T406 focused script through the diagnostic runner"
  );
});

test("T605 multi-root and remote workspace boundary coverage is exposed by package and CI", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8")
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  assert.match(
    requireScript(manifest.scripts ?? {}, "test:t605"),
    /test-dist\/test\/unit\/t605-multi-root-remote-boundaries\.test\.js/u
  );
  assert.match(
    workflow,
    /- name: T605 multi-root and remote workspace boundary tests[\s\S]*?node tools\/run-ci-command\.mjs test-t605 npm run test:t605\b/u
  );
});

test("T606 focused failure-policy coverage is exposed by package and CI", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  const focused = requireScript(manifest.scripts ?? {}, "test:t606");
  for (const suite of [
    "t606-failure-policy-retry-diagnostics",
    "t606-production-failure-matrix",
    "t606-r6-production-matrix",
    "t606-r6-real-composition",
    "t606-r5-production-activation",
    "local-git-adapter",
    "t405-github-lifecycle",
    "t405-composition-regression",
    "state-repository",
    "debounced-review-state-repository",
    "current-context-ui",
    "review-contexts-runtime-wiring",
    "global-understanding-ui",
    "t505-global-understanding-source",
    "github-pull-request-cache",
    "t604-storage-lock-cleanup",
    "t605-multi-root-remote-boundaries",
  ]) assert.match(focused, new RegExp(`test-dist/test/unit/${suite}\\.test\\.js`, "u"));
  assert.match(focused, /test-dist\/test\/integration\/mock-github\.test\.js/u);
  assert.match(focused, /test-dist\/test\/integration\/t302-review-followup\.integration\.test\.js/u);
  assert.match(focused, /test-dist\/test\/integration\/t402-pr-diff-acquisition\.test\.js/u);
  assert.match(
    workflow,
    /- name: T606 failure policy and diagnostics tests[\s\S]*?node tools\/run-ci-command\.mjs test-t606 npm run test:t606\b/u,
  );
});

test("T607 performance workloads remain local-only and never gate CI", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  const scripts = manifest.scripts ?? {};
  assert.match(
    requireScript(scripts, "test:t607"),
    /test-dist\/test\/unit\/t607-performance-incremental-ui\.test\.js/u,
    "developers retain an explicit local T607 workload command",
  );
  assert.doesNotMatch(
    requireScript(scripts, "test:unit"),
    /t607-performance-incremental-ui\.test\.js/u,
    "the default unit gate excludes machine-dependent performance workloads",
  );
  assert.doesNotMatch(
    workflow,
    /(?:test-t607|npm run test:t607)/u,
    "CI never executes the local-only T607 performance command",
  );
});
