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
    "t609-test-review-state-dependent-queue",
    "t609-host-rename-decoration-composition",
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
  assert.doesNotMatch(hostSuite, /git\(/u);
});

test("T609 multi-root workspace fixture preserves the single-root whitespace and EOL mapping settings exactly once", async () => {
  const runner = await readFile(path.join(projectRoot, "test/vscode/run-extension-host.ts"), "utf8");
  const workspaceWrite = /await writeFile\(t609Paths\.workspaceFile, `\$\{JSON\.stringify\(\{(?<body>[\s\S]*?)\}\)\}\\n`, "utf8"\);/u.exec(runner)?.groups?.body;
  assert.ok(workspaceWrite, "T609 must write one multi-root workspace fixture");

  for (const setting of [
    '"files.encoding": "shift_jis"',
    '"reviewRange.ignoreWhitespaceChanges": true',
    '"reviewRange.ignoreEolChanges": true'
  ]) {
    assert.equal(occurrences(workspaceWrite, setting), 1, `multi-root workspace settings must contain ${setting} exactly once`);
  }
});

test("T609 Host fixture separates active-editor lifecycle, command persistence, visible refresh, and Global completion", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const reviewSyncStart = hostSuite.indexOf("const markAndSynchronizeFixtureReview = async");
  const reviewSyncEnd = hostSuite.indexOf("const assertMixedEncodingFixture", reviewSyncStart);
  assert.ok(reviewSyncStart >= 0 && reviewSyncEnd > reviewSyncStart);
  const reviewSync = hostSuite.slice(reviewSyncStart, reviewSyncEnd);

  assert.match(hostSuite, /const markAndSynchronizeFixtureReview = async/u);
  assert.match(hostSuite, /vscode\.window\.activeTextEditor\?\.document\.uri\.toString\(\)/u);
  assert.match(hostSuite, /api\.drainDocumentReviewEdits\(\)/u);
  assert.match(hostSuite, /api\.refreshVisibleEditorDecorations\(\)/u);
  assert.match(hostSuite, /api\.drainVisibleEditorDecorations\(\)/u);
  assert.match(hostSuite, /api\.getVisibleReviewedIntervals\(editor\.document\.uri\.toString\(\)\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("Shift-JIS", shiftedEditor, api\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("UTF-8 BOM", utf8Editor, api\)/u);
  assert.match(hostSuite, /refresh Global mixed encoding/u);
  assert.equal(
    occurrences(reviewSync, 'vscode.commands.executeCommand("reviewRange.markSelectionReviewed")'),
    1,
    "each mixed-encoding fixture must execute the public normal-editor command once"
  );
  for (const directAwait of [
    'await vscode.commands.executeCommand("reviewRange.markSelectionReviewed");',
    "await api.drainDocumentReviewEdits();",
    "await api.refreshVisibleEditorDecorations();",
    "await api.drainVisibleEditorDecorations();"
  ]) {
    assert.ok(reviewSync.includes(directAwait), `mixed-encoding synchronization must await ${directAwait} directly`);
  }
  assert.doesNotMatch(
    reviewSync,
    /within\(`(?:mark|drain|refresh) \$\{label\}/u,
    "the fixture-only command and decoration chain must use the owned phase deadline instead of 10-second local wrappers"
  );
});

test("T609 runner owns a 300-second deadline for the single-root phase", async () => {
  const runner = await readFile(path.join(projectRoot, "test/vscode/run-extension-host.ts"), "utf8");
  const focusedStart = runner.indexOf("if (focusedT609) {");
  const focusedEnd = runner.indexOf("if (focusedLifecycleRestore)", focusedStart);
  assert.ok(focusedStart >= 0 && focusedEnd > focusedStart);
  const focusedRunner = runner.slice(focusedStart, focusedEnd);

  assert.match(runner, /const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000;/u);
  assert.match(runner, /timeoutMs: launchTimeout\(\),/u);
  assert.match(focusedRunner, /phase === "single-root" \? t609SingleRootLaunchPaths : t609LaunchPaths/u);
  assert.match(focusedRunner, /await launch\(\s*`t609-\$\{phase\}`,[\s\S]*?phase\s*\);/u);
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
  assert.match(multiRootPhase, /executeCommand\("reviewRange\.redetectPullRequest"\)/u);
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
  assert.match(runtime, /const startupRefresh = runRefresh\(\{ allowInteraction: false \}\);/u);
  assert.match(runtime, /REFRESH_CONTEXT_COMMAND_ID,\s*\(\) => runRefresh\(\{ allowInteraction: true \}\)/u);
  assert.match(runtime, /onDidChangeActiveTextEditor\(\(\) => \{\s*void runRefresh\(\{ allowInteraction: false \}\);/u);
  assert.equal(
    occurrences(runtime, "void runRefresh({ allowInteraction: false });"),
    1,
    "only the active-editor event remains fire-and-forget and must remain non-interactive"
  );
  assert.match(runtime, /await reportRefreshError\(formatOperationFailureForUser\(error\)\);/u);
  assert.match(extension, /drainCurrentContextStartupForTest: \(\) => currentContextRuntime\.startupRefresh/u);
  assert.doesNotMatch(extension, /void currentContextRuntime\.refresh\(\)\.catch/u);
});

test("T609 multi-root Current Context commands retain their public path without local settle-time wrappers", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const multiRootStart = hostSuite.indexOf('await within("multi-root fixture readiness"');
  assert.ok(multiRootStart >= 0);
  const multiRootPhase = hostSuite.slice(multiRootStart);

  for (const command of [
    'await vscode.commands.executeCommand("reviewRange.refreshContext");',
    'await vscode.commands.executeCommand("reviewRange.refreshContext");',
    'await vscode.commands.executeCommand("reviewRange.selectContext");'
  ]) {
    assert.match(multiRootPhase, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(multiRootPhase, /within\("seed multi-root Current Context"/u);
  assert.doesNotMatch(multiRootPhase, /within\("multi-root Current Context cancel"/u);
  assert.doesNotMatch(multiRootPhase, /within\("multi-root Current Context stale"/u);
  assert.match(multiRootPhase, /assert\.equal\(api\.getCurrentContextSelectionRequestCountForTest\(\), 1/u);
  assert.match(multiRootPhase, /assert\.deepEqual\(api\.getCurrentContextCancellationSnapshotForTest\(\), currentBefore/u);
});

test("T609 multi-root Review Contexts keeps its public commands and snapshots under the owned phase deadline", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const runner = await readFile(path.join(projectRoot, "test/vscode/run-extension-host.ts"), "utf8");
  const multiRootStart = hostSuite.indexOf('await within("multi-root fixture readiness"');
  assert.ok(multiRootStart >= 0);
  const multiRootPhase = hostSuite.slice(multiRootStart);

  for (const operation of [
    'await vscode.commands.executeCommand("reviewRange.refreshReviewContexts");',
    'await api.getReviewContextsCancellationSnapshot();',
    'await vscode.commands.executeCommand("reviewRange.redetectPullRequest");'
  ]) {
    assert.equal(multiRootPhase.includes(operation), true, `${operation} must remain an actual public or test-observation operation`);
  }
  for (const localWrapper of [
    'within("seed multi-root Review Contexts projection"',
    'within("read accepted multi-root Review Contexts snapshot"',
    'within("multi-root cancellation boundary"',
    'within("read cancel Review Contexts snapshot"',
    'within("multi-root stale cancellation boundary"',
    'within("read stale Review Contexts snapshot"'
  ]) {
    assert.equal(multiRootPhase.includes(localWrapper), false, `${localWrapper} must use the owned T609 prepare phase deadline`);
  }
  assert.match(multiRootPhase, /providerProjection, before\.providerProjection/u);
  assert.match(multiRootPhase, /authoritativeContextCounts, before\.authoritativeContextCounts/u);
  assert.match(multiRootPhase, /repositorySelectionRequestCount/u);
  assert.match(runner, /const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000;/u);
});

test("T609 multi-root Current Context selection clears mapped editors before the public commands", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const mappingIndex = hostSuite.indexOf("await assertMappedGitTransitions(folder, api);");
  const clearEditorIndex = hostSuite.indexOf('await within("clear mapped editor before Current Context selection", closeAllEditors());');
  const seedIndex = hostSuite.indexOf('api.setCurrentContextSelectionForTest("first");');

  assert.ok(mappingIndex >= 0 && clearEditorIndex > mappingIndex && seedIndex > clearEditorIndex);
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

test("T609 mapped Git-transition fixture keeps only per-file-operation deadlines without an overall mapping deadline", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const mappingStart = hostSuite.indexOf("const assertMappedGitTransitions = async");
  const mappingEnd = hostSuite.indexOf("/** Exercises the T609 gate", mappingStart);
  const prepareStart = hostSuite.indexOf('await within("multi-root fixture readiness"');
  const mappingInvocationEnd = hostSuite.indexOf('api.setCurrentContextSelectionForTest("first")', prepareStart);
  assert.ok(mappingStart >= 0 && mappingEnd > mappingStart && prepareStart >= 0 && mappingInvocationEnd > prepareStart);

  const mappingFixture = hostSuite.slice(mappingStart, mappingEnd);
  const multiRootMappingInvocation = hostSuite.slice(prepareStart, mappingInvocationEnd);
  for (const substep of [
    "await within(`open mapped ${name}`",
    "await within(`show mapped ${name}`"
  ]) {
    assert.ok(mappingFixture.includes(substep), `each mapped file must retain its ${substep} deadline`);
  }
  assert.doesNotMatch(
    mappingFixture,
    /within\("committed rename\/new\/whitespace\/EOL mapping"/u,
    "the mapping fixture itself must not add an overall deadline around independently bounded operations"
  );
  assert.doesNotMatch(
    multiRootMappingInvocation,
    /await within\("committed rename\/new\/whitespace\/EOL mapping", assertMappedGitTransitions/u,
    "the multi-root phase must not apply a second overall deadline around the bounded mapping fixture"
  );
  assert.match(multiRootMappingInvocation, /await assertMappedGitTransitions\(folder, api\);/u);
  assert.match(mappingFixture, /await api\.refreshVisibleEditorDecorations\(\);/u);
  assert.match(mappingFixture, /await api\.drainVisibleEditorDecorations\(\);/u);
  assert.doesNotMatch(mappingFixture, /within\(`(?:refresh|drain) mapped \$\{name\}`/u);
});

test("T609 production activation does not retain the obsolete Test-only mapping seed", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "extension.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.doesNotMatch(extension, /seedT609InitialReviewedRanges/u);
  assert.doesNotMatch(hostSuite, /seedT609InitialReviewedRanges/u);
});

test("T609 single-root uses public mixed-encoding marks after startup settlement without making background Test fakes a command gate", async () => {
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
  const composition = await readFile(path.join(projectRoot, "src", "t305-extension.ts"), "utf8");
  assert.match(composition, /new TestReviewStateDependentQueue\(/u);
  assert.match(composition, /enqueueAll\(\)/u);
  assert.doesNotMatch(hostSuite, /drainReviewStateDependentsForTest/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("Shift-JIS", shiftedEditor, api\)/u);
  assert.match(hostSuite, /markAndSynchronizeFixtureReview\("UTF-8 BOM", utf8Editor, api\)/u);
});

test("T609 production composition passes the shared validated mapping settings to Git revision mapping", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "extension.ts"), "utf8");
  const liveEdit = await readFile(path.join(projectRoot, "src", "t305-extension.ts"), "utf8");
  const configuration = await readFile(
    path.join(projectRoot, "src", "application", "configuration", "review-range-mapping-options.ts"),
    "utf8"
  );

  assert.match(configuration, /export const readReviewRangeMappingOptions/u);
  assert.match(configuration, /return resolveReviewRangeMappingOptions\(/u);
  assert.match(extension, /gitMappingOptions:\s*readReviewRangeMappingOptions\(\s*vscode\.workspace\.getConfiguration\("reviewRange"\)\s*\)/u);
  assert.match(liveEdit, /options:\s*readReviewRangeMappingOptions\(\s*vscode\.workspace\.getConfiguration\("reviewRange"\)\s*\)/u);
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

test("T609 Host observes actual VS Code URI safety and persisted encoding mapping without Test mutation seams", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "t305-extension.ts"), "utf8");
  const reviewContexts = await readFile(path.join(projectRoot, "src", "t405-review-contexts-runtime.ts"), "utf8");
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");

  assert.match(extension, /getT305WorkspaceUriPathForTest/u);
  assert.match(extension, /getT405WorkspaceUriPathForTest/u);
  assert.match(extension, /getGitReviewStateSnapshotForTest/u);
  assert.match(reviewContexts, /workspaceUriToFilesystemPathForTest/u);
  assert.match(hostSuite, /vscode\.Uri\.file/u);
  assert.match(hostSuite, /query-bearing file Uri must be rejected/u);
  assert.match(hostSuite, /fragment-bearing file Uri must be rejected/u);
  assert.match(hostSuite, /await vscode\.commands\.executeCommand\("reviewRange\.refreshContext"\);/u);
  assert.match(hostSuite, /await vscode\.commands\.executeCommand\("reviewRange\.refreshReviewContexts"\);/u);
  assert.match(hostSuite, /assertLiveEncodingTransition/u);
  assert.match(hostSuite, /getGitReviewStateSnapshotForTest/u);
  assert.doesNotMatch(hostSuite, /seed.*Encoding.*ForTest/u);
});

test("T609 mixed-encoding composition observes persisted Shift-JIS state at every public boundary", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const mixedStart = hostSuite.indexOf("const assertMixedEncodingFixture = async");
  const mixedEnd = hostSuite.indexOf("const findStateFile", mixedStart);
  assert.ok(mixedStart >= 0 && mixedEnd > mixedStart);

  const mixedFixture = hostSuite.slice(mixedStart, mixedEnd);
  for (const boundary of ["Shift-JIS public mark", "UTF-8 BOM public mark", "Global refresh"]) {
    assert.equal(
      mixedFixture.includes(`assertPersistedMixedEncodingBoundary("${boundary}", shifted, api)`),
      true,
      `${boundary} must retain the same read-only persisted-state observation`
    );
  }
  assert.match(
    hostSuite,
    /owner=\$\{snapshot\.owner\}; repositoryId=\$\{snapshot\.repositoryId\}; contextId=\$\{snapshot\.contextId\}; contextFiles=\$\{JSON\.stringify\(snapshot\.contextFiles\)\}; globalFiles=\$\{JSON\.stringify\(snapshot\.globalFiles\)\}/u
  );
  assert.doesNotMatch(hostSuite, /seed.*MixedEncoding.*ForTest/u);
});

test("T609 persisted Git snapshot reads the Current Context owner without mutating state", async () => {
  const extension = await readFile(path.join(projectRoot, "src", "t305-extension.ts"), "utf8");
  const snapshotStart = extension.indexOf("const gitReviewStateSnapshotForTest");
  const snapshotEnd = extension.indexOf("return {", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);

  const snapshot = extension.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /selectedContext\?\.kind === "pull-request"/u);
  assert.match(snapshot, /kind:\s*"pull-request" as const,\s*repositoryId:\s*selectedContext\.repositoryId,\s*contextId:\s*selectedContext\.contextId/u);
  assert.match(snapshot, /selectedContext\?\.kind === "workspace"/u);
  assert.match(snapshot, /selectedContext\?\.kind === "branch"/u);
  assert.match(snapshot, /selectedContext\?\.kind === "detached"/u);
  assert.match(snapshot, /reviewStateRepository\.load\(target\)/u);
  assert.doesNotMatch(snapshot, /reviewStateRepository\.(?:save|commit|create)\(/u);
});

test("T609 virtual URI boundary commands use the owned single-root deadline", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const runner = await readFile(path.join(projectRoot, "test/vscode/run-extension-host.ts"), "utf8");
  const boundaryStart = hostSuite.indexOf("const assertActualUriBoundaries = async");
  const boundaryEnd = hostSuite.indexOf("const assertLiveEncodingTransition", boundaryStart);
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart);

  const boundaries = hostSuite.slice(boundaryStart, boundaryEnd);
  for (const command of [
    'await vscode.commands.executeCommand("reviewRange.refreshContext");',
    'await vscode.commands.executeCommand("reviewRange.refreshReviewContexts");'
  ]) {
    assert.equal(boundaries.includes(command), true, `virtual URI fixture must directly await ${command}`);
  }
  assert.doesNotMatch(boundaries, /within\("virtual (?:Current Context|Review Contexts) boundary"/u);
  assert.match(runner, /const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000;/u);
});

test("T609 live encoding transition re-decodes the open document without waiting for model disposal", async () => {
  const hostSuite = await readFile(path.join(projectRoot, "test/vscode/t609-suite/index.ts"), "utf8");
  const transitionStart = hostSuite.indexOf("const assertLiveEncodingTransition = async");
  const transitionEnd = hostSuite.indexOf("const assertMappedGitTransitions", transitionStart);
  assert.ok(transitionStart >= 0 && transitionEnd > transitionStart);
  const transition = hostSuite.slice(transitionStart, transitionEnd);

  assert.match(transition, /vscode\.workspace\.openTextDocument\(shiftedUri, \{ encoding: "utf8" \}\)/u);
  assert.match(transition, /assert\.equal\(reopened\.encoding, "utf8"/u);
  assert.doesNotMatch(transition, /closeDocument\(shifted\)|onDidCloseTextDocument|tabGroups\.close/u);
  assert.match(
    hostSuite,
    /assert\.equal\(bom\.isClosed, false, "the unrelated opened document must remain observed"\)/u,
    "the live transition must retain the independent UTF-8 BOM document"
  );
});
