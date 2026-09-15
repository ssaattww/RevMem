import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as configuration from "../../src/application/configuration/index.js";

type ConfigurationReader = {
  get<T>(section: string): T | undefined;
};

type SelectionModeReader = (configuration: ConfigurationReader) => "side" | "block";

const exported = configuration as unknown as Record<string, unknown>;

const selectionModeReader = (): SelectionModeReader => {
  const reader = exported["readPrDiffSelectionMode"];
  assert.equal(typeof reader, "function", "configuration boundary must export a PR diff selection-mode reader");
  return reader as SelectionModeReader;
};

test("PR diff selection configuration publishes side as the stable default", async () => {
  assert.equal(
    (configuration.DEFAULT_REVIEW_RANGE_CONFIGURATION as unknown as Record<string, unknown>)["prDiffSelectionMode"],
    "side",
  );
  assert.equal(
    (configuration.REVIEW_RANGE_CONFIGURATION_KEYS as unknown as Record<string, unknown>)["prDiffSelectionMode"],
    "reviewRange.prDiffSelectionMode",
  );

  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    contributes?: { configuration?: { properties?: Record<string, {
      type?: string;
      default?: unknown;
      enum?: unknown[];
    }> } };
  };
  const setting = packageJson.contributes?.configuration?.properties?.["reviewRange.prDiffSelectionMode"];
  assert.deepEqual(setting, {
    type: "string",
    enum: ["side", "block"],
    default: "side",
    description: "PR差分の選択範囲を片側単位または変更ブロック単位で確認します。",
  });
});

test("PR diff selection configuration accepts only side and block and defaults missing values to side", () => {
  const read = selectionModeReader();
  assert.equal(read({ get: () => undefined }), "side");
  assert.equal(read({ get: () => "side" as never }), "side");
  assert.equal(read({ get: () => "block" as never }), "block");
});

test("PR diff selection configuration rejects invalid values without fallback", () => {
  const read = selectionModeReader();
  assert.throws(
    () => read({ get: () => "linked" as never }),
    /prDiffSelectionMode|side|block/i,
  );
});
