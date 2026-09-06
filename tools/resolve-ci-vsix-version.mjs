import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Only release versions are seeds. Build metadata is reserved for the PR HEAD.
const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function parseVersion(value) {
  const match = releaseVersion.exec(value);
  if (!match) return undefined;
  const prerelease = match[4]?.split(".");
  if (prerelease?.some((part) => /^\d+$/u.test(part) && part.length > 1 && part.startsWith("0"))) return undefined;
  return { numbers: match.slice(1, 4).map(BigInt), prerelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xNumeric = /^\d+$/u.test(x);
    const yNumeric = /^\d+$/u.test(y);
    if (xNumeric && yNumeric) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function fullSha(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/iu.test(value)) {
    throw new Error("Expected a full 40-character hexadecimal SHA.");
  }
  return value.toLowerCase();
}

/** Build metadata keeps even numeric/leading-zero seven-character hashes valid. */
export function formatCiVersion(baseVersion, headSha) {
  if (typeof baseVersion !== "string" || !parseVersion(baseVersion)) throw new Error("Invalid main release version.");
  return `${baseVersion}+${fullSha(headSha).slice(0, 7)}`;
}

/** Resolve only tags attached to the main-side branch point, never a moving tip. */
export function resolveCiVersion(baseSha, headSha, cwd = process.cwd()) {
  const base = fullSha(baseSha);
  const head = fullSha(headSha);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  if (git("rev-parse", "HEAD") !== head) throw new Error("Checkout HEAD does not match PR HEAD.");
  const bases = git("merge-base", "--all", base, head).split(/\r?\n/u).filter(Boolean);
  if (bases.length !== 1) throw new Error("Expected exactly one main branch point.");
  const branchPoint = fullSha(bases[0]);
  const versions = git("tag", "--points-at", branchPoint).split(/\r?\n/u)
    .map((tag) => tag.replace(/^v/u, ""))
    .filter((version) => parseVersion(version) !== undefined)
    .sort(compareVersions);
  const baseVersion = versions.at(-1);
  if (!baseVersion) throw new Error(`No version tag on main branch point ${branchPoint}.`);
  return {
    baseSha: branchPoint,
    headSha: head,
    baseVersion,
    shortSha: head.slice(0, 7),
    packageVersion: formatCiVersion(baseVersion, head)
  };
}

function main() {
  if (process.argv.length < 4 || process.argv.length > 5) {
    throw new Error("Usage: resolve-ci-vsix-version.mjs <base SHA> <PR HEAD SHA> [metadata file]");
  }
  const result = resolveCiVersion(process.argv[2], process.argv[3]);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const metadata = process.argv[4];
  if (metadata) {
    mkdirSync(dirname(resolve(metadata)), { recursive: true });
    writeFileSync(metadata, json);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `package_version=${result.packageVersion}\nbase_sha=${result.baseSha}\nhead_sha=${result.headSha}\n`);
  }
  process.stdout.write(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
