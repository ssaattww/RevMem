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

declare const resolver: ReviewDiffRepositoryRootResolver;
declare const localGitSource: LocalGitRevisionTextContentSource;

void [
  codec.encode(descriptor),
  applicationProvider,
  uiProvider,
  resolver,
  localGitSource
];
