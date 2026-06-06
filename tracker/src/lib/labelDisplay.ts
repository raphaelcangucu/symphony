import type { IssueLabelOption } from "@/types/issue";

const GITHUB_LABEL_ID_PATTERN = /^LA_[A-Za-z0-9_]+$/;

export function isOpaqueLabelId(value: string): boolean {
  return GITHUB_LABEL_ID_PATTERN.test(value.trim());
}

export function resolveLabelDisplay(value: string, options: readonly IssueLabelOption[] = []): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const byId = options.find((option) => option.id === trimmed);
  if (byId?.name) return byId.name;

  const byName = options.find((option) => option.name === trimmed);
  if (byName?.name) return byName.name;

  return trimmed;
}

export function resolveLabelColor(value: string, options: readonly IssueLabelOption[] = []): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match =
    options.find((option) => option.id === trimmed) ??
    options.find((option) => option.name === trimmed);

  return match?.color ?? null;
}
