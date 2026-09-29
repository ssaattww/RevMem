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

test("document line contract coverage is runnable directly and through the required unit suite", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageManifest;
  const scripts = manifest.scripts ?? {};
  const contractTest = /test-dist\/test\/unit\/document-line-contract\.test\.js/u;

  assert.match(requireScript(scripts, "test:document-line-contract"), contractTest);
  assert.match(requireScript(scripts, "test:unit"), contractTest);
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

test("CI publishes a branch-version-and-HEAD-named VSIX and tracked source archive only after pull-request success", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /- name: Package user validation artifacts[\s\S]*?if: github\.event_name == 'pull_request' && success\(\)[\s\S]*?npm run package[\s\S]*?git archive --format=zip --output .*HEAD/u);
  assert.match(workflow, /- name: Upload user validation artifacts[\s\S]*?if: github\.event_name == 'pull_request' && success\(\)[\s\S]*?review-range-user-validation-\$\{\{ steps\.ci-version\.outputs\.version \}\}/u);
  assert.doesNotMatch(workflow, /test-t607|npm run test:t607/u, "success artifacts do not add performance work to CI");
});

test("required unit gate runs the Issue #90 runtime routing suite before success artifacts", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  assert.match(
    requireScript(manifest.scripts ?? {}, "test:unit"),
    /test-dist\/test\/unit\/issue-90-runtime-routing\.test\.js/u,
    "the required unit suite must execute the runtime routing regression",
  );
  assert.match(
    workflow,
    /- name: Unit tests[\s\S]*?npm run test:unit[\s\S]*?- name: Package user validation artifacts/u,
    "the required unit gate must precede success artifact packaging",
  );
});

test("required unit gate reaches the Issue #92 PR Progress context-menu contract before success artifacts", async () => {
  const [manifestText, workflow] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as PackageManifest;
  assert.match(
    requireScript(manifest.scripts ?? {}, "test:unit"),
    /test-dist\/test\/unit\/issue-92-pr-progress-context-menu\.test\.js/u,
    "the required unit suite must execute the Issue #92 context-menu regression",
  );
  assert.match(
    workflow,
    /- name: Unit tests[\s\S]*?npm run test:unit[\s\S]*?- name: Package user validation artifacts/u,
    "the required unit gate must precede success artifact packaging",
  );
});


test("required CI gates exclude timing-sensitive suites and use deadline-free Extension Host waits", async () => {
  const [
    manifestText,
    ciWorkflow,
    releaseWorkflow,
    t306Suite,
    lifecycleSuite,
    t506Suite,
    t506WorkspaceSuite,
    t609Suite,
    t604Suite,
    t506Integration
  ] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(workflowPath, "utf8"),
    readFile(path.join(projectRoot, ".github", "workflows", "release-vsix.yml"), "utf8"),
    readFile(path.join(projectRoot, "test", "vscode", "t306-suite", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "vscode", "suite", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "vscode", "t506-suite", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "vscode", "t506-workspace-suite", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "vscode", "t609-suite", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "unit", "t604-storage-lock-cleanup.test.ts"), "utf8"),
    readFile(path.join(projectRoot, "test", "integration", "t506-real-multi-instance-concurrency.integration.test.ts"), "utf8")
  ]);
  const scripts = (JSON.parse(manifestText) as PackageManifest).scripts ?? {};
  const timing = requireScript(scripts, "test:timing-sensitive");

  assert.match(timing, /owned-extension-host-launch\.test\.js/u);
  assert.match(timing, /owned-temporary-directory-cleanup\.test\.js/u);
  assert.match(timing, /node-git-blob-reader\.test\.js/u);
  assert.doesNotMatch(
    requireScript(scripts, "test:unit"),
    /owned-extension-host-launch\.test\.js|owned-temporary-directory-cleanup\.test\.js|node-git-blob-reader\.test\.js/u,
    "wall-clock timeout fixtures must stay out of the required unit gate",
  );
  assert.doesNotMatch(requireScript(scripts, "test:t302"), /node-git-blob-reader\.test\.js/u, "POSIX signal timing fixtures must stay out of required T302");
  for (const workflow of [ciWorkflow, releaseWorkflow]) {
    assert.doesNotMatch(workflow, /test:timing-sensitive/u);
  }

  for (const [name, source] of [
    ["t306", t306Suite],
    ["lifecycle", lifecycleSuite],
    ["t506", t506Suite],
    ["t609", t609Suite],
    ["t506 integration", t506Integration],
  ] as const) {
    assert.doesNotMatch(source, /Promise\.race/u, `${name} must rely on owned lifecycle/state completion instead of a short wall-clock race`);
  }
  assert.doesNotMatch(
    t506WorkspaceSuite,
    /Promise\.race|Date\.now\(\)|MAPPED_STATE_TIMEOUT_MS|setTimeout/u,
    "T506 workspace mapping must use drain/state completion instead of deadline polling",
  );
  assert.doesNotMatch(t604Suite, /setTimeout\(resolve, (?:50|60|1_020)\)/u, "T604 child-process coordination must use observable lock state instead of fixed sleeps");
  const requiredBaseGate = (workflow: string): readonly string[] =>
    Array.from(
      workflow.matchAll(/run-ci-command\.mjs (test-(?:unit|git|github|vscode)) ([^\r\n]+)/gu),
      (match) => `${match[1]} ${match[2].trim()}`
    );
  const expectedBaseGate = [
    "test-unit npm run test:unit",
    "test-git npm run test:git",
    "test-github npm run test:github",
    "test-vscode xvfb-run -a npm run test:vscode"
  ];
  assert.deepEqual(requiredBaseGate(ciWorkflow), expectedBaseGate);
  assert.deepEqual(requiredBaseGate(releaseWorkflow), expectedBaseGate, "CI and Publish must share the same deterministic base test gate");
});


test("required gates keep the T606 wall-clock timeout fixture local-only", async () => {
  const manifestText = await readFile(packageJsonPath, "utf8");
  const scripts = (JSON.parse(manifestText) as PackageManifest).scripts ?? {};
  const timing = requireScript(scripts, "test:timing-sensitive");
  assert.match(timing, /t606-production-timeout\.timing\.test\.js/u);
  assert.doesNotMatch(
    requireScript(scripts, "test:t606"),
    /t606-production-timeout\.timing\.test\.js/u,
    "the production wall-clock timeout fixture must stay out of required T606",
  );
  const productionMatrix = await readFile(
    path.join(projectRoot, "test", "unit", "t606-production-failure-matrix.test.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    productionMatrix,
    /timeoutMs:\s*25/u,
    "the required T606 matrix must not contain the 25 ms wall-clock timeout fixture",
  );
});
