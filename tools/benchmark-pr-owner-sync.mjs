import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPr108ProductionFixture } from "../test-dist/test/helpers/pr108-production-fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const iterations = Number(process.env.BENCH_ITERATIONS ?? "3");
const responseDelayMilliseconds = Number(process.env.BENCH_GITHUB_DELAY_MS ?? "5");
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new RangeError("BENCH_ITERATIONS must be positive");
if (!Number.isSafeInteger(responseDelayMilliseconds) || responseDelayMilliseconds < 0) {
  throw new RangeError("BENCH_GITHUB_DELAY_MS must be a non-negative integer");
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
    cache: "fresh fixture and Review State per run; OS cache not cleared",
  },
}));

for (const contextCount of [1, 10, 40]) {
  const rows = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const contexts = Array.from({ length: contextCount }, (_, index) => 52 + index);
    const fixture = await createPr108ProductionFixture({
      contexts,
      contextHead: "D",
      ownerHead: "D",
      githubResponseDelayMilliseconds: responseDelayMilliseconds,
      syntheticRepository: { fileCount: 1, linesPerFile: 1000, changedLinesPerFile: 1 },
    });
    try {
      const before = fixture.metrics();
      const startedAt = performance.now();
      await fixture.invoke("reviewRange.redetectPullRequest");
      const redetectionMs = performance.now() - startedAt;
      const after = fixture.metrics();
      const row = {
        contextCount,
        iteration,
        redetectionMs,
        githubRequests: after.githubFetchRequests - before.githubFetchRequests,
        githubRequestMs: after.githubFetchMilliseconds - before.githubFetchMilliseconds,
        githubRequestCountsByPath: Object.fromEntries(Object.entries(after.githubFetchRequestCountsByPath).map(([endpoint, count]) => [
          endpoint,
          count - (before.githubFetchRequestCountsByPath[endpoint] ?? 0),
        ]).filter(([, count]) => count > 0)),
        diffAcquisitions: after.diffAcquisitionCount - before.diffAcquisitionCount,
        statePublications: after.ownerPublications - before.ownerPublications,
        providerTreeNotifications: after.providerTreeChangeEvents - before.providerTreeChangeEvents,
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
    githubRequests: summary(rows.map((row) => row.githubRequests)),
    githubRequestMs: summary(rows.map((row) => row.githubRequestMs)),
  }));
}
