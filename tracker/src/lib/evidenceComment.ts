import { isEvidenceArtifactUrl } from "@/services/attachments";

export interface EvidenceCommentRun {
  kind: string;
  repo: string;
  command: string;
  status: string;
  summary: string;
}

export interface ParsedEvidenceComment {
  runId: string;
  overallStatus: string;
  uiChange: boolean;
  runs: EvidenceCommentRun[];
  imageUrls: string[];
}

export function isEvidenceComment(body: string, kind?: string | null): boolean {
  if (kind === "evidence") return true;
  return /^##\s*Codex Evidence/m.test(body.trim());
}

export function parseEvidenceComment(body: string): ParsedEvidenceComment | null {
  const trimmed = body.trim();
  if (!/^##\s*Codex Evidence/m.test(trimmed)) return null;

  const runMatch = trimmed.match(/Run `([^`]+)` — overall \*\*([^*]+)\*\*(.*?)(?:\r?\n|$)/);
  if (!runMatch) return null;

  const runs: EvidenceCommentRun[] = [];
  const tableRowRe =
    /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;

  for (const match of trimmed.matchAll(tableRowRe)) {
    const kind = match[1].trim();
    if (kind === "Kind" || kind.startsWith("---")) continue;

    runs.push({
      kind,
      repo: match[2].trim(),
      command: match[3].trim(),
      status: match[4].trim(),
      summary: match[5].trim(),
    });
  }

  return {
    runId: runMatch[1],
    overallStatus: runMatch[2].trim(),
    uiChange: runMatch[3].includes("UI change"),
    runs,
    imageUrls: extractEvidenceImageUrls(trimmed),
  };
}

export function extractEvidenceImageUrls(body: string): string[] {
  const urls = new Set<string>();

  for (const match of body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (isEvidenceArtifactUrl(match[1])) urls.add(match[1]);
  }

  // Cypress screenshot names often include "(failed)", which breaks markdown image alt text.
  for (const match of body.matchAll(/\]\((https?:\/\/.*?\.(?:png|jpe?g|webp|gif))\)/gi)) {
    if (isEvidenceArtifactUrl(match[1])) urls.add(match[1]);
  }

  return [...urls];
}

export function evidenceImageLabel(url: string): string {
  const pathname = url.replace(/^https?:\/\/[^/]+/i, "").split("?")[0]?.split("#")[0] ?? url;
  const filename = pathname.split("/").pop() ?? "screenshot";
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}
