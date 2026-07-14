export function graphemeCount(value: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;
}

export function normalizeNullableString(...values: readonly unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string") ?? null;
}

export function normalizeNonBlankString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmedValue = value.trim();
    if (trimmedValue) return trimmedValue;
  }
  return null;
}
