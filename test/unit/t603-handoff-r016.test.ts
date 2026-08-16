import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

const packetPath = path.resolve(
  process.cwd(),
  "handoffs/issue-1-t603-fix-followup-r4-20260817.yaml"
);

const requiredTopLevel = [
  "schema_version", "producer", "repository", "issue_or_pr", "task_id", "branch", "base_ref",
  "target", "authoritative_requirements", "development_policy", "validation_plan", "blocked",
  "authorized_actions", "write_boundary", "scope", "non_goals", "files", "commands", "tests", "ci",
  "implementation", "review", "report", "findings", "held", "unexplored", "unknown", "not_applicable",
  "remaining_risks", "source_payloads", "extensions", "next_action", "transport"
] as const;

const expectedPayloadHashes = new Map<string, string>([
  ["work-context-manager", "7f3f60762a18201d6ec544ad441d5e86ba592e0badec60d45b1c37f3c7728d66"],
  ["implementation-worker", "34f71524c08058b5acc9911be36ba70bd8cdea6cd44616cfa3c09d6a93d849c5"],
  ["report-writer", "c5be4e061e91a431e14eda4a200d20f57225d9c2e62e567c92e012e6ff66c861"],
  ["chat-implementation-worker", "aa55072ffdb36bfe31da24c801af1f7686f72029798f3cf88eb079aa558166a3"]
]);

const requireKeys = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  for (const key of keys) assert.ok(key in record, `missing required source field: ${key}`);
  return record;
};

test("T603-R016 replacement handoff is schema-v3 lossless and self-consistent", async () => {
  const text = await readFile(packetPath, "utf8");
  assert.match(text, /^schema_version: 3$/mu);
  assert.doesNotMatch(text, /(^|[\s:])[&*][A-Za-z0-9_-]+/u, "YAML anchors and aliases are forbidden");

  const topLevel = [...text.matchAll(/^([a-z_]+):(?:\s|$)/gmu)].map((match) => match[1]!);
  assert.equal(new Set(topLevel).size, topLevel.length, "duplicate top-level YAML mapping key");
  assert.deepEqual([...topLevel].sort(), [...requiredTopLevel].sort());

  const currentHead = /^ {2}current_head: ([0-9a-f]{40})$/mu.exec(text)?.[1];
  const reviewedHead = /^ {2}reviewed_head: ([0-9a-f]{40})$/mu.exec(text)?.[1];
  const ciHead = /^ {2}head_sha: ([0-9a-f]{40})$/gmu;
  assert.equal(currentHead, "ce761bf229d17e7f2d4659b7c4b05d99fbed0ade");
  assert.equal(reviewedHead, "80f96d523614cea4eb6d0213450a7a456b0d47bf");
  const ciHeads = [...text.matchAll(ciHead)].map((match) => match[1]!);
  assert.ok(ciHeads.includes(currentHead!));
  assert.match(text, /^ {2}run_id: 31975462211$/mu);
  assert.match(text, /^ {2}conclusion: success$/mu);
  assert.match(text, /^ {2}final_head: ce761bf229d17e7f2d4659b7c4b05d99fbed0ade$/mu);

  const payloadPattern = /^- source_skill: ([^\n]+)\n {2}output_contract_version: ([^\n]+)\n {2}content_type: other\n {2}payload: gzip\+base64:([A-Za-z0-9+/=]+)$/gmu;
  const payloads = [...text.matchAll(payloadPattern)];
  assert.equal(payloads.length, 4);
  assert.deepEqual(
    payloads.map((match) => match[1]!).sort(),
    [...expectedPayloadHashes.keys()].sort()
  );

  for (const match of payloads) {
    const sourceSkill = match[1]!;
    const encoded = match[3]!;
    const compressed = Buffer.from(encoded, "base64");
    assert.equal(compressed.toString("base64"), encoded, `${sourceSkill} payload must be canonical base64`);
    const decoded = gunzipSync(compressed);
    assert.equal(
      createHash("sha256").update(decoded).digest("hex"),
      expectedPayloadHashes.get(sourceSkill),
      `${sourceSkill} decoded payload hash mismatch`
    );
    const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
    if (sourceSkill === "work-context-manager") {
      requireKeys(parsed, [
        "repository", "issue_or_pr", "task_id", "mode", "branch", "base_ref", "current_head",
        "reviewed_head", "scope", "non_goals", "authoritative_requirements", "write_boundary",
        "development_policy", "validation", "ci", "unknown", "blocked", "remaining_risks"
      ]);
    } else if (sourceSkill === "implementation-worker") {
      requireKeys(parsed, [
        "mode", "accepted_scope", "non_goals", "requirements_and_design_references",
        "changed_files_and_purpose", "intentionally_untouched_areas", "validation_commands_and_results",
        "failure_diagnostics_and_artifacts", "commit_identities", "final_head_sha", "matching_ci_run",
        "blocked_items", "unknowns", "remaining_risks", "next_required_action"
      ]);
    } else if (sourceSkill === "report-writer") {
      const report = requireKeys(parsed, [
        "report_type", "complete_body", "evidence_sources", "target_identity", "severity_records",
        "persistence", "concise_pr_comment_body", "unresolved_discrepancies"
      ]);
      assert.equal(report.report_type, "implementation_report");
      assert.match(String(report.complete_body), /^# T603 fix-verification R4 指摘対応 report/mu);
    } else {
      const wrapper = requireKeys(parsed, [
        "mode", "required_skills", "runtime", "permissions_applied", "repository_updates",
        "review_verdict_issued", "merge_performed", "next_chat"
      ]);
      assert.equal(wrapper.review_verdict_issued, false);
      assert.equal(wrapper.merge_performed, false);
    }
  }
});
