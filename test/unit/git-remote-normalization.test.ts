import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { normalizeGitRemoteUrl } from "../../src/adapters/local-git/index";

test("default protocol ports do not split equivalent remote identities", () => {
  assert.equal(
    normalizeGitRemoteUrl("ssh://git@github.com:22/Owner/Repository.git"),
    "github.com/owner/repository"
  );
  assert.equal(
    normalizeGitRemoteUrl("git://github.com:9418/Owner/Repository.git"),
    "github.com/owner/repository"
  );
  assert.equal(
    normalizeGitRemoteUrl("https://github.com:443/Owner/Repository.git"),
    "github.com/owner/repository"
  );
});

test("relative local remotes resolve from the repository root", () => {
  const repositoryRoot = path.join(process.cwd(), "workspace", "repository");
  const resolvedRemote = path.resolve(repositoryRoot, "../bare/project.git");
  const expected = pathToFileURL(resolvedRemote).href.replace(/\.git$/iu, "");

  assert.equal(
    normalizeGitRemoteUrl("../bare/project.git", repositoryRoot),
    expected
  );
});

test("file URLs remove only the repository suffix", () => {
  assert.equal(
    normalizeGitRemoteUrl("file:///C:/Work/Bare/Repository.git"),
    "file:///C:/Work/Bare/Repository"
  );
});

test("UNC file remotes preserve their server authority", () => {
  assert.equal(
    normalizeGitRemoteUrl("file://BuildServer/Share/Repository.git"),
    "file://buildserver/Share/Repository"
  );
});
