import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const designDirectory = path.join(projectRoot, "doc", "design");
const mainDesignFilename = "vscode-review-range-tracker-design.md";
const mainDesignPath = path.join(designDirectory, mainDesignFilename);
const architectureValidatorPath = path.join(
  projectRoot,
  "tools",
  "validate-architecture.mjs"
);
const relatedDesignFilenamePattern =
  /^vscode-review-range-tracker-design(?:-.+)?\.md$/u;
const taskIdentifierPattern = /T\d{3}(?:-\d+)?/u;
const architectureContractStart = "<!-- architecture-layer-contract:start -->";
const architectureContractEnd = "<!-- architecture-layer-contract:end -->";

interface LayerContract {
  readonly [sourceLayer: string]: readonly string[];
}

const requiredUiSpecificationFragments = [
  "### 16.2 Current Context View",
  "PR番号、タイトル、状態",
  "base/head revision",
  "GitHub接続状態",
  "PR再検出",
  "GitHub再接続",
  "現在状態の再計算",
  "### 16.3 PR Progress View",
  "未確認変更が残るファイル",
  "確認完了したファイル",
  "行以外の変更",
  "行単位レビュー対象外",
  "未確認行数の降順",
  "ファイルパス昇順",
  "PR上の順序",
  "進捗率順",
  "### 16.4 Review Contexts View",
  "保存済みのオープンPR",
  "保存済みのクローズ済みPR",
  "ローカルキャッシュ更新",
  "コンテキスト表示から削除",
  "履歴削除は別操作"
] as const;

const normalizeLayerContract = (
  entries: ReadonlyArray<readonly [string, readonly string[]]>
): LayerContract =>
  Object.fromEntries(
    entries
      .map(([sourceLayer, dependencies]) => [
        sourceLayer,
        [...dependencies].sort()
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  );

const parseValidatorLayerContract = (source: string): LayerContract => {
  const objectMatch = /const allowedLayerDependencies = \{([\s\S]*?)\n\};/u.exec(
    source
  );
  assert.ok(objectMatch, "Architecture validator must declare allowedLayerDependencies");

  const entries: Array<readonly [string, readonly string[]]> = [];
  const rowPattern = /(\w+): new Set\(\[([^\]]*)\]\)/gu;
  for (const match of objectMatch[1]!.matchAll(rowPattern)) {
    const dependencies = [...match[2]!.matchAll(/"([^"]+)"/gu)].map(
      (dependencyMatch) => dependencyMatch[1]!
    );
    entries.push([match[1]!, dependencies]);
  }
  assert.ok(entries.length > 0, "Architecture validator layer contract must be parseable");
  return normalizeLayerContract(entries);
};

const parseDesignLayerContract = (design: string): LayerContract | undefined => {
  const start = design.indexOf(architectureContractStart);
  const end = design.indexOf(architectureContractEnd);
  if (start < 0 || end <= start) {
    return undefined;
  }

  const entries: Array<readonly [string, readonly string[]]> = [];
  const block = design.slice(start + architectureContractStart.length, end);
  for (const line of block.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|$/u.exec(line);
    if (match === null || match[1] === "source layer") {
      continue;
    }
    const dependencies = [...match[2]!.matchAll(/`([^`]+)`/gu)].map(
      (dependencyMatch) => dependencyMatch[1]!
    );
    entries.push([match[1]!, dependencies]);
  }

  return entries.length === 0 ? undefined : normalizeLayerContract(entries);
};

const writeFailureContext = async (
  mainDesign: string,
  relatedDesignFilenames: readonly string[],
  validatorSource: string,
  missingUiFragments: readonly string[]
): Promise<void> => {
  const outputDirectory = path.join(projectRoot, "test-output", "ci", "design");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "main-design.md"), mainDesign, "utf8");
  await writeFile(
    path.join(outputDirectory, "related-design-files.txt"),
    `${relatedDesignFilenames.join("\n")}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputDirectory, "architecture-validator.mjs"),
    validatorSource,
    "utf8"
  );
  await writeFile(
    path.join(outputDirectory, "missing-ui-requirements.txt"),
    `${missingUiFragments.join("\n")}\n`,
    "utf8"
  );

  for (const filename of relatedDesignFilenames) {
    if (filename === mainDesignFilename) {
      continue;
    }
    await writeFile(
      path.join(outputDirectory, filename),
      await readFile(path.join(designDirectory, filename), "utf8"),
      "utf8"
    );
  }
};

test("design specifications remain in one feature-organized document without task identifiers", async () => {
  const mainDesign = await readFile(mainDesignPath, "utf8");
  const validatorSource = await readFile(architectureValidatorPath, "utf8");
  const relatedDesignFilenames = (await readdir(designDirectory))
    .filter((filename) => relatedDesignFilenamePattern.test(filename))
    .sort();
  const containsTaskIdentifier = taskIdentifierPattern.test(mainDesign);
  const hasOnlyMainDesign =
    relatedDesignFilenames.length === 1 &&
    relatedDesignFilenames[0] === mainDesignFilename;
  const validatorLayerContract = parseValidatorLayerContract(validatorSource);
  const designLayerContract = parseDesignLayerContract(mainDesign);
  const missingUiFragments = requiredUiSpecificationFragments.filter(
    (fragment) => !mainDesign.includes(fragment)
  );

  if (
    !hasOnlyMainDesign ||
    containsTaskIdentifier ||
    designLayerContract === undefined ||
    JSON.stringify(designLayerContract) !== JSON.stringify(validatorLayerContract) ||
    missingUiFragments.length > 0
  ) {
    await writeFailureContext(
      mainDesign,
      relatedDesignFilenames,
      validatorSource,
      missingUiFragments
    );
  }

  assert.deepEqual(
    relatedDesignFilenames,
    [mainDesignFilename],
    "All tracker design specifications must be integrated into the single main design document."
  );
  assert.equal(
    containsTaskIdentifier,
    false,
    "The design document must describe permanent features, not task identifiers."
  );
  assert.deepEqual(
    designLayerContract,
    validatorLayerContract,
    "The documented layer dependency matrix must match the architecture validator."
  );
  assert.doesNotMatch(
    mainDesign,
    /^UI Adapter\s*\r?\n\s*-> Runtime Adapters$/mu,
    "UI must not depend directly on runtime adapters."
  );
  assert.match(
    mainDesign,
    /Composition Root[\s\S]{0,240}(?:Runtime Adapters|runtime adapter)/u,
    "The composition root must own runtime adapter wiring."
  );
  assert.deepEqual(
    missingUiFragments,
    [],
    "The integrated design must preserve the previously decided UI requirements."
  );
});
