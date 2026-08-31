import assert from "node:assert/strict";
import test from "node:test";

import { NodeSha256StableHash } from "../../src/adapters/crypto/index";
import {
  GitContextRevisionMapper,
  GitReviewContextResolver,
  type GitRevisionMappingSource
} from "../../src/application/review-context/index";
import {
  REVIEW_RANGE_SCHEMA_VERSION,
  type RepositoryGlobalState,
  type RepositoryGlobalRevisionSnapshot,
  type ReviewContextRevisionSnapshot,
  type ReviewContextState
} from "../../src/core/contracts/index";

const oldRevision = "0123456789abcdef0123456789abcdef01234567";
const newRevision = "89abcdef0123456789abcdef0123456789abcdef";
const repositoryId = "github.com/example/review-range";
const occurredAt = "2026-08-01T06:15:00.000Z";
const stableHash = new NodeSha256StableHash();

class BinaryAwareRevisionSource implements GitRevisionMappingSource {
  public async objectExists(): Promise<boolean> {
    return true;
  }

  public async diffRevisions(): Promise<string> {
    return [
      "diff --git a/src/example.ts b/src/example.ts",
      "index 1111111..2222222 100644",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -2 +2 @@",
      "-beta",
      "+BETA",
      "diff --git a/assets/a b/add.bin b/assets/a b/add.bin",
      "new file mode 100644",
      "index 0000000..3333333",
      "Binary files /dev/null and b/assets/a b/add.bin differ",
      ""
    ].join("\n");
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    if (repositoryRelativePath === "assets/a b/add.bin") {
      return { kind: "invalid-encoding", encoding: "utf-8" };
    }
    if (repositoryRelativePath !== "src/example.ts") {
      return { kind: "missing-file" };
    }
    return {
      kind: "found",
      content: revision === oldRevision
        ? "alpha\nbeta\ngamma"
        : "alpha\nBETA\ngamma"
    };
  }
}

/** Binary additions are outside line review and must not abort mapping of text files. */
test("revision mapping ignores binary diff sections and maps text state", async () => {
  const resolver = new GitReviewContextResolver({
    stableHash,
    now: () => new Date(occurredAt)
  });
  const current = resolver.resolve({
    repositoryId,
    rootPath: "/repo",
    branch: { kind: "branch", fullRef: "refs/heads/main" },
    head: newRevision
  });
  const fileId = `repository-file:${stableHash.digest(
    ["repository-file", repositoryId, "src/example.ts"].join("\0")
  )}`;
  const contextState: ReviewContextState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    contextId: current.contextId,
    kind: "branch",
    repositoryId,
    displayName: "refs/heads/main",
    branch: {
      refName: "refs/heads/main",
      headRevision: oldRevision
    },
    files: {
      [fileId]: {
        schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
        fileId,
        currentPath: "src/example.ts",
        previousPaths: [],
        revisionId: oldRevision,
        modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
        originalReviewedByDiff: {},
        contentHash: stableHash.digest("alpha\nbeta\ngamma"),
        lineCount: 3,
        updatedAt: occurredAt
      }
    },
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const globalState: RepositoryGlobalState = {
    schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
    repositoryId,
    currentRevisionId: oldRevision,
    files: {
      [fileId]: {
        fileId,
        currentPath: "src/example.ts",
        revisionId: oldRevision,
        reviewed: [{ startLine: 0, endLineExclusive: 3 }],
        contentHash: stableHash.digest("alpha\nbeta\ngamma"),
        updatedAt: occurredAt
      }
    },
    updatedAt: occurredAt
  };
  const mapper = new GitContextRevisionMapper({
    source: new BinaryAwareRevisionSource(),
    stableHash,
    now: () => new Date(occurredAt)
  });

  const result = await mapper.map({
    current,
    contextState,
    globalState,
    fileSystemPathSemantics: "posix",
    options: {
      ignoreWhitespaceChanges: false,
      ignoreEolChanges: false
    }
  });

  assert.deepEqual(Object.keys(result.contextState.files), [fileId]);
  assert.deepEqual(Object.keys(result.globalState.files), [fileId]);
  assert.deepEqual(
    result.contextState.files[fileId]?.modifiedReviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );
  assert.deepEqual(
    result.globalState.files[fileId]?.reviewed,
    [
      { startLine: 0, endLineExclusive: 1 },
      { startLine: 2, endLineExclusive: 3 }
    ]
  );

  const restoredContextFile = {
    ...contextState.files[fileId]!,
    revisionId: newRevision,
    modifiedReviewed: [{ startLine: 0, endLineExclusive: 3 }],
    contentHash: stableHash.digest("alpha\nBETA\ngamma")
  };
  const restoredGlobalFile = {
    ...globalState.files[fileId]!,
    revisionId: newRevision,
    reviewed: [{ startLine: 0, endLineExclusive: 3 }],
    contentHash: stableHash.digest("alpha\nBETA\ngamma")
  };
  const exact = await mapper.map({
    current,
    contextState: {
      ...contextState,
      revisionSnapshots: {
        [newRevision]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          revisionId: newRevision,
          files: { [fileId]: restoredContextFile },
          updatedAt: occurredAt
        }
      }
    },
    globalState: {
      ...globalState,
      revisionSnapshots: {
        [newRevision]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          revisionId: newRevision,
          files: { [fileId]: restoredGlobalFile },
          updatedAt: occurredAt
        }
      }
    },
    fileSystemPathSemantics: "posix",
    options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
  });
  assert.deepEqual(exact.contextState.files[fileId]?.modifiedReviewed, [{ startLine: 0, endLineExclusive: 3 }]);
  assert.deepEqual(exact.globalState.files[fileId]?.reviewed, [{ startLine: 0, endLineExclusive: 3 }]);

  const contextTargetSnapshots: Record<string, ReviewContextRevisionSnapshot> = {
    [newRevision]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, revisionId: newRevision, files: { [fileId]: restoredContextFile }, updatedAt: occurredAt }
  };
  const globalTargetSnapshots: Record<string, RepositoryGlobalRevisionSnapshot> = {
    [newRevision]: { schemaVersion: REVIEW_RANGE_SCHEMA_VERSION, revisionId: newRevision, files: { [fileId]: restoredGlobalFile }, updatedAt: occurredAt }
  };
  for (const scenario of [
    {
      name: "Context hit and Global miss",
      contextSnapshots: contextTargetSnapshots,
      globalSnapshots: {} as Record<string, RepositoryGlobalRevisionSnapshot>,
      contextReviewed: [{ startLine: 0, endLineExclusive: 3 }],
      globalReviewed: [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }]
    },
    {
      name: "Context miss and Global hit",
      contextSnapshots: {} as Record<string, ReviewContextRevisionSnapshot>,
      globalSnapshots: globalTargetSnapshots,
      contextReviewed: [{ startLine: 0, endLineExclusive: 1 }, { startLine: 2, endLineExclusive: 3 }],
      globalReviewed: [{ startLine: 0, endLineExclusive: 3 }]
    }
  ] as const) {
    const mixed = await mapper.map({
      current,
      contextState: { ...contextState, revisionSnapshots: scenario.contextSnapshots },
      globalState: { ...globalState, revisionSnapshots: scenario.globalSnapshots },
      fileSystemPathSemantics: "posix",
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    });
    assert.equal(mixed.mappingDisposition, "mixed", scenario.name);
    assert.deepEqual(mixed.contextState.files[fileId]?.modifiedReviewed, scenario.contextReviewed, scenario.name);
    assert.deepEqual(mixed.globalState.files[fileId]?.reviewed, scenario.globalReviewed, scenario.name);
    assert.deepEqual(mixed.contextState.revisionSnapshots?.[newRevision]?.files, mixed.contextState.files, scenario.name);
    assert.deepEqual(mixed.globalState.revisionSnapshots?.[newRevision]?.files, mixed.globalState.files, scenario.name);
  }
});

class ExistingBinaryRevisionSource implements GitRevisionMappingSource {
  public constructor(
    private readonly binarySection: string,
    private readonly binaryPath: string
  ) {}

  public async objectExists(): Promise<boolean> {
    return true;
  }

  public async diffRevisions(): Promise<string> {
    return this.binarySection;
  }

  public async readTextFileAtRevision(
    _repositoryRoot: string,
    revision: string,
    repositoryRelativePath: string
  ): Promise<
    | { readonly kind: "found"; readonly content: string }
    | { readonly kind: "missing-revision" }
    | { readonly kind: "missing-file" }
    | { readonly kind: "invalid-encoding"; readonly encoding: "utf-8" }
  > {
    if (repositoryRelativePath !== this.binaryPath) {
      return { kind: "missing-file" };
    }
    return {
      kind: "found",
      content: revision === oldRevision ? "alpha\nbeta" : "alpha\0beta"
    };
  }
}

/** Git-declared binary paths are excluded even when their blob can be decoded as UTF-8. */
for (const [label, binaryPath, binarySection, expected] of [
  [
    "NUL-containing UTF-8",
    "assets/payload.bin",
    [
      "diff --git a/assets/payload.bin b/assets/payload.bin",
      "index 1111111..2222222 100644",
      "Binary files a/assets/payload.bin and b/assets/payload.bin differ",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "attribute-driven binary",
    "assets/payload.bin",
    [
      "diff --git a/assets/payload.bin b/assets/payload.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 10",
      "",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "quoted NUL-containing UTF-8",
    "assets/weird\tpayload.bin",
    [
      "diff --git \"a/assets/weird\\tpayload.bin\" \"b/assets/weird\\tpayload.bin\"",
      "index 1111111..2222222 100644",
      "Binary files \"a/assets/weird\\tpayload.bin\" and \"b/assets/weird\\tpayload.bin\" differ",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "quoted attribute-driven binary",
    "assets/weird\tpayload.bin",
    [
      "diff --git \"a/assets/weird\\tpayload.bin\" \"b/assets/weird\\tpayload.bin\"",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 10",
      "",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "non-quoted space-containing attribute-driven binary",
    "assets/payload file.bin",
    [
      "diff --git a/assets/payload file.bin b/assets/payload file.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 10",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "same-path b-slash binary",
    "assets/a b/same.bin",
    [
      "diff --git a/assets/a b/same.bin b/assets/a b/same.bin",
      "index 1111111..2222222 100644",
      "Binary files a/assets/a b/same.bin and b/assets/a b/same.bin differ",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "deleted b-slash binary",
    "assets/a b/removed.bin",
    [
      "diff --git a/assets/a b/removed.bin b/assets/a b/removed.bin",
      "deleted file mode 100644",
      "Binary files a/assets/a b/removed.bin and /dev/null differ",
      ""
    ].join("\n"),
    "excluded"
  ],
  [
    "unresolved b-slash binary",
    "x b/y",
    [
      "diff --git a/x b/y b/z",
      "GIT binary patch",
      "literal 10",
      ""
    ].join("\n"),
    "unreviewed"
  ]
] as const) {
  test(`revision mapping excludes existing ${label} files from reviewed state`, async () => {
    const resolver = new GitReviewContextResolver({ stableHash, now: () => new Date(occurredAt) });
    const current = resolver.resolve({
      repositoryId,
      rootPath: "/repo",
      branch: { kind: "branch", fullRef: "refs/heads/main" },
      head: newRevision
    });
    const fileId = `repository-file:${stableHash.digest(
      ["repository-file", repositoryId, binaryPath].join("\0")
    )}`;
    const contextState: ReviewContextState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      contextId: current.contextId,
      kind: "branch",
      repositoryId,
      displayName: "refs/heads/main",
      branch: { refName: "refs/heads/main", headRevision: oldRevision },
      files: {
        [fileId]: {
          schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
          fileId,
          currentPath: binaryPath,
          previousPaths: [],
          revisionId: oldRevision,
          modifiedReviewed: [{ startLine: 0, endLineExclusive: 2 }],
          originalReviewedByDiff: {},
          contentHash: stableHash.digest("alpha\nbeta"),
          lineCount: 2,
          updatedAt: occurredAt
        }
      },
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    const globalState: RepositoryGlobalState = {
      schemaVersion: REVIEW_RANGE_SCHEMA_VERSION,
      repositoryId,
      currentRevisionId: oldRevision,
      files: {
        [fileId]: {
          fileId,
          currentPath: binaryPath,
          revisionId: oldRevision,
          reviewed: [{ startLine: 0, endLineExclusive: 2 }],
          contentHash: stableHash.digest("alpha\nbeta"),
          updatedAt: occurredAt
        }
      },
      updatedAt: occurredAt
    };
    const mapper = new GitContextRevisionMapper({
      source: new ExistingBinaryRevisionSource(binarySection, binaryPath),
      stableHash,
      now: () => new Date(occurredAt)
    });

    const result = await mapper.map({
      current,
      contextState,
      globalState,
      fileSystemPathSemantics: "posix",
      options: { ignoreWhitespaceChanges: false, ignoreEolChanges: false }
    });

    if (expected === "excluded") {
      assert.deepEqual(result.contextState.files, {});
      assert.deepEqual(result.globalState.files, {});
      return;
    }
    assert.deepEqual(
      result.contextState.files[fileId]?.modifiedReviewed,
      []
    );
    assert.deepEqual(result.globalState.files[fileId]?.reviewed, []);
  });
}
