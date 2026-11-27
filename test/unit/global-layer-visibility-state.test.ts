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
  await restarted.reconcileStartup(() => true, () => assert.fail("no refresh for unchanged setting"));
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
  await restartAfterSettingChange.reconcileStartup(() => true, () => assert.fail("the selected display was already on"));
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
  await restarted.reconcileStartup(() => false, () => assert.fail("do not override a restored toggle"));
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

test("an unchanged effective setting does not retry a failed save or alter the display", async () => {
  const store = new MemoryStore();
  const state = new GlobalLayerVisibilityState(store, true);
  store.nextFailure = true;
  await assert.rejects(state.applySetting(false), /save failed/u);
  assert.equal(await state.applySetting(false), false);
  assert.equal(store.writes, 1);
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
/**
 * Models extHostMemento: update mutates its in-memory cache before its
 * persistence promise can reject, and a later update persists the whole cache.
 */
class CacheFirstMemento {
  private readonly cache = new Map<string, unknown>();
  public readonly persisted = new Map<string, unknown>();
  public failNextKey: string | undefined;

  public get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.cache.delete(key);
    else this.cache.set(key, value);

    if (this.failNextKey === key) {
      this.failNextKey = undefined;
      throw new Error("memento persistence failed");
    }

    this.persisted.clear();
    for (const [cachedKey, cachedValue] of this.cache) {
      this.persisted.set(cachedKey, structuredClone(cachedValue));
    }
  }
}

test("failed Global toggle is rolled back before a different Memento key persists", async () => {
  const memento = new CacheFirstMemento();
  const state = new GlobalLayerVisibilityState(memento, true);

  // Default ON has no stored Global preference yet.
  assert.equal(state.isEnabled(), true);
  assert.equal(memento.get("reviewRange.globalLayerVisibility.v1"), undefined);

  // The failed OFF update mutates the cache first.
  memento.failNextKey = "reviewRange.globalLayerVisibility.v1";
  await assert.rejects(
    state.toggle(),
    /memento persistence failed/u
  );
  assert.equal(state.isEnabled(), true);

  // A Review Context update persists the entire Memento cache.
  await memento.update("reviewRange.hiddenReviewContexts.v1", ["context-b"]);

  // Reinitialization must see the original default ON, not failed OFF.
  const restarted = new GlobalLayerVisibilityState(memento, true);
  await restarted.reconcileStartup(
    () => true,
    () => assert.fail("unchanged setting must not refresh")
  );
  assert.equal(restarted.isEnabled(), true);
  assert.equal(
    memento.persisted.get("reviewRange.globalLayerVisibility.v1"),
    undefined
  );
  assert.deepEqual(
    memento.persisted.get("reviewRange.hiddenReviewContexts.v1"),
    ["context-b"]
  );
});

test("failed Global toggle restores the last stored value and preserves the original error", async () => {
  const memento = new CacheFirstMemento();
  await memento.update("reviewRange.globalLayerVisibility.v1", {
    selected: true,
    settingAtSave: true
  });
  const state = new GlobalLayerVisibilityState(memento, true);

  memento.failNextKey = "reviewRange.globalLayerVisibility.v1";
  await assert.rejects(
    state.toggle(),
    /memento persistence failed/u
  );
  assert.equal(state.isEnabled(), true);

  await memento.update("reviewRange.hiddenReviewContexts.v1", ["context-b"]);
  const restarted = new GlobalLayerVisibilityState(memento, true);
  await restarted.reconcileStartup(
    () => true,
    () => assert.fail("unchanged setting must not refresh")
  );
  assert.equal(restarted.isEnabled(), true);
  assert.deepEqual(
    memento.persisted.get("reviewRange.globalLayerVisibility.v1"),
    { selected: true, settingAtSave: true }
  );
});
