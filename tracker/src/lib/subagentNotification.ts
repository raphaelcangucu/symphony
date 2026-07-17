/**
 * Parses Codex `<subagent_notification>` user-message blobs into a structured
 * card model for the session-log feed.
 */

export interface SubagentNotification {
  agentId: string | null;
  headline: string;
  tone: "success" | "warning" | "failure" | "neutral";
  detail: string | null;
}

const OPEN_TAG = "<subagent_notification>";
const CLOSE_TAG = "</subagent_notification>";

const SUCCESS_HEADLINES = new Set(["DONE", "APPROVED", "SPEC OK"]);
const WARNING_HEADLINES = new Set([
  "DONE_WITH_CONCERNS",
  "ISSUES",
  "CHANGES_REQUESTED",
  "CHANGES_REQUIRED",
]);
const FAILURE_HEADLINES = new Set(["BLOCKED", "FAILED", "ERROR"]);

export function parseSubagentNotification(
  body: string | null | undefined,
): SubagentNotification | null {
  if (body == null || typeof body !== "string") {
    return null;
  }

  const trimmed = body.trim();
  if (!trimmed.startsWith(OPEN_TAG)) {
    return null;
  }

  const closeIndex = trimmed.indexOf(CLOSE_TAG);
  if (closeIndex === -1) {
    return null;
  }

  const inner = trimmed.slice(OPEN_TAG.length, closeIndex).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return {
      agentId: null,
      headline: "update",
      tone: "neutral",
      detail: inner.length > 0 ? inner : null,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      agentId: null,
      headline: "update",
      tone: "neutral",
      detail: inner.length > 0 ? inner : null,
    };
  }

  const record = parsed as Record<string, unknown>;
  const agentId =
    typeof record.agent_path === "string" && record.agent_path.trim().length > 0
      ? record.agent_path.trim()
      : null;

  const status = record.status;

  if (typeof status === "string") {
    const headline = status.trim() || "update";
    return {
      agentId,
      headline,
      tone: toneForHeadline(headline),
      detail: null,
    };
  }

  if (status && typeof status === "object" && !Array.isArray(status)) {
    const completed = (status as Record<string, unknown>).completed;
    if (typeof completed === "string") {
      const { headline, detail } = splitCompletedStatus(completed);
      return {
        agentId,
        headline,
        tone: toneForHeadline(headline),
        detail,
      };
    }
  }

  return {
    agentId,
    headline: "update",
    tone: "neutral",
    detail: inner.length > 0 ? inner : null,
  };
}

function splitCompletedStatus(completed: string): { headline: string; detail: string | null } {
  const lines = completed.split("\n");
  const firstLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstLineIndex === -1) {
    return { headline: "update", detail: null };
  }

  let headlineLine = lines[firstLineIndex].trim().replace(/^Status:\s*/i, "");
  let detailFromHeadline: string | null = null;

  const colonSpaceIndex = headlineLine.indexOf(": ");
  if (colonSpaceIndex !== -1) {
    detailFromHeadline = headlineLine.slice(colonSpaceIndex + 2).trim() || null;
    headlineLine = headlineLine.slice(0, colonSpaceIndex).trim();
  }

  const restRaw = lines.slice(firstLineIndex + 1).join("\n");
  const detail = buildCompletedDetail(detailFromHeadline, restRaw);
  const headline = headlineLine.length > 0 ? headlineLine : "update";

  return { headline, detail };
}

function buildCompletedDetail(
  detailFromHeadline: string | null,
  restRaw: string,
): string | null {
  if (detailFromHeadline && restRaw.length > 0) {
    return `${detailFromHeadline}\n${restRaw}`.trim() || null;
  }
  if (detailFromHeadline) {
    return detailFromHeadline;
  }
  const rest = restRaw.trim();
  return rest.length > 0 ? rest : null;
}

function toneForHeadline(headline: string): SubagentNotification["tone"] {
  const normalized = headline.trim().toUpperCase();
  if (SUCCESS_HEADLINES.has(normalized)) return "success";
  if (WARNING_HEADLINES.has(normalized)) return "warning";
  if (FAILURE_HEADLINES.has(normalized)) return "failure";
  return "neutral";
}
