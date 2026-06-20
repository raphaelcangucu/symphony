import type { EvidenceArtifactRef, EvidenceRun } from "@/types/evidence";

const GENERIC_MEDIA_NAMES = new Set([
  "video",
  "screenshot",
  "screen",
  "capture",
  "test",
  "recording",
  "playwright",
]);

export function artifactFilename(relative: string): string {
  return relative.split("/").pop() ?? relative;
}

export function humanizeArtifactFilename(filename: string): string {
  let name = filename;
  try {
    name = decodeURIComponent(filename);
  } catch {
    // keep raw filename
  }

  name = name.replace(/\.(png|jpe?g|webp|webm|mp4|gif|txt|log|json|zip)$/i, "");
  name = name.replace(/^[a-z]{2,5}-\d+-/i, "");
  name = name.replace(/[-_]+/g, " ");
  name = name.replace(/\s*\(failed\)\s*$/i, "");
  name = name.replace(/\s*--\s*test\s*failed\s*$/i, "");
  name = name.replace(/\s+/g, " ").trim();

  return name || filename;
}

function formatNavigationUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path && path !== "/") return path;
    return parsed.host || url;
  } catch {
    return url;
  }
}

export function formatNavigationPath(urls: string[]): string {
  const paths = [...new Set(urls.map(formatNavigationUrl).filter(Boolean))];
  return paths.join(" → ");
}

export function runNavigations(run: EvidenceRun): string[] {
  return (run.navigations ?? []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function runProofText(run: EvidenceRun): string | null {
  const proof = run.proof;
  if (!proof || typeof proof !== "object") return null;

  for (const key of ["title", "description", "selector", "text"] as const) {
    const value = proof[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function proofArtifactMeta(
  run: EvidenceRun,
  path: string,
): { label?: string; navigations?: string[] } | null {
  const proof = run.proof;
  if (!proof || typeof proof !== "object") return null;

  const artifacts = proof.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) return null;

  const entry = (artifacts as Record<string, unknown>)[path];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const record = entry as Record<string, unknown>;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
  const navigations = Array.isArray(record.navigations)
    ? record.navigations.filter((value): value is string => typeof value === "string")
    : undefined;

  if (!label && !navigations?.length) return null;
  return { label, navigations };
}

function visualArtifactCount(run: EvidenceRun): number {
  return (run.screenshots?.length ?? 0) + (run.videos?.length ?? 0);
}

function intentFromFilename(path: string): string | null {
  const humanized = humanizeArtifactFilename(artifactFilename(path));
  if (!humanized || GENERIC_MEDIA_NAMES.has(humanized.toLowerCase())) return null;
  return humanized;
}

export function artifactIntent(run: EvidenceRun, ref: EvidenceArtifactRef): string {
  if (ref.label?.trim()) return ref.label.trim();

  const proofMeta = proofArtifactMeta(run, ref.path);
  if (proofMeta?.label) return proofMeta.label;

  const fromFilename = intentFromFilename(ref.path);
  if (fromFilename) return fromFilename;

  if (visualArtifactCount(run) === 1) {
    const runLevel = runProofText(run);
    if (runLevel) return runLevel;
  }

  return humanizeArtifactFilename(artifactFilename(ref.path));
}

export function artifactNavigations(run: EvidenceRun, ref: EvidenceArtifactRef): string | null {
  const refNavs = (ref.navigations ?? []).filter(Boolean);
  if (refNavs.length > 0) return formatNavigationPath(refNavs);

  const proofMeta = proofArtifactMeta(run, ref.path);
  if (proofMeta?.navigations?.length) return formatNavigationPath(proofMeta.navigations);

  if (visualArtifactCount(run) === 1) {
    const runNavs = runNavigations(run);
    if (runNavs.length > 0) return formatNavigationPath(runNavs);
  }

  return null;
}

export function artifactDisplayTitle(run: EvidenceRun, ref: EvidenceArtifactRef): string {
  const intent = artifactIntent(run, ref);
  const navigations = artifactNavigations(run, ref);

  if (navigations && !intent.toLowerCase().includes(navigations.toLowerCase())) {
    return `${navigations} — ${intent}`;
  }

  return intent;
}

export function artifactCaption(_run: EvidenceRun, ref: EvidenceArtifactRef): string {
  return artifactFilename(ref.path);
}

export function runObjective(run: EvidenceRun): string | null {
  const visuals = visualArtifactCount(run);
  if (visuals > 1) return null;

  const proofText = runProofText(run);
  if (proofText) return proofText;

  const navigations = runNavigations(run);
  if (navigations.length > 0) return formatNavigationPath(navigations);

  return null;
}

/** @deprecated Use artifactIntent / artifactDisplayTitle instead */
export function artifactTitle(run: EvidenceRun, relative: string): string {
  return artifactDisplayTitle(run, { path: relative });
}

export function isPreviewableTextArtifact(relative: string): boolean {
  return /\.(txt|log|json|xml|md)$/i.test(relative);
}

export function isExternalArtifact(relative: string): boolean {
  return /\.(zip|html?)$/i.test(relative) || relative.endsWith("/");
}

export function isGenericMediaFilename(path: string): boolean {
  const humanized = humanizeArtifactFilename(artifactFilename(path));
  return GENERIC_MEDIA_NAMES.has(humanized.toLowerCase());
}
