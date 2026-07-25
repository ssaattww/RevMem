import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const designDirectory = path.join(projectRoot, "doc", "design");
const mainDesignPath = path.join(
  designDirectory,
  "vscode-review-range-tracker-design.md"
);
const amendmentPath = path.join(
  designDirectory,
  "vscode-review-range-tracker-design-t302-amendment.md"
);
const taskIdentifierPattern = /\bT\d{3}(?:-\d+)?\b/u;

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const writeFailureContext = async (
  mainDesign: string,
  amendmentExists: boolean
): Promise<void> => {
  const outputDirectory = path.join(projectRoot, "test-output", "ci", "design");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "main-design.md"), mainDesign, "utf8");
  if (amendmentExists) {
    await writeFile(
      path.join(outputDirectory, "separate-design-document.md"),
      await readFile(amendmentPath, "utf8"),
      "utf8"
    );
  }
};

test("design specifications remain in one feature-organized document without task identifiers", async () => {
  const mainDesign = await readFile(mainDesignPath, "utf8");
  const amendmentExists = await exists(amendmentPath);
  const containsTaskIdentifier = taskIdentifierPattern.test(mainDesign);

  if (amendmentExists || containsTaskIdentifier) {
    await writeFailureContext(mainDesign, amendmentExists);
  }

  assert.equal(
    amendmentExists,
    false,
    "Design amendments must be integrated into the single main design document."
  );
  assert.equal(
    containsTaskIdentifier,
    false,
    "The design document must describe permanent features, not task identifiers."
  );
});
