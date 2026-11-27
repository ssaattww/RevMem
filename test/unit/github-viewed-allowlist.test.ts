import assert from "node:assert/strict";
import test from "node:test";

import {
  findGitHubViewedGrant,
  readGitHubViewedIfAllowed
} from "../../src/adapters/github/github-viewed-allowlist";

const target = {
  host: "github.com",
  owner: "example",
  repository: "reviewed-repo"
};
const grant = {
  host: "github.com",
  owner: "example",
  repository: "reviewed-repo",
  login: "known-reviewer",
  viewerId: "U_mock"
};

test("empty or nonmatching allowlist denies before session acquisition", async () => {
  let sessionCalls = 0;
  const run = (configured: unknown) => readGitHubViewedIfAllowed({
    configured,
    target,
    getSilentSession: async () => { sessionCalls++; return { token: "mock" }; },
    readViewer: async () => ({ id: "U1", login: "known-reviewer" }),
    readFiles: async () => ["mock-file"]
  });

  assert.deepEqual(await run([]), { kind: "not-allowed" });
  assert.deepEqual(await run([{ ...grant, repository: "other-repo" }]), { kind: "not-allowed" });
  assert.deepEqual(await run([{host: "github.com", owner: target.owner, repository: target.repository, login: grant.login}]), { kind: "not-allowed" });
  assert.equal(sessionCalls, 0);
});

test("requires one exact tuple and rejects ambiguous duplicate grants", () => {
  assert.equal(findGitHubViewedGrant([grant], target)?.login, "known-reviewer");
  assert.equal(findGitHubViewedGrant([{ ...grant, repository: "*" }], target), undefined);
  assert.equal(findGitHubViewedGrant([grant, grant], target), undefined);
  assert.equal(findGitHubViewedGrant([{ ...grant, host: "https://github.com/path" }], target), undefined);
});

test("viewer login or stable ID mismatch stops before changed-file listing", async () => {
  let fileListCalls = 0;
  const attempt = (viewer: { id: string; login: string }) => readGitHubViewedIfAllowed({
    configured: [grant],
    target,
    getSilentSession: async () => ({ token: "mock" }),
    readViewer: async () => viewer,
    readFiles: async () => { fileListCalls++; return ["mock-file"]; }
  });

  assert.deepEqual(await attempt({ id: grant.viewerId, login: "someone-else" }), { kind: "viewer-mismatch" });
  assert.deepEqual(await attempt({ id: "U_other", login: grant.login }), { kind: "viewer-mismatch" });
  assert.equal(fileListCalls, 0);
});

test("matching login lists files with the same session and viewer ID", async () => {
  const session = { token: "mock-session" };
  let sessionCalls = 0;
  let viewerCalls = 0;
  let seenSession: typeof session | undefined;
  let seenViewerId: string | undefined;

  const result = await readGitHubViewedIfAllowed({
    configured: [grant],
    target,
    getSilentSession: async () => { sessionCalls++; return session; },
    readViewer: async (current) => {
      viewerCalls++;
      seenSession = current;
      return { id: "U_mock", login: "KNOWN-REVIEWER" };
    },
    readFiles: async (current, viewer) => {
      assert.equal(current, session);
      seenSession = current;
      seenViewerId = viewer.id;
      return ["mock-file"];
    }
  });

  assert.equal(result.kind, "available");
  assert.equal(sessionCalls, 1);
  assert.equal(viewerCalls, 1);
  assert.equal(seenSession, session);
  assert.equal(seenViewerId, "U_mock");
});

test("revocation during viewer read never starts the files query", async () => {
  let active = true;
  let fileCalls = 0;
  const result = await readGitHubViewedIfAllowed({
    configured: [grant],
    target,
    isCurrent: () => active,
    getSilentSession: async () => ({ token: "mock" }),
    readViewer: async () => {
      active = false;
      return { id: "U1", login: "known-reviewer" };
    },
    readFiles: async () => { fileCalls++; return ["mock-file"]; }
  });
  assert.deepEqual(result, { kind: "stale" });
  assert.equal(fileCalls, 0);
});

test("Phase 1 never acquires a session for a non-github.com target", async () => {
  const enterprise = { ...target, host: "github.example.com" };
  let sessionCalls = 0;
  const result = await readGitHubViewedIfAllowed({
    configured: [{ ...grant, host: enterprise.host }],
    target: enterprise,
    getSilentSession: async () => { sessionCalls++; return { token: "mock" }; },
    readViewer: async () => ({ id: grant.viewerId, login: grant.login }),
    readFiles: async () => ["mock-file"]
  });
  assert.deepEqual(result, { kind: "not-allowed" });
  assert.equal(sessionCalls, 0);
});
