/** Immutable text and existence evidence for one exact document revision. */
export type RevisionDocumentText =
  | {
      readonly existence: "present";
      readonly content: string;
    }
  | {
      readonly existence: "absent";
    };

/** The line terminator at the end of a present document revision. */
export type TerminalNewline = "none" | "lf" | "crlf";

/**
 * Line counts used for different consumers of the same immutable document
 * revision. Editor line count includes a trailing display line after an EOF
 * newline; diff content line count excludes only that display line.
 */
export interface DocumentLineContract {
  readonly existence: RevisionDocumentText["existence"];
  readonly editorLineCount: number;
  readonly diffContentLineCount: number;
  readonly terminalNewline: TerminalNewline;
}

const terminalNewlineFor = (content: string): TerminalNewline => {
  if (content.endsWith("\r\n")) return "crlf";
  if (content.endsWith("\n")) return "lf";
  return "none";
};

/**
 * Derives existence, editor line count, diff content line count, and EOF
 * newline from one immutable revision result. Callers must supply absence as
 * explicit revision evidence; an empty present body remains a present file.
 */
export function deriveDocumentLineContract(
  document: RevisionDocumentText
): DocumentLineContract {
  if (document.existence === "absent") {
    return {
      existence: "absent",
      editorLineCount: 0,
      diffContentLineCount: 0,
      terminalNewline: "none"
    };
  }

  const terminalNewline = terminalNewlineFor(document.content);
  const editorLineCount = (document.content.match(/\r\n|\r|\n/gu)?.length ?? 0) + 1;
  const gitContentLineCount = document.content.length === 0
    ? 0
    : (document.content.match(/\r\n|\n/gu)?.length ?? 0) + 1 -
      (terminalNewline === "none" ? 0 : 1);

  return {
    existence: "present",
    editorLineCount,
    diffContentLineCount: gitContentLineCount,
    terminalNewline
  };
}
