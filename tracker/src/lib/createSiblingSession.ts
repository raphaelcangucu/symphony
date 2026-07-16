import {
  createIssueSessionThread,
  createProjectSessionThread,
} from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";
import type { AgentKind } from "@/types/issue";

export type SiblingSessionSource = Pick<
  AssistantThread,
  "projectSlug" | "issueIdentifier" | "workspacePath" | "agentKind"
>;

/**
 * Creates a new assistant thread mirroring the source session's workspace,
 * agent, and issue scope (when present). Does not copy title or transcript.
 */
export async function createSiblingSession(
  source: SiblingSessionSource,
): Promise<AssistantThread> {
  if (source == null || typeof source !== "object") {
    throw new Error("source thread metadata is required");
  }

  const projectSlug = requireNonBlank(source.projectSlug, "projectSlug");
  const issueIdentifier = normalizeOptionalNonBlank(source.issueIdentifier);
  const input = buildMirrorInput(source);

  if (issueIdentifier) {
    return createIssueSessionThread(projectSlug, issueIdentifier, input);
  }

  return createProjectSessionThread(projectSlug, input);
}

function buildMirrorInput(source: SiblingSessionSource): {
  workspacePath?: string;
  agentKind?: AgentKind;
} {
  const workspacePath = normalizeOptionalNonBlank(source.workspacePath);
  const agentKind =
    source.agentKind === "codex" ||
    source.agentKind === "claude" ||
    source.agentKind === "cursor" ||
    source.agentKind === "opencode"
      ? source.agentKind
      : undefined;

  return {
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(agentKind === undefined ? {} : { agentKind }),
  };
}

function requireNonBlank(value: string | null | undefined, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function normalizeOptionalNonBlank(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
