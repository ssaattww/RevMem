/** Immutable text and existence evidence for one exact document revision. */
export type RevisionDocumentText =
  | {
      readonly existence: "present";
      readonly content: string;
    }
  | {
      readonly existence: "absent";
    };

/** Git EOF line terminator: LF or CRLF; bare CR is represented as `none`. */
export type TerminalNewline = "none" | "lf" | "crlf";

/**
 * Line counts used for different consumers of the same immutable document
 * revision. Editor lines use CRLF, bare CR, and LF boundaries. Git content
 * lines use LF delimiters, including CRLF, so bare CR stays within one Git
 * content line. A terminal Git LF or CRLF adds an editor display line but no
 * Git content line.
 */
export interface DocumentLineContract {
  readonly existence: RevisionDocumentText["existence"];
  /** Number of editor-visible lines using CRLF, bare CR, and LF boundaries. */
  readonly editorLineCount: number;
  /** Number of Git LF-delimited content lines; a CRLF delimiter counts once. */
  readonly diffContentLineCount: number;
  /** Git EOF LF/CRLF classification; bare CR is `none`. */
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
