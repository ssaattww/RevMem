import type * as vscode from "vscode";
import { canonicalGitHubAuthority } from "./git-remote";

/** Minimal VS Code authentication surface required by the GitHub adapter. */
export interface VsCodeAuthenticationLike {
  getSession(
    providerId: string,
    scopes: readonly string[],
    options: {
      readonly createIfNone?: boolean;
      readonly clearSessionPreference?: boolean;
      readonly silent?: boolean;
    }
  ): Thenable<vscode.AuthenticationSession | undefined>;
  readonly onDidChangeSessions?: vscode.Event<vscode.AuthenticationSessionsChangeEvent>;
}

const authenticationProviderId = (host: string): "github" | "github-enterprise" =>
  host.toLowerCase() === "github.com" ? "github" : "github-enterprise";

export interface GitHubAuthenticationSessionBinding {
  readonly host: string;
  readonly providerId: "github" | "github-enterprise";
  readonly sessionId: string;
  /** VS Code account ID; it is not GitHub's GraphQL viewer node ID. */
  readonly accountId: string;
  readonly authenticationGeneration: number;
}

export type GitHubSilentSessionResult =
  | {
    readonly kind: "available";
    readonly binding: GitHubAuthenticationSessionBinding;
    readonly accessToken: string;
  }
  | { readonly kind: "unavailable"; readonly reason: "unsupported-host" | "no-session" | "provider-error" }
  | { readonly kind: "stale"; readonly authenticationGeneration: number };


/** Reads a VS Code GitHub authentication session, prompting only for an explicit caller. */
export class VsCodeGitHubAuthenticationProvider {
  private readonly authentication: VsCodeAuthenticationLike;
  private readonly scopes: readonly string[];
  private readonly enterpriseAuthority: string | undefined;

  private readonly generations = new Map<"github" | "github-enterprise", number>([
    ["github", 0],
    ["github-enterprise", 0]
  ]);
  private sessionChanges: vscode.Disposable | undefined;
  private disposed = false;

  public constructor(
    authentication: VsCodeAuthenticationLike,
    scopes: readonly string[] = ["repo"],
    configuredEnterpriseUri?: string
  ) {
    this.authentication = authentication;
    this.scopes = [...scopes];
    this.enterpriseAuthority = configuredEnterpriseUri === undefined
      ? undefined
      : canonicalGitHubAuthority(configuredEnterpriseUri);
  }

  public dispose(): void {
    this.disposed = true;
    this.sessionChanges?.dispose();
  }

  /** Current generation for a supported authority, for caller-side stale checks. */
  public getAuthenticationGeneration(authority: string): number | undefined {
    if (this.disposed || this.sessionChanges === undefined) return undefined;
    const providerId = this.providerIdForAuthority(authority);
    return providerId === undefined ? undefined : this.generations.get(providerId);
  }

  /** True only while the same provider generation remains current. */
  public isCurrentSession(binding: GitHubAuthenticationSessionBinding): boolean {
    const host = canonicalGitHubAuthority(binding.host);
    const providerId = host === undefined ? undefined : this.providerIdForAuthority(host);
    return !this.disposed && this.sessionChanges !== undefined && providerId === binding.providerId &&
      this.generations.get(binding.providerId) === binding.authenticationGeneration;
  }

  /** Reads an existing session silently; never creates or prompts for a session. */
  public async getSilentSession(
    authority: string,
    expectedGeneration?: number,
    signal?: AbortSignal
  ): Promise<GitHubSilentSessionResult> {
    if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
    const host = canonicalGitHubAuthority(authority);
    const providerId = host === undefined ? undefined : this.providerIdForAuthority(host);
    if (host === undefined || providerId === undefined) {
      return { kind: "unavailable", reason: "unsupported-host" };
    }
    this.sessionChanges ??= this.authentication.onDidChangeSessions?.(({ provider }) => {
      if (provider.id === "github" || provider.id === "github-enterprise") {
        this.generations.set(provider.id, this.generations.get(provider.id)! + 1);
      }
    });
    if (this.disposed || this.sessionChanges === undefined) {
      return { kind: "unavailable", reason: "provider-error" };
    }
    const generation = this.generations.get(providerId)!;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) {
      return { kind: "stale", authenticationGeneration: generation };
    }

    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await this.authentication.getSession(providerId, this.scopes, { silent: true });
    } catch {
      if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
      return { kind: "unavailable", reason: "provider-error" };
    }
    if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
    const currentGeneration = this.generations.get(providerId)!;
    if (this.disposed || currentGeneration !== generation ||
        (expectedGeneration !== undefined && currentGeneration !== expectedGeneration)) {
      return { kind: "stale", authenticationGeneration: currentGeneration };
    }
    if (
      session === undefined ||
      session.id.length === 0 ||
      session.account.id.length === 0 ||
      session.accessToken.length === 0
    ) return { kind: "unavailable", reason: "no-session" };

    return {
      kind: "available",
      binding: {
        host,
        providerId,
        sessionId: session.id,
        accountId: session.account.id,
        authenticationGeneration: generation
      },
      accessToken: session.accessToken
    };
  }

  /** Returns a host-appropriate access token or `undefined` so public API fallback can proceed. */
  public async getAccessToken(
    authority: string,
    signal?: AbortSignal,
    interactive = false,
    clearSessionPreference = false,
  ): Promise<string | undefined> {
    if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
    const canonicalAuthority = canonicalGitHubAuthority(authority);
    if (canonicalAuthority === undefined) {
      return undefined;
    }
    if (
      canonicalAuthority !== "github.com" &&
      canonicalAuthority !== this.enterpriseAuthority
    ) {
      return undefined;
    }
    try {
      const session = await this.authentication.getSession(
        authenticationProviderId(canonicalAuthority),
        this.scopes,
        {
          createIfNone: interactive,
          ...(interactive && clearSessionPreference ? { clearSessionPreference: true } : {}),
        }
      );
      if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
      return session?.accessToken;
    } catch {
      if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
      return undefined;
    }
  }

  private providerIdForAuthority(authority: string): "github" | "github-enterprise" | undefined {
    const host = canonicalGitHubAuthority(authority);
    if (host === undefined) return undefined;
    if (host === "github.com") return "github";
    return host === this.enterpriseAuthority ? "github-enterprise" : undefined;
  }
}
