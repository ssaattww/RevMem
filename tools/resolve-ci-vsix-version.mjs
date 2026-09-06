import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const number = "(?:0|[1-9][0-9]*)";
const prerelease = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp(
  `^${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);
const isVersion = (value) => typeof value === "string" && value.trim() === value && semver.test(value);
function requireSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-digit commit SHA.`);
  }
  return value;
}

/** Build metadata preserves prerelease/metadata and even leading-zero numeric hashes. */
export function formatCiVersion(baseVersion, headSha) {
  if (!isVersion(baseVersion)) throw new Error(`Invalid branch-point version: ${baseVersion}`);
  requireSha(headSha, "HEAD");
  return `${baseVersion}${baseVersion.includes("+") ? "." : "+"}${headSha.slice(0, 7)}`;
}

/** Resolve only local, fetched history. Never use the latest tag or the PR manifest. */
export function resolveCiVsixVersion({ headSha, baseSha, cwd = process.cwd() }) {
  requireSha(headSha, "HEAD");
  requireSha(baseSha, "Base");
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  for (const sha of [headSha, baseSha]) git("rev-parse", "--verify", `${sha}^{commit}`);
  if (git("rev-parse", "HEAD") !== headSha) {
    throw new Error("The checkout must match the supplied PR HEAD; merge checkouts cannot be packaged as that HEAD.");
  }
  const branchPoints = git("merge-base", "--all", headSha, baseSha).split(/\r?\n/u);
  if (branchPoints.length !== 1 || !branchPoints[0]) {
    throw new Error("Exactly one main/PR branch point is required.");
  }
  const branchPointSha = branchPoints[0];
  let baseVersion;
  let baseVersionSource;
  // Walk main's first-parent ancestry, not a merged side branch's release tags.
  for (const commit of git("rev-list", "--first-parent", branchPointSha).split(/\r?\n/u)) {
    const versions = git("tag", "--points-at", commit).split(/\r?\n/u)
      .map((tag) => ({ tag, version: tag.replace(/^v/u, "") }))
      .filter(({ version }) => isVersion(version));
    if (versions.length === 0) continue;
    if (new Set(versions.map(({ version }) => version)).size !== 1) {
      throw new Error(`Ambiguous release versions at main commit ${commit}.`);
    }
    baseVersion = versions[0].version;
    baseVersionSource = `tag:${versions[0].tag}`;
    break;
  }
  if (baseVersion === undefined) {
    baseVersion = JSON.parse(git("show", `${branchPointSha}:package.json`)).version;
    baseVersionSource = `manifest:${branchPointSha}`;
  }
  return {
    version: formatCiVersion(baseVersion, headSha),
    baseVersion, baseVersionSource, branchPointSha, headSha, baseSha,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--head" || args[2] !== "--base") {
    throw new Error("Usage: node tools/resolve-ci-vsix-version.mjs --head <PR HEAD SHA> --base <main SHA>");
  }
  const result = resolveCiVsixVersion({ headSha: args[1], baseSha: args[3] });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nbranch_point_sha=${result.branchPointSha}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
