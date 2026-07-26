import {
  ReviewDiffUriCodec,
  RevisionTextContentProvider,
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
} satisfies ReviewDiffDocumentDescriptor;

const source: RevisionTextContentSource = {
  async readTextContent(request) {
    return request.revision === descriptor.revision
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

// A LocalGitAdapter must never invent a second Node runtime policy implicitly.
// @ts-expect-error The blob reader boundary is mandatory for direct construction.
new LocalGitAdapter(new NodeGitCommandExecutor());

void [
  codec.encode(descriptor),
  applicationProvider,
  uiProvider,
  resolver,
  localGitSource,
  nodeLocalGitAdapter,
  explicitBoundaryAdapter,
  nodeRuntimeOptions
];
