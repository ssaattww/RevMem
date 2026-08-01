import type * as vscode from "vscode";

/** Minimal VS Code authentication surface required by the GitHub adapter. */
export interface VsCodeAuthenticationLike {
  getSession(
    providerId: string,
    scopes: readonly string[],
    options: { readonly createIfNone: false }
  ): Thenable<vscode.AuthenticationSession | undefined>;
}

const authenticationProviderId = (host: string): "github" | "github-enterprise" =>
  host.toLowerCase() === "github.com" ? "github" : "github-enterprise";

/** Reads an existing VS Code GitHub authentication session without prompting. */
export class VsCodeGitHubAuthenticationProvider {
  private readonly authentication: VsCodeAuthenticationLike;
  private readonly scopes: readonly string[];

  public constructor(
    authentication: VsCodeAuthenticationLike,
    scopes: readonly string[] = ["repo"]
  ) {
    this.authentication = authentication;
    this.scopes = [...scopes];
  }

  /** Returns an existing host-appropriate access token or `undefined` so public API fallback can proceed. */
  public async getAccessToken(host: string): Promise<string | undefined> {
    const session = await this.authentication.getSession(
      authenticationProviderId(host),
      this.scopes,
      { createIfNone: false }
    );
    return session?.accessToken;
  }
}
