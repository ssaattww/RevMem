import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const suitePath = (name: string): string => `test-dist/test/unit/${name}.test.js`;

const occurrences = (value: string, literal: string): number =>
  value.split(literal).length - 1;

const commandOccurrences = (value: string, command: string): number =>
  value.match(new RegExp(`${command}(?!:)`, "gu"))?.length ?? 0;

test("T609 gate wires every focused unit suite once and keeps the Extension Host phase separate", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageManifest;
  const scripts = manifest.scripts ?? {};
  const unit = scripts["test:unit"];
  const focused = scripts["test:t609"];
  const extensionHost = scripts["test:t609:extension-host"];
  assert.ok(unit, "test:unit must be defined");
  assert.ok(focused, "test:t609 must be defined");
  assert.ok(extensionHost, "test:t609:extension-host must be defined");

  for (const suite of [
    "t609-repository-resolution",
    "t609-review-contexts-repository",
    "t609-revision-mapping-encoding",
    "t609-normal-review-followup",
    "t609-review-contexts-cancellation-boundary",
    "t609-t405-encoding-composition",
    "t609-gate-wiring"
  ]) {
    const compiled = suitePath(suite);
    assert.equal(occurrences(unit, compiled), 1, `test:unit must execute ${suite} exactly once`);
    assert.equal(occurrences(focused, compiled), 1, `test:t609 must execute ${suite} exactly once`);
  }

  assert.equal(
    /run-extension-host\.js/u.test(focused),
    false,
    "test:t609 must not also execute the dedicated Extension Host phase"
  );
  assert.match(extensionHost, /run-extension-host\.js --t609\b/u);
  assert.equal(
    occurrences(extensionHost, "run-extension-host.js --t609"),
    1,
    "the dedicated Extension Host runner must be invoked once"
  );
});

test("T609 CI gate invokes the package-owned unit and Extension Host commands once", async () => {
  const workflow = await readFile(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");
  const gate = /- name: T609 repository and encoding tests\r?\n(?<body>[\s\S]*?)(?=\r?\n\s*- name:|\r?\n\s*$)/u.exec(workflow)?.groups?.body;
  assert.ok(gate, "CI must declare one T609 gate step");
  assert.equal(commandOccurrences(gate, "npm run test:t609"), 1, "CI must invoke test:t609 once");
  assert.equal(
    occurrences(gate, "npm run test:t609:extension-host"),
    1,
    "CI must invoke the dedicated T609 Extension Host phase once"
  );
});

test("T609 runner prepares both Git fixtures before the Host launches and the Host suite only consumes them", async () => {
  const runner = await readFile(path.join(projectRoot, "test/vscode/run-extension-host.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.match(runner, /const prepareT609Fixture = async/u);
  assert.match(runner, /const prepareT609SecondRoot = async/u);
  assert.match(runner, /await prepareT609Fixture\(t609Paths\.workspace\);/u);
  assert.match(runner, /await prepareT609SecondRoot\(t609Paths\.additionalWorkspace\);/u);
  assert.match(runner, /"files\.encoding": "shift_jis"/u);

  assert.doesNotMatch(hostSuite, /node:child_process/u);
  assert.doesNotMatch(hostSuite, /workspace\.fs\.(?:stat|writeFile)/u);
  assert.doesNotMatch(hostSuite, /getConfiguration\("files"/u);
  assert.doesNotMatch(hostSuite, /git\(/u);
});

test("T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.match(hostSuite, /const markAndSynchronizeFixtureReview = async/u);
  assert.match(hostSuite, /vscode\.window\.activeTextEditor\?\.document\.uri\.toString\(\)/u);
  assert.match(hostSuite, /api\.drainDocumentReviewEdits\(\)/u);
  assert.match(hostSuite, /api\.refreshVisibleEditorDecorations\(\)/u);
  assert.match(hostSuite, /api\.drainVisibleEditorDecorations\(\)/u);
  assert.match(hostSuite, /api\.getVisibleReviewedIntervals\(editor\.document\.uri\.toString\(\)\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("Shift-JIS", shiftedEditor, api\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("UTF-8 BOM", utf8Editor, api\)/u);
  assert.match(hostSuite, /refresh Global mixed encoding/u);
});

test("T609 phase ownership keeps mixed encoding in single-root and repository cancellation in multi-root", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const extension = await readFile(path.join(projectRoot, "src/t305-extension.ts"), "utf8");
  const runtime = await readFile(path.join(projectRoot, "src/t405-review-contexts-runtime.ts"), "utf8");
  const singleRootStart = hostSuite.indexOf("if (isSingleRoot) {");
  const restartStart = hostSuite.indexOf("if (!isPrepare) {");
  const multiRootStart = hostSuite.indexOf('await within("multi-root fixture readiness"');
  assert.ok(singleRootStart >= 0 && restartStart > singleRootStart && multiRootStart > restartStart);

  const singleRootPhase = hostSuite.slice(singleRootStart, restartStart);
  const multiRootPhase = hostSuite.slice(multiRootStart);
  assert.match(singleRootPhase, /assertMixedEncodingFixture\(folder, api\)/u);
  assert.doesNotMatch(multiRootPhase, /openTextDocument|markAndSynchronizeFixtureReview/u);
  assert.match(multiRootPhase, /reviewRange\.refreshContext/u);
  assert.match(multiRootPhase, /reviewRange\.selectContext/u);
  assert.match(multiRootPhase, /multi-root cancellation boundary/u);
  assert.match(multiRootPhase, /multi-root stale cancellation boundary/u);
  assert.match(multiRootPhase, /reviewRange\.redetectPullRequest/u);
  assert.match(multiRootPhase, /getReviewContextsCancellationSnapshot/u);
  assert.match(multiRootPhase, /providerProjection, before\.providerProjection/u);
  assert.match(multiRootPhase, /authoritativeContextCounts, before\.authoritativeContextCounts/u);
  assert.match(multiRootPhase, /repositorySelectionRequestCount/u);
  assert.match(extension, /getReviewContextsCancellationSnapshot/u);
  assert.match(extension, /testReviewContextsRepositorySelectionRequestCount \+= 1/u);
  assert.match(runtime, /getProjectionSnapshotForTest/u);
  assert.match(runtime, /getCancellationSnapshotForTest/u);
});

test("T609 contract fixtures compile legacy mapping and Review Context runtime shapes once through the focused gate", async () => {
  const testConfig = await readFile(path.join(projectRoot, "tsconfig.test.json"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as PackageManifest;
  const focused = manifest.scripts?.["test:t609"] ?? "";
  const fixtures = [
    "type-fixtures/contracts/t609-git-context-revision-mapping-old-shape.fixture.ts",
    "type-fixtures/contracts/t609-registered-review-contexts-runtime-old-shape.fixture.ts",
    "type-fixtures/contracts/t609-registered-t405-review-contexts-runtime-old-shape.fixture.ts",
  ];

  for (const fixture of fixtures) {
    assert.equal(occurrences(testConfig, fixture), 1, `compile:test must include ${fixture} once`);
  }
  assert.equal(commandOccurrences(focused, "npm run compile:test"), 1, "test:t609 must compile each compatibility fixture once");
});

test("T609 single-root reuses its no-active Current Context selection without an active-editor refresh", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const singleRootStart = hostSuite.indexOf("if (isSingleRoot) {");
  const restartStart = hostSuite.indexOf("if (!isPrepare) {");
  const reviewSyncStart = hostSuite.indexOf("const markAndSynchronizeFixtureReview = async");
  const reviewSyncEnd = hostSuite.indexOf("const assertMixedEncodingFixture", reviewSyncStart);
  assert.ok(singleRootStart >= 0 && restartStart > singleRootStart && reviewSyncStart >= 0 && reviewSyncEnd > reviewSyncStart);

  const singleRootPhase = hostSuite.slice(singleRootStart, restartStart);
  const reviewSync = hostSuite.slice(reviewSyncStart, reviewSyncEnd);
  assert.equal(
    occurrences(singleRootPhase, 'vscode.commands.executeCommand("reviewRange.refreshContext")'),
    1,
    "single-root must issue only its no-active-editor Current Context refresh"
  );
  assert.doesNotMatch(reviewSync, /reviewRange\.refreshContext/u);
});

test("T609 Host waits for the single handled startup Current Context refresh before its public no-active-editor command", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const extension = await readFile(path.join(projectRoot, "src/t305-extension.ts"), "utf8");
  const runtime = await readFile(path.join(projectRoot, "src/ui/current-context/vscode-current-context-runtime.ts"), "utf8");
  const activationIndex = hostSuite.indexOf('const api = (await within("activate extension", extension.activate())) as T609ExtensionApi;');
  const drainIndex = hostSuite.indexOf('await within("drain startup Current Context", api.drainCurrentContextStartupForTest());');
  const commandIndex = hostSuite.indexOf('await within("no-active-editor Current Context", vscode.commands.executeCommand("reviewRange.refreshContext"));');

  assert.ok(activationIndex >= 0 && drainIndex > activationIndex && commandIndex > drainIndex);
  assert.match(hostSuite, /drainCurrentContextStartupForTest\(\): Promise<void>;/u);
  assert.match(runtime, /readonly startupRefresh: Promise<void>;/u);
  assert.match(runtime, /const startupRefresh = runRefresh\(\);/u);
  assert.equal(occurrences(runtime, "void runRefresh();"), 1, "only the active-editor event remains fire-and-forget");
  assert.match(runtime, /await reportRefreshError\(formatOperationFailureForUser\(error\)\);/u);
  assert.match(extension, /drainCurrentContextStartupForTest: \(\) => currentContextRuntime\.startupRefresh/u);
  assert.doesNotMatch(extension, /void currentContextRuntime\.refresh\(\)\.catch/u);
});

test("T609 Host reaches normal-editor review through its public command", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.match(hostSuite, /executeCommand\("reviewRange\.markSelectionReviewed"/u);
  assert.doesNotMatch(hostSuite, /api\.markNormalEditorSelectionForTest\(editor\)/u);
});

test("T609 runner seeds persisted mapping state before Host activation through production storage", async () => {
  const runner = await readFile(path.join(projectRoot, "test", "vscode", "run-extension-host.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const singleRootStart = hostSuite.indexOf("if (isSingleRoot) {");
  const restartStart = hostSuite.indexOf("if (!isPrepare) {");
  assert.ok(singleRootStart >= 0 && restartStart > singleRootStart);
  const singleRootPhase = hostSuite.slice(singleRootStart, restartStart);

  assert.match(runner, /const prepareT609InitialReviewState = async/u);
  assert.match(runner, /new DocumentReviewStateSessionProvider\(/u);
  assert.match(runner, /new FileSystemReviewStateRepository\(/u);
  assert.match(runner, /new DebouncedReviewStateRepository\(/u);
  assert.match(runner, /new JsonlReviewHistoryStore\(/u);
  assert.match(runner, /await initial\.committer\.commit\(batchTransaction\);/u);
  assert.match(runner, /await historyRecorder\.recordTransaction\(batchTransaction, "test-mapping-seed"\);/u);
  assert.match(runner, /await prepareT609InitialReviewState\(t609Paths\.workspace, t609Paths\.userData\);/u);
  assert.doesNotMatch(hostSuite, /seedT609InitialReviewedRanges/u);
  assert.doesNotMatch(singleRootPhase, /mappingSeedEditors/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("Shift-JIS", shiftedEditor, api\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("UTF-8 BOM", utf8Editor, api\)/u);
  assert.match(hostSuite, /assertMappedGitTransitions\(folder, api\)/u);
});

test("T609 production activation does not retain the obsolete Test-only mapping seed", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "extension.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.doesNotMatch(extension, /seedT609InitialReviewedRanges/u);
  assert.doesNotMatch(hostSuite, /seedT609InitialReviewedRanges/u);
});

test("T609 single-root uses public mixed-encoding marks after startup settlement and queues Test-mode event feedback", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "extension.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const singleRootStart = hostSuite.indexOf("if (isSingleRoot) {");
  const restartStart = hostSuite.indexOf("if (!isPrepare) {");
  assert.ok(singleRootStart >= 0 && restartStart > singleRootStart);
  const singleRoot = hostSuite.slice(singleRootStart, restartStart);
  const startupDrain = hostSuite.indexOf('await within("drain startup Current Context", api.drainCurrentContextStartupForTest());');
  const noActiveContext = singleRoot.indexOf('await within("no-active-editor Current Context", vscode.commands.executeCommand("reviewRange.refreshContext"));');
  const mixedEncoding = singleRoot.indexOf("await assertMixedEncodingFixture(folder, api);");

  assert.ok(startupDrain >= 0 && noActiveContext >= 0 && mixedEncoding > noActiveContext);
  const normalCommandRegistration = extension.slice(
    extension.indexOf("const registrations = registerNormalEditorReviewCommands"),
    extension.indexOf("context.subscriptions.push", extension.indexOf("const registrations = registerNormalEditorReviewCommands"))
  );
  assert.equal(
    occurrences(normalCommandRegistration, 'if (result === "applied") reviewStateChanged.fire();'),
    4,
    "every normal mark operation must publish exactly one applied event"
  );
  assert.match(extension, /deferAppliedDecorationRefresh: true/u);
  assert.match(hostSuite, /drainReviewStateDependentsForTest\(\): Promise<void>;/u);
  assert.match(hostSuite, /drain \$\{label\} review-state dependents/u);
  const composition = await readFile(path.join(projectRoot, "src", "t305-extension.ts"), "utf8");
  assert.match(composition, /testReviewStateDependentRefresh = testReviewStateDependentRefresh\.then\(refreshReviewStateDependentsForTest\);/u);
  assert.match(composition, /drainReviewStateDependentsForTest: \(\) => testReviewStateDependentRefresh/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("Shift-JIS", shiftedEditor, api\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("UTF-8 BOM", utf8Editor, api\)/u);
});

test("T609 restart reobserves only its active UTF-8 BOM hint without Current Context or Global refresh", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "extension.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const restartStart = hostSuite.indexOf("if (!isPrepare) {");
  const multiRootStart = hostSuite.indexOf('await within("multi-root fixture readiness"');
  assert.ok(restartStart >= 0 && multiRootStart > restartStart);

  const restartPhase = hostSuite.slice(restartStart, multiRootStart);
  const activateIndex = restartPhase.indexOf("showTextDocument(reopened");
  const refreshIndex = restartPhase.indexOf("refresh reopened UTF-8 BOM decorations");
  const hintsIndex = restartPhase.indexOf("getObservedEncodingHintsForTest");
  assert.ok(activateIndex >= 0, "restart must activate the reopened UTF-8 BOM editor");
  assert.ok(refreshIndex > activateIndex, "restart must observe the active reopened editor through decorations");
  assert.ok(hintsIndex > refreshIndex, "restart must assert observed hints after decoration observation settles");
  assert.match(restartPhase, /vscode\.window\.activeTextEditor\?\.document\.uri\.toString\(\)/u);
  assert.match(restartPhase, /textDocuments\.some\([\s\S]*?shift-jis\.txt/u);
  assert.match(restartPhase, /textDocuments\.some\([\s\S]*?invalid\.txt/u);
  assert.doesNotMatch(
    restartPhase,
    /openTextDocument\(fixtureUri\(folder, "shift-jis\.txt"\)\)/u
  );
  assert.doesNotMatch(restartPhase, /reviewRange\.refreshContext|reviewRange\.refreshGlobalUnderstanding/u);
  assert.match(extension, /getObservedEncodingHintsForTest:\s*\(\)\s*=>\s*documentSessionProvider\.observedEncodingHintsSnapshot\(\)/u);
});
