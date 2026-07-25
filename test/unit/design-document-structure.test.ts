import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(__dirname, "../../..");
const designDirectory = path.join(projectRoot, "doc", "design");
const mainDesignFilename = "vscode-review-range-tracker-design.md";
const mainDesignPath = path.join(designDirectory, mainDesignFilename);
const relatedDesignFilenamePattern =
  /^vscode-review-range-tracker-design(?:-.+)?\.md$/u;
const taskIdentifierPattern = /T\d{3}(?:-\d+)?/u;

const writeFailureContext = async (
  mainDesign: string,
  relatedDesignFilenames: readonly string[]
): Promise<void> => {
  const outputDirectory = path.join(projectRoot, "test-output", "ci", "design");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "main-design.md"), mainDesign, "utf8");
  await writeFile(
    path.join(outputDirectory, "related-design-files.txt"),
    `${relatedDesignFilenames.join("\n")}\n`,
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
  const relatedDesignFilenames = (await readdir(designDirectory))
    .filter((filename) => relatedDesignFilenamePattern.test(filename))
    .sort();
  const containsTaskIdentifier = taskIdentifierPattern.test(mainDesign);
  const hasOnlyMainDesign =
    relatedDesignFilenames.length === 1 &&
    relatedDesignFilenames[0] === mainDesignFilename;

  if (!hasOnlyMainDesign || containsTaskIdentifier) {
    await writeFailureContext(mainDesign, relatedDesignFilenames);
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
});
