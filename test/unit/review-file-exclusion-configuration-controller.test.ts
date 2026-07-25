import assert from "node:assert/strict";
import test from "node:test";

import { ReviewFileExclusionPolicyService } from "../../src/application/file-exclusion/index";
import {
  ReviewFileExclusionConfigurationController,
  type ReviewFileExclusionConfigurationChangeEvent,
  type ReviewFileExclusionConfigurationDisposable,
  type ReviewFileExclusionConfigurationHost
} from "../../src/adapters/file-exclusion/index";

/** Records whether the configuration event subscription has been disposed. */
class FakeDisposable implements ReviewFileExclusionConfigurationDisposable {
  public disposed = false;
  public dispose(): void { this.disposed = true; }
}

/** Provides mutable effective settings and a controllable configuration event for controller tests. */
class FakeConfigurationHost implements ReviewFileExclusionConfigurationHost {
  public excludeGlobs: readonly string[] = [];
  public readCount = 0;
  public readonly errors: unknown[] = [];
  public readonly subscription = new FakeDisposable();
  private listener: ((event: Readonly<ReviewFileExclusionConfigurationChangeEvent>) => void) | undefined;

  public readExcludeGlobs(): readonly string[] {
    this.readCount += 1;
    return [...this.excludeGlobs];
  }

  public onDidChangeConfiguration(
    listener: (event: Readonly<ReviewFileExclusionConfigurationChangeEvent>) => void
  ): ReviewFileExclusionConfigurationDisposable {
    this.listener = listener;
    return this.subscription;
  }

  public showConfigurationError(error: unknown): void {
    this.errors.push(error);
  }

  public fire(affectsExcludeConfiguration: boolean): void {
    this.listener?.({ affectsExcludeConfiguration });
  }
}

const candidate = (path: string) => ({ path, isBinary: false });

test("controller initializes the shared policy from the active VS Code configuration", () => {
  const service = new ReviewFileExclusionPolicyService();
  const host = new FakeConfigurationHost();
  host.excludeGlobs = ["**/*.generated.ts"];
  const events: number[] = [];
  service.onDidChange(({ revision }) => events.push(revision));
  const controller = new ReviewFileExclusionConfigurationController({ service, host });

  controller.start();

  assert.equal(host.readCount, 1);
  assert.deepEqual(service.getUserGlobs(), ["**/*.generated.ts"]);
  assert.equal(service.evaluate(candidate("src/model.generated.ts")).excluded, true);
  assert.deepEqual(events, [1]);
});

test("controller applies an empty effective setting without reintroducing manifest defaults", () => {
  const service = new ReviewFileExclusionPolicyService();
  const host = new FakeConfigurationHost();
  const controller = new ReviewFileExclusionConfigurationController({ service, host });

  controller.start();

  assert.deepEqual(service.evaluate(candidate(".git/config")), {
    excluded: true,
    normalizedPath: ".git/config",
    reason: { kind: "default-glob", pattern: "**/.git/**" }
  });
  assert.equal(service.evaluate(candidate("dist/index.js")).excluded, false);
  assert.equal(service.evaluate(candidate("node_modules/pkg/index.js")).excluded, false);
});

test("controller updates only for relevant effective configuration changes", () => {
  const service = new ReviewFileExclusionPolicyService();
  const host = new FakeConfigurationHost();
  host.excludeGlobs = ["**/*.generated.ts"];
  const events: number[] = [];
  service.onDidChange(({ revision }) => events.push(revision));
  const controller = new ReviewFileExclusionConfigurationController({ service, host });
  controller.start();

  host.excludeGlobs = ["**/*.min.js"];
  host.fire(false);
  assert.equal(host.readCount, 1);
  assert.equal(service.evaluate(candidate("src/app.min.js")).excluded, false);

  host.excludeGlobs = [" **\\*.generated.ts ", ""];
  host.fire(true);
  assert.equal(host.readCount, 2);
  assert.deepEqual(events, [1]);

  host.excludeGlobs = ["**/*.min.js"];
  host.fire(true);
  assert.equal(host.readCount, 3);
  assert.equal(service.evaluate(candidate("src/app.min.js")).excluded, true);
  assert.deepEqual(events, [1, 2]);
});

test("controller retains the last valid policy and reports invalid settings", () => {
  const service = new ReviewFileExclusionPolicyService();
  const host = new FakeConfigurationHost();
  host.excludeGlobs = ["**/*.generated.ts"];
  const controller = new ReviewFileExclusionConfigurationController({ service, host });
  controller.start();

  host.excludeGlobs = ["a".repeat(1025)];
  host.fire(true);

  assert.equal(host.errors.length, 1);
  assert.deepEqual(service.getUserGlobs(), ["**/*.generated.ts"]);
  assert.equal(service.evaluate(candidate("src/model.generated.ts")).excluded, true);
});

test("controller disposes its configuration subscription during deactivation", () => {
  const service = new ReviewFileExclusionPolicyService();
  const host = new FakeConfigurationHost();
  host.excludeGlobs = ["**/*.generated.ts"];
  const controller = new ReviewFileExclusionConfigurationController({ service, host });
  controller.start();

  controller.dispose();
  controller.dispose();
  assert.equal(host.subscription.disposed, true);

  host.excludeGlobs = ["**/*.min.js"];
  host.fire(true);
  assert.deepEqual(service.getUserGlobs(), ["**/*.generated.ts"]);
});
