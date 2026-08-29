import type * as vscode from "vscode";
import { canonicalGitHubAuthority } from "./git-remote";

/** Minimal VS Code authentication surface required by the GitHub adapter. */
export interface VsCodeAuthenticationLike {
  getSession(
    providerId: string,
    scopes: readonly string[],
    options: { readonly createIfNone: boolean }
  ): Thenable<vscode.AuthenticationSession | undefined>;
}

const authenticationProviderId = (host: string): "github" | "github-enterprise" =>
  host.toLowerCase() === "github.com" ? "github" : "github-enterprise";

/** Reads a VS Code GitHub authentication session, prompting only for an explicit caller. */
export class VsCodeGitHubAuthenticationProvider {
  private readonly authentication: VsCodeAuthenticationLike;
  private readonly scopes: readonly string[];
  private readonly enterpriseAuthority: string | undefined;

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

  /** Returns a host-appropriate access token or `undefined` so public API fallback can proceed. */
  public async getAccessToken(
    authority: string,
    signal?: AbortSignal,
    interactive = false,
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
        { createIfNone: interactive }
      );
      if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
      return session?.accessToken;
    } catch {
      if (signal?.aborted) throw new DOMException("GitHub authentication was superseded.", "AbortError");
      return undefined;
    }
  }
}
