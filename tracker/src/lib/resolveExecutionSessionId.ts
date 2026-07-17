export function resolveExecutionSessionId(
  executions: ReadonlyArray<{ issueIdentifier: string; executionSessionId: number | null }>,
  issueIdentifier: string,
): number | null {
  const id = issueIdentifier.trim();
  if (!id) return null;
  const match = executions.find((e) => e.issueIdentifier === id && e.executionSessionId != null);
  return match?.executionSessionId ?? null;
}
