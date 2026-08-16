import type { ResourceUri } from "../workspace-identity/index";

/**
 * Identity explicitly selected in Current Context and shared with commands and
 * normal-editor decorations.
 */
export type SelectedReviewContext =
  | {
      readonly kind: "pull-request";
      readonly repositoryId: string;
      readonly repositoryRoot: string;
      readonly contextId: string;
      readonly pullRequestNumber: number;
      readonly headRevision: string;
    }
  | {
      readonly kind: "branch";
      readonly repositoryId: string;
      readonly repositoryRoot: string;
      readonly branchRef: string;
    }
  | {
      readonly kind: "detached";
      readonly repositoryId: string;
      readonly repositoryRoot: string;
      readonly headRevision: string;
    }
  | {
      readonly kind: "workspace";
      readonly workspaceFolderUri: ResourceUri;
    };

/** Compares workspace resource identities without treating display labels as identity. */
export const sameResourceUri = (left: ResourceUri, right: ResourceUri): boolean =>
  left.scheme === right.scheme &&
  left.authority === right.authority &&
  left.path === right.path &&
  (left.query ?? "") === (right.query ?? "") &&
  (left.fragment ?? "") === (right.fragment ?? "");
