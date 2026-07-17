import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";

export interface ExecutionComposerSeed {
  agent: AgentKind;
  model: string | null;
  effort: string | null;
  /** True when the seed comes from a live/parked execution snapshot. */
  mirrored: boolean;
  /** Stable key for remounting the composer when the mirrored run identity changes. */
  remountKey: string;
}

function shouldMirrorExecution(execution: AgentExecution): boolean {
  if (!execution.agentKind) return false;
  const status = resolveDisplayStatus(execution);
  return status === "live" || status === "waiting" || status === "retrying" || status === "idle";
}

/**
 * Resolves the agent/model/effort the execution composer should display.
 *
 * Active runs mirror the orchestrator snapshot so the UI matches the real
 * agent. Finished or missing runs fall back to durable issue pins (already
 * settings-merged by the API) and finally the catalog default.
 */
export function resolveExecutionComposerSeed(
  execution: AgentExecution | undefined,
  issue: Pick<Issue, "agentKind" | "model" | "effort">,
  defaultAgent: AgentKind,
): ExecutionComposerSeed {
  if (execution && shouldMirrorExecution(execution) && execution.agentKind) {
    const model = execution.model?.trim() || issue.model?.trim() || null;
    const effort = issue.effort?.trim() || null;
    const sessionKey = execution.sessionId?.trim() || execution.issueIdentifier;
    return {
      agent: execution.agentKind,
      model,
      effort,
      mirrored: true,
      remountKey: `live:${sessionKey}:${execution.agentKind}:${model ?? ""}`,
    };
  }

  return {
    agent: issue.agentKind ?? defaultAgent,
    model: issue.model?.trim() || null,
    effort: issue.effort?.trim() || null,
    mirrored: false,
    remountKey: "pins",
  };
}
