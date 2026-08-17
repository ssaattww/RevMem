import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [label, command, ...args] = process.argv.slice(2);

if (!label || !command) {
  console.error("usage: node tools/run-ci-command.mjs <label> <command> [args...]");
  process.exit(2);
}

const outputDirectory = path.resolve("test-output", "ci");
await mkdir(outputDirectory, { recursive: true });

const stdoutPath = path.join(outputDirectory, `${label}.stdout.log`);
const stderrPath = path.join(outputDirectory, `${label}.stderr.log`);
const combinedPath = path.join(outputDirectory, `${label}.log`);
const resultPath = path.join(outputDirectory, `${label}.result.json`);

const stdoutLog = createWriteStream(stdoutPath, { flags: "w" });
const stderrLog = createWriteStream(stderrPath, { flags: "w" });
const combinedLog = createWriteStream(combinedPath, { flags: "w" });
const startedAt = new Date().toISOString();

const child = spawn(command, args, {
  shell: false,
  stdio: ["inherit", "pipe", "pipe"]
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  stdoutLog.write(chunk);
  combinedLog.write(chunk);
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  stderrLog.write(chunk);
  combinedLog.write(chunk);
});

let spawnError = null;
child.on("error", (error) => {
  spawnError = {
    name: error.name,
    message: error.message,
    code: error.code ?? null
  };
});

const outcome = await new Promise((resolve) => {
  child.on("close", (exitCode, signal) => {
    resolve({ exitCode, signal });
  });
});

const finishStream = (stream) =>
  new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.end(resolve);
  });

await Promise.all([
  finishStream(stdoutLog),
  finishStream(stderrLog),
  finishStream(combinedLog)
]);

const result = {
  label,
  command,
  args,
  startedAt,
  finishedAt: new Date().toISOString(),
  exitCode: outcome.exitCode,
  signal: outcome.signal,
  spawnError
};

await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

if (spawnError) {
  process.exitCode = 127;
} else if (outcome.signal) {
  process.exitCode = 1;
} else {
  process.exitCode = outcome.exitCode ?? 1;
}
