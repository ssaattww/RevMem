import type { OperationFeedbackContext } from "./operation-feedback";

export type PullRequestRefreshAliasKind = "repo" | "branch" | "pr" | "context" | "snapshot";
declare const allocatedAlias: unique symbol;

/** Allocator-issued reference. Identity keys never enter the reference or diagnostic. */
export interface PullRequestRefreshAlias<Kind extends PullRequestRefreshAliasKind> {
  readonly kind: Kind;
  readonly ordinal: number;
  readonly [allocatedAlias]: true;
}

export interface PullRequestRefreshAliases {
  readonly repository?: PullRequestRefreshAlias<"repo">;
  readonly branch?: PullRequestRefreshAlias<"branch">;
  readonly pullRequest?: PullRequestRefreshAlias<"pr">;
  readonly context?: PullRequestRefreshAlias<"context">;
  readonly snapshot?: PullRequestRefreshAlias<"snapshot">;
}

const kinds = {
  repository: "repo", branch: "branch", pullRequest: "pr", context: "context", snapshot: "snapshot",
} as const;
// Process-local ordinals encode allocation order only; they are not derived from identity.
// The weak metadata contains no repository/branch/PR/context/revision keys.
let nextOrdinal = 0;
const issued = new WeakMap<object, { readonly scope: { active: boolean }; readonly generation: number; readonly owner?: OperationFeedbackContext }>();

/** One refresh owner, cleared on every terminal outcome or generation cancellation. */
export class PullRequestRefreshAliasAllocator {
  private readonly scope = { active: true };
  private readonly identities = new Map<PullRequestRefreshAliasKind, Map<string, PullRequestRefreshAlias<PullRequestRefreshAliasKind>>>();
  private disposed = false;

  public constructor(private readonly generation: number, private readonly owner?: OperationFeedbackContext) {}

  public allocate<Kind extends PullRequestRefreshAliasKind>(kind: Kind, identity: readonly (string | number)[]): PullRequestRefreshAlias<Kind> | undefined {
    if (this.disposed || identity.length === 0) return undefined;
    const key = JSON.stringify(identity);
    const aliases = this.identities.get(kind) ?? new Map<string, PullRequestRefreshAlias<PullRequestRefreshAliasKind>>();
    this.identities.set(kind, aliases);
    let alias = aliases.get(key);
    if (alias === undefined) {
      alias = Object.freeze({ kind, ordinal: ++nextOrdinal }) as PullRequestRefreshAlias<Kind>;
      issued.set(alias, { scope: this.scope, generation: this.generation, ...(this.owner === undefined ? {} : { owner: this.owner }) });
      aliases.set(key, alias);
    }
    return alias as PullRequestRefreshAlias<Kind>;
  }

  public dispose(): void {
    this.disposed = true;
    this.scope.active = false;
    this.identities.clear();
  }
}

/** Reject fabricated values, wrong kinds, mixed scopes and foreign operation/generation refs. */
export const validatePullRequestRefreshAliases = (
  aliases: PullRequestRefreshAliases | undefined,
  generation: number,
  owner?: OperationFeedbackContext,
): PullRequestRefreshAliases | undefined => {
  if (aliases === undefined) return undefined;
  const result: Record<string, PullRequestRefreshAlias<PullRequestRefreshAliasKind>> = {};
  let scope: object | undefined;
  for (const [key, alias] of Object.entries(aliases)) {
    if (alias === undefined) continue;
    const expected = kinds[key as keyof typeof kinds];
    const metadata = typeof alias === "object" && alias !== null ? issued.get(alias) : undefined;
    if (expected === undefined || metadata === undefined || alias.kind !== expected || metadata.generation !== generation ||
      (scope !== undefined && scope !== metadata.scope) ||
      (owner !== undefined && (!metadata.scope.active || metadata.owner?.owner !== owner.owner || metadata.owner.id !== owner.id))) {
      throw new TypeError("PR Progress refresh alias is not an allocated owner-scoped reference");
    }
    scope = metadata.scope;
    result[key] = alias;
  }
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result) as PullRequestRefreshAliases;
};

/** Fixed field order keeps correspondence ahead of optional counts in bounded Output lines. */
export const formatPullRequestRefreshAliases = (aliases: PullRequestRefreshAliases | undefined, generation: number): string => {
  const validated = validatePullRequestRefreshAliases(aliases, generation);
  return Object.keys(kinds).map((key) => {
    const alias = validated?.[key as keyof PullRequestRefreshAliases];
    return alias === undefined ? "" : ` ${key}=${alias.kind}-${alias.ordinal}`;
  }).join("");
};
