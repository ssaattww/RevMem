/**
 * Shares exact start paths and returned canonical roots for one Current
 * Context generation. Callers create a new session for every generation.
 */
export const createCurrentContextInspectionSession = <Inspection extends { readonly kind: string }>(
  inspect: (startPath: string) => Promise<Inspection>,
): ((startPath: string) => Promise<Inspection>) => {
  const inspections = new Map<string, Promise<Inspection>>();
  return (startPath) => {
    const existing = inspections.get(startPath);
    if (existing !== undefined) return existing;
    const pending = inspect(startPath).then((result) => {
      if (result.kind === "repository" && "repository" in result) {
        const rootPath = (result.repository as { readonly rootPath?: string } | undefined)?.rootPath;
        if (rootPath !== undefined) inspections.set(rootPath, Promise.resolve(result));
      }
      return result;
    });
    inspections.set(startPath, pending);
    void pending.catch(() => {
      if (inspections.get(startPath) === pending) inspections.delete(startPath);
    });
    return pending;
  };
};
