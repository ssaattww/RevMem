import path from "node:path";

/** Path rules supported by filesystem-backed document descriptors. */
export type GitInspectionPathSemantics = "windows" | "posix";

/** Returns the document parent directory required as the Git subprocess working directory. */
export const gitInspectionStartPath = (
  documentFsPath: string,
  semantics: GitInspectionPathSemantics = process.platform === "win32" ? "windows" : "posix"
): string => (semantics === "windows" ? path.win32 : path.posix).dirname(documentFsPath);
