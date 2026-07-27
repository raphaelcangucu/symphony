const comparisonMarker = `\`\`\`dev10x-comparison
{"version":1,"brand":"Dev10x","matrix":"official-high-v1"}
\`\`\``;

const comparisonMarkerPattern =
  /(?:^|\n{2})```dev10x-comparison\n\{"version":1,"brand":"Dev10x","matrix":"official-high-v1"\}\n```(?:\n|$)/;

export function comparisonDescription(description: string | null | undefined): string {
  const human = humanComparisonDescription(description);
  return human ? `${human}\n\n${comparisonMarker}` : comparisonMarker;
}

export function humanComparisonDescription(description: string | null | undefined): string {
  if (typeof description !== "string") return "";
  return description.replace(comparisonMarkerPattern, "\n").trim();
}

export function isComparisonTask(description: string | null | undefined): boolean {
  return typeof description === "string" && comparisonMarkerPattern.test(description);
}

export function isComparisonChildTitle(title: string): boolean {
  return /^\[dev10x-comparison:[a-z0-9-]+\]\s/.test(title);
}
