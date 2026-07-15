import { useAgentExecutionsContext } from "@/hooks/AgentExecutionsProvider";

interface UseAgentExecutionsArgs {
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseAgentExecutionsResult {
  executions: ReturnType<typeof useAgentExecutionsContext>["executions"];
}

/**
 * Reads the layout-level execution snapshot keyed by issue identifier.
 *
 * The optional legacy arguments are intentionally ignored: channel ownership
 * belongs exclusively to AgentExecutionsProvider, so child consumers cannot
 * create another request loop.
 */
export function useAgentExecutions(_args: UseAgentExecutionsArgs = {}): UseAgentExecutionsResult {
  return useAgentExecutionsContext();
}
