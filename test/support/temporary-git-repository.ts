import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { createTemporaryDirectory, type TemporaryDirectory } from "./temporary-directory";

const execFileAsync = promisify(execFile);

/** A temporary Git repository with an initial base commit and a later head commit. */
export interface TemporaryGitRepository extends TemporaryDirectory {
  /** Commit SHA before the fixture's head change. */
  readonly baseCommit: string;
  /** Commit SHA after the fixture's head change. */
  readonly headCommit: string;
  /** Executes Git with an argument array in this fixture repository. */
  runGit(argumentsList: readonly string[]): Promise<string>;
}

/**
 * Creates an isolated repository with deterministic author configuration and
 * two commits that can act as a pull request's base and head revisions.
 *
 * @returns A temporary Git repository whose caller is responsible for cleanup.
 */
export async function createTemporaryGitRepository(): Promise<TemporaryGitRepository> {
  const temporaryDirectory = await createTemporaryDirectory("review-range-git");
  const runGit = async (argumentsList: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", [...argumentsList], {
      cwd: temporaryDirectory.path,
      windowsHide: true
    });
    return stdout.trim();
  };

  try {
    await runGit(["init", "--initial-branch=main"]);
    await runGit(["config", "user.name", "Review Range Test"]);
    await runGit(["config", "user.email", "review-range-test@example.invalid"]);
    await writeFile(`${temporaryDirectory.path}/fixture.txt`, "base\n", "utf8");
    await runGit(["add", "fixture.txt"]);
    await runGit(["commit", "--message", "base fixture"]);
    const baseCommit = await runGit(["rev-parse", "HEAD"]);

    await writeFile(`${temporaryDirectory.path}/fixture.txt`, "base\nhead\n", "utf8");
    await runGit(["add", "fixture.txt"]);
    await runGit(["commit", "--message", "head fixture"]);
    const headCommit = await runGit(["rev-parse", "HEAD"]);

    return {
      ...temporaryDirectory,
      baseCommit,
      headCommit,
      runGit
    };
  } catch (error) {
    await temporaryDirectory.cleanup();
    throw error;
  }
}
