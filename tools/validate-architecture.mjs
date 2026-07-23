import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

const projectRoot = resolve(import.meta.dirname, "..");
const argumentsByName = new Map();

for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const sourceRoot = resolve(
  projectRoot,
  argumentsByName.get("--source-root") ?? "src"
);
const layerRoot = resolve(
  projectRoot,
  argumentsByName.get("--layer-root") ?? "src"
);
const expectedViolationCountValue = argumentsByName.get("--expect-violations");
const expectedViolationCount = expectedViolationCountValue === undefined
  ? undefined
  : Number(expectedViolationCountValue);
const layers = new Set(["core", "application", "adapters", "ui"]);
const allowedLayerDependencies = {
  core: new Set(["core"]),
  application: new Set(["core", "application"]),
  adapters: new Set(["core", "application", "adapters"]),
  ui: new Set(["core", "application", "ui"])
};

function collectTypeScriptFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = resolve(directory, entry);
    const fileStat = statSync(fullPath);

    if (fileStat.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }

    return extname(entry) === ".ts" && !entry.endsWith(".d.ts") ? [fullPath] : [];
  });
}

function layerFor(filePath, root) {
  const segments = relative(root, filePath).split(sep);
  return layers.has(segments[0]) ? segments[0] : undefined;
}

function resolveRelativeModule(importingFile, specifier) {
  const candidate = resolve(dirname(importingFile), specifier);
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    resolve(candidate, "index.ts")
  ];

  return candidates.find((candidatePath) => existsSync(candidatePath));
}

function isCorePlatformViolation(specifier) {
  return (
    specifier === "vscode" ||
    specifier.startsWith("vscode/") ||
    specifier === "fs" ||
    specifier.startsWith("fs/") ||
    specifier === "node:fs" ||
    specifier.startsWith("node:fs/") ||
    /(^|[/@-])(github|octokit)([/@-]|$)/i.test(specifier)
  );
}

function importSpecifiers(source, filePath) {
  const imports = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );

  function addModuleSpecifier(moduleSpecifier) {
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
      imports.push(moduleSpecifier.text);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    }

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addModuleSpecifier(node.moduleReference.expression);
    }

    if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";

      if ((isDynamicImport || isRequireCall) && argument && ts.isStringLiteralLike(argument)) {
        imports.push(argument.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

if (!existsSync(sourceRoot)) {
  throw new Error(`Source root does not exist: ${relative(projectRoot, sourceRoot)}`);
}

if (expectedViolationCount !== undefined && (!Number.isInteger(expectedViolationCount) || expectedViolationCount < 0)) {
  throw new Error("--expect-violations must be a non-negative integer.");
}

const violations = [];

for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const sourceLayer = layerFor(filePath, sourceRoot);

  if (!sourceLayer) {
    continue;
  }

  for (const specifier of importSpecifiers(readFileSync(filePath, "utf8"), filePath)) {
    if (sourceLayer === "core" && isCorePlatformViolation(specifier)) {
      violations.push(`${relative(projectRoot, filePath)}: core must not import '${specifier}'.`);
      continue;
    }

    if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
      continue;
    }

    const targetPath = resolveRelativeModule(filePath, specifier);
    const targetLayer = targetPath ? layerFor(targetPath, layerRoot) : undefined;

    if (targetLayer && !allowedLayerDependencies[sourceLayer].has(targetLayer)) {
      violations.push(
        `${relative(projectRoot, filePath)}: ${sourceLayer} must not import ${targetLayer} ('${specifier}').`
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture validation failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("Architecture validation passed.");
}

if (expectedViolationCount !== undefined) {
  if (violations.length === expectedViolationCount) {
    console.log(`Architecture violation count matched expected ${expectedViolationCount}.`);
  } else {
    console.error(
      `Architecture violation count was ${violations.length}; expected ${expectedViolationCount}.`
    );
    process.exitCode = 1;
  }
}
