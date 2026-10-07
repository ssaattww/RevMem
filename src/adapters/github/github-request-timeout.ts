/** Internal timeout marker; its message is never copied to Output diagnostics. */
export class GitHubRequestTimeoutError extends Error {
  public constructor() {
    super("GitHub request exceeded its configured deadline.");
    this.name = "GitHubRequestTimeoutError";
  }
}

export const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

/** Run one fetch plus response decode with an abortable, hard local deadline. */
export async function runGitHubRequestWithTimeout<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("GitHub request timeout must be a positive safe integer");
  }
  if (signal?.aborted === true) throw new DOMException("GitHub request was superseded.", "AbortError");

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = (): void => {};
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GitHubRequestTimeoutError());
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return;
    const onAbort = (): void => {
      controller.abort();
      reject(new DOMException("GitHub request was superseded.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) onAbort();
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutFailure, aborted]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbortListener();
  }
}
