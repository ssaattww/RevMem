import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;

const declarationNames = (statement: ts.Statement): readonly string[] => {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
  }
  const named = statement as ts.Statement & { readonly name?: ts.Node };
  return named.name !== undefined && ts.isIdentifier(named.name) ? [named.name.text] : [];
};

const hasContractJSDoc = (node: ts.Node): boolean => ts.getJSDocCommentsAndTags(node).length > 0;

test("T610-NR-010 exhaustively documents the exported folder-scope API surface", async () => {
  const root = path.resolve(__dirname, "../../..");
  const surfaces: ReadonlyArray<Readonly<{
    relativePath: string;
    includes: (name: string) => boolean;
  }>> = [
    { relativePath: "src/application/global-understanding/folder-understanding-scope-controller.ts", includes: () => true },
    { relativePath: "src/t305-global-understanding-startup.ts", includes: () => true },
    { relativePath: "src/t305-global-understanding-lifecycle.ts", includes: () => true },
    { relativePath: "src/ui/global-understanding/vscode-global-understanding-runtime.ts", includes: (name) => name.includes("GlobalUnderstanding") || name.endsWith("_COMMAND_ID") || name === "GLOBAL_UNDERSTANDING_VIEW_ID" },
    { relativePath: "src/ui/global-understanding/global-understanding-ui-model.ts", includes: (name) => name.startsWith("GlobalUnderstandingFolder") }
  ];
  let exportedContractCount = 0;
  for (const surface of surfaces) {
    const source = await readFile(path.join(root, surface.relativePath), "utf8");
    const sourceFile = ts.createSourceFile(surface.relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!hasExportModifier(statement)) continue;
      const names = declarationNames(statement).filter(surface.includes);
      if (names.length === 0) continue;
      exportedContractCount += names.length;
      assert.equal(hasContractJSDoc(statement), true, `${surface.relativePath}:${names.join(",")} has declaration-adjacent contract JSDoc`);
      if (!ts.isInterfaceDeclaration(statement) && !ts.isClassDeclaration(statement)) continue;
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) continue;
        const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
        if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword) === true) continue;
        const memberName = member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
        if (memberName === undefined) continue;
        assert.equal(hasContractJSDoc(member), true, `${surface.relativePath}:${names[0]}.${memberName} has declaration-adjacent contract JSDoc`);
      }
    }
  }
  assert.ok(exportedContractCount >= 20, "the traversal covers the complete current T610 export surface rather than a symbol whitelist");
});
