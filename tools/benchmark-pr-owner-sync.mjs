import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPr108ProductionFixture } from "../test-dist/test/helpers/pr108-production-fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const iterations = Number(process.env.BENCH_ITERATIONS ?? "3");
const responseDelayMilliseconds = Number(process.env.BENCH_GITHUB_DELAY_MS ?? "5");
const headMode = process.env.BENCH_HEAD_MODE ?? "same";
const contextCounts = (process.env.BENCH_CONTEXT_COUNTS ?? "1,10,40").split(",").map(Number);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new RangeError("BENCH_ITERATIONS must be positive");
if (!Number.isSafeInteger(responseDelayMilliseconds) || responseDelayMilliseconds < 0) {
  throw new RangeError("BENCH_GITHUB_DELAY_MS must be a non-negative integer");
}
if (headMode !== "same" && headMode !== "distinct") throw new RangeError("BENCH_HEAD_MODE must be same or distinct");
if (contextCounts.length === 0 || contextCounts.some((count) => !Number.isSafeInteger(count) || count < 1)) {
  throw new RangeError("BENCH_CONTEXT_COUNTS must be a comma-separated list of positive integers");
}
const summary = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    values,
    arithmeticMean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    range: sorted.at(-1) - sorted[0],
  };
};

console.log(JSON.stringify({
  environment: {
    head: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    node: process.version,
    git: git("--version"),
    githubApi: "mocked GET fixtures",
    perHttpResponseDelayMs: responseDelayMilliseconds,
    headMode,
    cache: "fresh fixture and Review State per run; OS cache not cleared",
  },
}));

for (const contextCount of contextCounts) {
  const rows = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const contexts = Array.from({ length: contextCount }, (_, index) => 52 + index);
    const fixtureStartedAt = performance.now();
    const fixture = await createPr108ProductionFixture({
      contexts,
      contextHead: "D",
      ownerHead: "D",
      distinctRemoteHeads: headMode === "distinct",
      operationFeedback: true,
      githubResponseDelayMilliseconds: responseDelayMilliseconds,
      syntheticRepository: { fileCount: 1, linesPerFile: 1000, changedLinesPerFile: 1 },
    });
    const fixtureSetupMs = performance.now() - fixtureStartedAt;
    try {
      const before = fixture.metrics();
      const startedAt = performance.now();
      await fixture.invoke("reviewRange.redetectPullRequest");
      const redetectionMs = performance.now() - startedAt;
      const after = fixture.metrics();
      const refreshStages = after.refreshDiagnostics.slice(before.refreshDiagnostics.length);
      const requestIntervals = after.githubFetchIntervals.slice(before.githubFetchIntervals.length);
      const requestEvents = requestIntervals.flatMap(({ startedAt, endedAt }) => [
        { at: startedAt, delta: 1 }, { at: endedAt, delta: -1 },
      ]).sort((left, right) => left.at - right.at || left.delta - right.delta);
      let activeRequests = 0;
      let maxConcurrentGithubRequests = 0;
      for (const event of requestEvents) {
        activeRequests += event.delta;
        maxConcurrentGithubRequests = Math.max(maxConcurrentGithubRequests, activeRequests);
      }
      const requestBoundaries = [...new Set(requestIntervals.flatMap(({ startedAt, endedAt }) => [startedAt, endedAt]))]
        .sort((left, right) => left - right);
      const githubRequestWallUnionMs = requestBoundaries.slice(0, -1).reduce((sum, boundary, index) => {
        const next = requestBoundaries[index + 1];
        return sum + (next - boundary) * (requestIntervals.some((interval) => interval.startedAt < next && interval.endedAt > boundary) ? 1 : 0);
      }, 0);
      const stageEvents = refreshStages.map(({ stage, status, durationMs }) => ({ stage, status, durationMs }));
      const row = {
        contextCount,
        iteration,
        fixtureSetupMs,
        redetectionMs,
        githubRequests: after.githubFetchRequests - before.githubFetchRequests,
        githubRequestMs: after.githubFetchMilliseconds - before.githubFetchMilliseconds,
        githubRequestWallUnionMs,
        maxConcurrentGithubRequests,
        stageEvents,
        gitSubprocessMs: after.gitSubprocessMilliseconds - before.gitSubprocessMilliseconds,
        stateSaveMs: after.stateSaveMilliseconds - before.stateSaveMilliseconds,
        reviewStateReads: Object.fromEntries(Object.entries(after.stateReadCounts).map(([method, count]) => [
          method, count - before.stateReadCounts[method],
        ])),
        contentReadMs: after.revisionContentReadMilliseconds - before.revisionContentReadMilliseconds,
        diffAcquisitionMs: after.diffAcquisitionMilliseconds - before.diffAcquisitionMilliseconds,
        githubRequestCountsByPath: Object.fromEntries(Object.entries(after.githubFetchRequestCountsByPath).map(([endpoint, count]) => [
          endpoint,
          count - (before.githubFetchRequestCountsByPath[endpoint] ?? 0),
        ]).filter(([, count]) => count > 0)),
        diffAcquisitions: after.diffAcquisitionCount - before.diffAcquisitionCount,
        statePublications: after.ownerPublications - before.ownerPublications,
        providerTreeNotifications: after.providerTreeChangeEvents - before.providerTreeChangeEvents,
        projectionGenerations: after.projectionGenerationCount - before.projectionGenerationCount,
        registrations: fixture.registrations.length,
        errors: fixture.errors.length,
      };
      if (row.errors !== 0 || row.registrations < contextCount) throw new Error(`Production redetection failed: ${JSON.stringify(row)}`);
      rows.push(row);
      console.log(JSON.stringify(row));
    } finally {
      await fixture.dispose();
    }
  }
  console.log(JSON.stringify({
    contextCountSummary: contextCount,
    redetectionMs: summary(rows.map((row) => row.redetectionMs)),
    fixtureSetupMs: summary(rows.map((row) => row.fixtureSetupMs)),
    githubRequests: summary(rows.map((row) => row.githubRequests)),
    githubRequestMs: summary(rows.map((row) => row.githubRequestMs)),
  }));
}
