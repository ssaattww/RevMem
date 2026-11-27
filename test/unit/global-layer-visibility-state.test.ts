import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GlobalLayerVisibilityState } from "../../src/application/global-layer-visibility-state";

class MemoryStore {
  private readonly values = new Map<string, unknown>();
  public writes = 0;
  public nextFailure = false;

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.writes++;
    if (this.nextFailure) {
      this.nextFailure = false;
      throw new Error("save failed");
    }
    this.values.set(key, value);
  }
}

test("Global layer restores an internal selection without rewriting the effective setting", async () => {
  const store = new MemoryStore();
  const first = new GlobalLayerVisibilityState(store, true);
  assert.equal(await first.toggle(), false);
  const restarted = new GlobalLayerVisibilityState(store, true);
  assert.equal(await restarted.applySetting(true), false);
  assert.equal(restarted.isEnabled(), false);
  assert.equal(store.writes, 1);
  assert.equal(await restarted.toggle(), true);
});

test("Global layer applies changes before and after a saved selection", async () => {
  const store = new MemoryStore();
  const fresh = new GlobalLayerVisibilityState(store, true);
  assert.equal(await fresh.applySetting(false), true);
  assert.equal(fresh.isEnabled(), false);
  assert.equal(await fresh.toggle(), true);
  const restartAfterSettingChange = new GlobalLayerVisibilityState(store, true);
  assert.equal(await restartAfterSettingChange.applySetting(true), false);
  assert.equal(restartAfterSettingChange.isEnabled(), true);
  const restartWithoutFurtherChanges = new GlobalLayerVisibilityState(store, true);
  assert.equal(restartWithoutFurtherChanges.isEnabled(), true);
  assert.equal(store.writes, 3);
});

test("Global layer handles toggle and effective setting changes in arrival order", async () => {
  const store = new MemoryStore();
  const state = new GlobalLayerVisibilityState(store, true);
  const queued = [state.toggle(), state.toggle(), state.applySetting(false), state.toggle()];
  assert.deepEqual(await Promise.all(queued), [false, true, true, true]);
  assert.equal(state.isEnabled(), true);
  assert.equal(store.writes, 4);
});

test("failed Global layer save keeps committed display and leaves the queue usable", async () => {
  const store = new MemoryStore();
  const state = new GlobalLayerVisibilityState(store, true);
  store.nextFailure = true;
  const failed = state.toggle();
  const next = state.toggle();
  await assert.rejects(failed, /save failed/u);
  assert.equal(await next, false);
  assert.equal(state.isEnabled(), false);
  store.nextFailure = true;
  await assert.rejects(state.applySetting(false), /save failed/u);
  assert.equal(state.isEnabled(), false);
  assert.equal(await state.applySetting(true), true);
  assert.equal(state.isEnabled(), true);
});

test("a successful toggle after a failed setting save survives restart", async () => {
  const store = new MemoryStore();
  const state = new GlobalLayerVisibilityState(store, true);
  assert.equal(await state.toggle(), false);
  store.nextFailure = true;
  await assert.rejects(state.applySetting(false), /save failed/u);
  assert.equal(await state.toggle(), true);
  const restarted = new GlobalLayerVisibilityState(store, false);
  assert.equal(await restarted.applySetting(false), false);
  assert.equal(restarted.isEnabled(), true);
});

test("a setting returning to its old stored value still wins after a failed observation save", async () => {
  const store = new MemoryStore();
  const state = new GlobalLayerVisibilityState(store, true);
  await state.toggle();
  store.nextFailure = true;
  await assert.rejects(state.applySetting(false), /save failed/u);
  assert.equal(await state.applySetting(true), true);
  assert.equal(state.isEnabled(), true);
});

test("startup rereads after the actual configuration listener is installed", async () => {
  const composition = await readFile("src/composition/extension.ts", "utf8");
  const initial = composition.indexOf("const initialGlobalLayerSetting = readGlobalLayerSetting();");
  const subscription = composition.indexOf("const globalRuntime = registerGlobalUnderstandingRuntime(");
  const reconcile = composition.indexOf("visibility.reconcileStartup(");
  assert.ok(initial >= 0 && initial < subscription && subscription < reconcile);
  const runtime = await readFile("src/ui/global-understanding/vscode-global-understanding-runtime.ts", "utf8");
  assert.match(runtime, /onDidChangeConfiguration\(\(event\)\s*=>[\s\S]*?layerState\.applyCurrentSetting\(\)/u);

  const store = new MemoryStore();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let delay = true;
  const state = new GlobalLayerVisibilityState({
    get: (key) => store.get(key),
    update: async (key, value) => {
      if (delay) {
        delay = false;
        entered();
        await blocker;
      }
      await store.update(key, value);
    }
  }, true);
  let effectiveSetting = false;
  let refreshes = 0;
  const firstSetting = state.reconcileStartup(() => effectiveSetting, () => { refreshes++; });
  await started;
  effectiveSetting = true;
  const nextSetting = state.applySetting(effectiveSetting);
  release();
  assert.deepEqual(await Promise.all([firstSetting, nextSetting]), [undefined, true]);
  assert.equal(state.isEnabled(), true);
  assert.equal(store.writes, 2);
  assert.equal(refreshes, 1);
});
