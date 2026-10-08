import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPr108ProductionFixture } from "../test-dist/test/helpers/pr108-production-fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runCount = Number(process.env.BENCH_ITERATIONS ?? "3");
if (!Number.isSafeInteger(runCount) || runCount < 3) {
  throw new RangeError("BENCH_ITERATIONS must be an integer of at least 3");
}
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const summarize = (rows, key) => {
  const values = rows.map((row) => row[key]).sort((left, right) => left - right);
  return {
    values,
    arithmeticMean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: values[Math.floor(values.length / 2)],
    range: values.at(-1) - values[0],
  };
};
const environment = {
  head: git("rev-parse", "HEAD"),
  branch: git("branch", "--show-current"),
  dirty: git("status", "--porcelain=v1").length > 0,
  os: `${platform()} ${release()} ${arch()}`,
  node: process.version,
  git: git("--version"),
  fileCount: 1000,
  linesPerFile: 1000,
  totalSyntheticLines: 1_000_000,
  changedLinesPerFile: 1,
};
console.log(JSON.stringify({ environment }));

const scenarioSummaries = {};
for (const scenario of [
  { name: "all-files-changed", changedFileCount: 1000 },
  { name: "one-file-changed", changedFileCount: 1 },
]) {
  const rows = [];
  for (let iteration = 1; iteration <= runCount; iteration += 1) {
    const fixture = await createPr108ProductionFixture({
      contexts: [],
      contextHead: "D",
      ownerHead: "D",
      syntheticRepository: {
        fileCount: environment.fileCount,
        linesPerFile: environment.linesPerFile,
        changedLinesPerFile: environment.changedLinesPerFile,
        changedFileCount: scenario.changedFileCount,
      },
    });
    try {
      const sourceDirectory = path.join(fixture.root, "repository", "src");
      const syntheticBytes = readdirSync(sourceDirectory)
        .reduce((total, entry) => total + statSync(path.join(sourceDirectory, entry)).size, 0);
      let startedAt = performance.now();
      await fixture.invoke("reviewRange.redetectPullRequest");
      const detectionMs = performance.now() - startedAt;
      const registration = fixture.registrations[0];
      if (registration === undefined) throw new Error("Production PR redetection did not register a context");
      const snapshot = fixture.review.snapshotForContext(registration.contextId);
      const afterDetection = fixture.metrics();

      startedAt = performance.now();
      await fixture.review.activateProgress(registration.contextId);
      const coldProgressMs = performance.now() - startedAt;
      const treeItems = fixture.review.progress.getChildren()
        .reduce((sum, category) => sum + fixture.review.progress.getChildren(category).length, 0);

      startedAt = performance.now();
      await fixture.review.activateProgress(registration.contextId);
      const warmProgressMs = performance.now() - startedAt;
      const metrics = fixture.metrics();
      if (snapshot?.files.length !== scenario.changedFileCount || treeItems !== scenario.changedFileCount) {
        throw new Error(`PR snapshot/tree size mismatch: ${JSON.stringify({ files: snapshot?.files.length, treeItems })}`);
      }
      if (fixture.errors.length !== 0) throw new Error(`Production refresh returned errors: ${fixture.errors.length}`);

      const row = {
        scenario: scenario.name,
        iteration,
        syntheticBytes,
        changedFiles: scenario.changedFileCount,
        additions: scenario.changedFileCount,
        deletions: scenario.changedFileCount,
        detectionMs,
        diffAcquisitionMs: afterDetection.diffAcquisitionMilliseconds,
        diffAcquisitionCount: afterDetection.diffAcquisitionCount,
        stateCreateCount: afterDetection.stateCreateCount,
        stateCommitCount: afterDetection.stateCommitCount,
        stateSaveMs: afterDetection.stateSaveMilliseconds,
        localContentReadCountAfterProgress: metrics.revisionContentReadCount,
        localContentReadMsAfterProgress: metrics.revisionContentReadMilliseconds,
        coldProgressMs,
        warmProgressMs,
        githubFixtureRequests: afterDetection.githubFetchRequests,
        reviewContextsTreeNotifications: afterDetection.providerTreeChangeEvents,
        snapshotFiles: snapshot.files.length,
        treeItems,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    } finally {
      await fixture.dispose();
    }
  }
  scenarioSummaries[scenario.name] = Object.fromEntries(
    ["detectionMs", "diffAcquisitionMs", "stateSaveMs", "localContentReadMsAfterProgress", "coldProgressMs", "warmProgressMs"]
      .map((key) => [key, summarize(rows, key)]),
  );
}

const duplicateFixture = await createPr108ProductionFixture({
  contexts: [],
  contextHead: "D",
  ownerHead: "D",
  syntheticRepository: { fileCount: 3, linesPerFile: 3, changedLinesPerFile: 1 },
});
try {
  const startedAt = performance.now();
  await Promise.all([
    duplicateFixture.invoke("reviewRange.redetectPullRequest"),
    duplicateFixture.invoke("reviewRange.redetectPullRequest"),
  ]);
  const simultaneousMs = performance.now() - startedAt;
  const overlapping = {
    elapsedMs: simultaneousMs,
    registrations: duplicateFixture.registrations.length,
    savedContext: (await duplicateFixture.state(52)) !== undefined,
    metrics: duplicateFixture.metrics(),
  };
  const repeatStartedAt = performance.now();
  await duplicateFixture.invoke("reviewRange.redetectPullRequest");
  console.log(JSON.stringify({
    duplicateAndRepeat: {
      overlapping,
      sequentialRepeatMs: performance.now() - repeatStartedAt,
      afterRepeat: {
        registrations: duplicateFixture.registrations.length,
        savedContext: (await duplicateFixture.state(52)) !== undefined,
        metrics: duplicateFixture.metrics(),
      },
    },
  }));
} finally {
  await duplicateFixture.dispose();
}

console.log(JSON.stringify({ scenarioSummaries }));
