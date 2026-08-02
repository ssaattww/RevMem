import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
  type EmptyReviewDiffDocumentDescriptor,
  type GitCommitReviewDiffDocumentDescriptor,
  type ReviewDiffDocumentDescriptor,
  type RevisionTextContentSource
} from "../../src/application/diff-document";
import {
  LocalGitRevisionTextContentSource,
  type ReviewDiffRepositoryRootResolver
} from "../../src/adapters/diff-document";
import {
  LocalGitAdapter,
  NodeGitCommandExecutor,
  createNodeLocalGitAdapter,
  type GitBlobReader,
  type NodeLocalGitAdapterOptions
} from "../../src/adapters/local-git";
import { ReviewDiffTextDocumentContentProvider } from "../../src/ui/diff-editor";

const descriptor = {
  contextId: "pull-request:github.com/owner/repository#42",
  filePath: "src/file.ts",
  fileSystemPathSemantics: "posix",
  side: "modified",
  revisionSource: "git-commit",
  revision: "0123456789abcdef0123456789abcdef01234567"
} satisfies GitCommitReviewDiffDocumentDescriptor;
const emptyDescriptor = {
  ...descriptor,
  side: "original",
  revisionSource: "empty"
} satisfies EmptyReviewDiffDocumentDescriptor;
const descriptorUnion: ReviewDiffDocumentDescriptor = emptyDescriptor;

const source: RevisionTextContentSource = {
  async readTextContent(request) {
    const exact: GitCommitReviewDiffDocumentDescriptor = request;
    return exact.revision === descriptor.revision
      ? { kind: "found", content: "current\n" }
      : { kind: "missing-revision" };
  }
};
const codec = new ReviewDiffUriCodec();
const applicationProvider = new RevisionTextContentProvider(codec, source);
const uiProvider = new ReviewDiffTextDocumentContentProvider(applicationProvider);
const nodeRuntimeOptions = {
  executable: "/opt/portable-git/bin/git",
  timeoutMs: 10_000,
  maxBufferBytes: 1_048_576,
  blobTerminationGraceMs: 250
} satisfies NodeLocalGitAdapterOptions;
const nodeLocalGitAdapter = createNodeLocalGitAdapter(nodeRuntimeOptions);

declare const resolver: ReviewDiffRepositoryRootResolver;
declare const localGitSource: LocalGitRevisionTextContentSource;
declare const blobReader: GitBlobReader;

const explicitBoundaryAdapter = new LocalGitAdapter(
  new NodeGitCommandExecutor(),
  blobReader
);

// @ts-expect-error The external content port accepts only immutable Git-commit descriptors.
source.readTextContent(emptyDescriptor);
// @ts-expect-error Local Git source must never accept a synthetic empty descriptor.
localGitSource.readTextContent(emptyDescriptor);
// @ts-expect-error A Git-commit descriptor must retain the git-commit discriminant.
const invalidGitDescriptor: GitCommitReviewDiffDocumentDescriptor = emptyDescriptor;
// A LocalGitAdapter must never invent a second Node runtime policy implicitly.
// @ts-expect-error The blob reader boundary is mandatory for direct construction.
new LocalGitAdapter(new NodeGitCommandExecutor());

void [
  codec.encode(descriptor),
  codec.encode(emptyDescriptor),
  descriptorUnion,
  applicationProvider,
  uiProvider,
  resolver,
  localGitSource,
  nodeLocalGitAdapter,
  explicitBoundaryAdapter,
  nodeRuntimeOptions,
  invalidGitDescriptor
];
