import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import {
  VsCodeGitHubAuthenticationProvider,
  type VsCodeAuthenticationLike
} from "../../src/adapters/github/vscode-github-authentication-provider";

const makeSession = (): vscode.AuthenticationSession => ({
  id: "session-mock",
  accessToken: "mock-token",
  account: { id: "account-mock", label: "Mock account" },
  scopes: ["repo"]
});

const mockAuth = (
  getSession: VsCodeAuthenticationLike["getSession"],
  listeners: Array<(event: vscode.AuthenticationSessionsChangeEvent) => void> = []
): VsCodeAuthenticationLike => ({
  getSession,
  onDidChangeSessions: (listener) => {
    listeners.push(listener);
    return { dispose: () => undefined };
  }
});

const emit = (
  listeners: readonly ((event: vscode.AuthenticationSessionsChangeEvent) => void)[],
  id: "github" | "github-enterprise"
): void => {
  for (const listener of listeners) listener({ provider: { id, label: id } });
};

test("silent session lookup is non-interactive and returns session/account binding separately", async () => {
  let optionsSeen: unknown;
  const provider = new VsCodeGitHubAuthenticationProvider(mockAuth(async (_id, _scopes, options) => {
    optionsSeen = options;
    return makeSession();
  }));
  const result = await provider.getSilentSession("github.com");

  assert.deepEqual(optionsSeen, { silent: true });
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;
  assert.equal(result.binding.sessionId, "session-mock");
  assert.equal(result.binding.accountId, "account-mock");
  assert.equal(result.binding.authenticationGeneration, 0);
  assert.equal(provider.isCurrentSession(result.binding), true);
  provider.dispose();
});

test("only the matching authentication provider event advances its generation", async () => {
  const listeners: Array<(event: vscode.AuthenticationSessionsChangeEvent) => void> = [];
  const provider = new VsCodeGitHubAuthenticationProvider(
    mockAuth(async () => makeSession(), listeners), ["repo"], "https://git.example.test"
  );
  const result = await provider.getSilentSession("github.com");
  assert.equal(result.kind, "available");
  if (result.kind !== "available") return;

  emit(listeners, "github-enterprise");
  assert.equal(provider.isCurrentSession(result.binding), true);
  emit(listeners, "github");
  assert.equal(provider.isCurrentSession(result.binding), false);
  assert.deepEqual(await provider.getSilentSession("github.com", 0), {
    kind: "stale",
    authenticationGeneration: 1
  });
  provider.dispose();
});

test("discards a session result if its provider changes while lookup is pending", async () => {
  const listeners: Array<(event: vscode.AuthenticationSessionsChangeEvent) => void> = [];
  let resolveSession!: (session: vscode.AuthenticationSession) => void;
  const pending = new Promise<vscode.AuthenticationSession>((resolve) => { resolveSession = resolve; });
  const provider = new VsCodeGitHubAuthenticationProvider(
    mockAuth(async () => pending, listeners)
  );
  const lookup = provider.getSilentSession("github.com");
  emit(listeners, "github");
  resolveSession(makeSession());

  assert.deepEqual(await lookup, { kind: "stale", authenticationGeneration: 1 });
  provider.dispose();
});

test("unsupported hosts make no session request and legacy token lookup stays non-interactive", async () => {
  const calls: Array<{ providerId: string; options: unknown }> = [];
  const provider = new VsCodeGitHubAuthenticationProvider(mockAuth(async (providerId, _scopes, options) => {
    calls.push({ providerId, options });
    return makeSession();
  }));

  assert.deepEqual(await provider.getSilentSession("attacker.example"), {
    kind: "unavailable",
    reason: "unsupported-host"
  });
  assert.equal(await provider.getAccessToken("github.com"), "mock-token");
  assert.deepEqual(calls, [{ providerId: "github", options: { createIfNone: false } }]);
  provider.dispose();
});
