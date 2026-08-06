import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubPullRequestContextId,
  type GitHubPullRequestContextLayer,
} from "../../src/application/github-pr-context/index.js";
import { NodeGitHubPullRequestContextLayerStore } from "../../src/adapters/github/index.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function layer(overrides: Partial<GitHubPullRequestContextLayer> = {}): GitHubPullRequestContextLayer {
  return {
    contextId: createGitHubPullRequestContextId({ host: "github.com", owner: "ssaattww", repository: "RevMem", pullRequestNumber: 48 }),
    host: "github.com", owner: "ssaattww", repository: "RevMem", pullRequestNumber: 48,
    baseRevision: SHA_A, headRevision: SHA_B, state: "open", decorationEnabled: true,
    updatedAt: "2026-08-06T09:45:00.000Z",
    files: { "src/example.ts": [{ startLine: 1, endLineExclusive: 3 }] },
    ...overrides,
  };
}

test("commit追加でも同じPR context IDを継続してrevisionだけ更新する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-")); const store = new NodeGitHubPullRequestContextLayerStore(root); const initial = layer(); await store.upsert(initial);
  const updated = await store.upsert(layer({ headRevision: SHA_C, updatedAt: "2026-08-06T09:50:00.000Z" }));
  assert.equal(updated.contextId, initial.contextId); assert.equal(updated.headRevision, SHA_C); assert.deepEqual(updated.files, initial.files);
});

test("別PRは別layerとして保存し再起動後も復元する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-")); const store = new NodeGitHubPullRequestContextLayerStore(root); await store.upsert(layer());
  await store.upsert(layer({ contextId: createGitHubPullRequestContextId({ host: "github.com", owner: "ssaattww", repository: "RevMem", pullRequestNumber: 49 }), pullRequestNumber: 49 }));
  const restored = await new NodeGitHubPullRequestContextLayerStore(root).list(); assert.equal(restored.length, 2); assert.notEqual(restored[0]?.contextId, restored[1]?.contextId);
});

test("closedまたはmerged PRは既定で装飾を無効化する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-")); const store = new NodeGitHubPullRequestContextLayerStore(root);
  assert.equal((await store.upsert(layer({ state: "closed", decorationEnabled: true }))).decorationEnabled, false);
  assert.equal((await store.upsert(layer({ state: "merged", decorationEnabled: true }))).decorationEnabled, false);
});

test("globalStorage配下にはsource本文やtokenを含まないversioned JSONだけを保存する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-")); const store = new NodeGitHubPullRequestContextLayerStore(root); await store.upsert(layer());
  const persisted = await readFile(path.join(root, "github-pr-context-layers.v1.json"), "utf8"); assert.match(persisted, /\"version\":1/); assert.doesNotMatch(persisted, /token|sourceText|authorization/i);
});

test("不正なcontext identity、revision、interval、永続化内容はfail closedにする", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "revmem-t404-")); const store = new NodeGitHubPullRequestContextLayerStore(root);
  await assert.rejects(() => store.upsert(layer({ headRevision: "HEAD" })));
  await assert.rejects(() => store.upsert(layer({ files: { "src/example.ts": [{ startLine: 3, endLineExclusive: 2 }] } })));
});
