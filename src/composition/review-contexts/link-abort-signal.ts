/** Keeps a VS Code cancellation token in sync even when its source signal was already aborted. */
export const linkAbortSignal = (
  signal: AbortSignal | undefined,
  cancel: () => void,
): (() => void) => {
  if (signal === undefined) return () => undefined;
  const onAbort = (): void => cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return () => signal.removeEventListener("abort", onAbort);
};
