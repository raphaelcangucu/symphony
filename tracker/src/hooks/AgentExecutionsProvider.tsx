import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { usePhoenixChannel } from "@/hooks/usePhoenixChannel";
import { listAgentExecutions } from "@/services/agentExecutions";
import {
  AGENT_EXECUTIONS_TOPIC,
  bindAgentExecutionEvents,
} from "@/services/phoenix/agentExecutionChannel";
import type { AgentExecution } from "@/types/agent-execution";

export interface AgentExecutionsContextValue {
  executions: ReadonlyMap<string, AgentExecution>;
}

const AgentExecutionsContext = createContext<AgentExecutionsContextValue | null>(null);

export interface AgentExecutionsProviderProps {
  children: ReactNode;
}

function executionMap(executions: Iterable<AgentExecution>): ReadonlyMap<string, AgentExecution> {
  return new Map([...executions].map((execution) => [execution.issueIdentifier, execution]));
}

export function AgentExecutionsProvider({ children }: AgentExecutionsProviderProps) {
  const [executions, setExecutions] = useState<ReadonlyMap<string, AgentExecution>>(new Map());
  const fallbackStartedRef = useRef(false);

  const loadJoinFallback = useCallback(async () => {
    if (fallbackStartedRef.current) return;
    fallbackStartedRef.current = true;

    try {
      setExecutions(executionMap(await listAgentExecutions()));
    } catch {
      // Keep the last channel snapshot when the one permitted fallback fails.
    }
  }, []);

  usePhoenixChannel({
    topic: AGENT_EXECUTIONS_TOPIC,
    onSetup: (channel) =>
      bindAgentExecutionEvents(channel, {
        onSnapshot: (items) => setExecutions(executionMap(items)),
        onUpsert: (execution) =>
          setExecutions((current) => {
            const next = new Map(current);
            next.set(execution.issueIdentifier, execution);
            return next;
          }),
        onRemove: (issueIdentifier) =>
          setExecutions((current) => {
            if (!current.has(issueIdentifier)) return current;
            const next = new Map(current);
            next.delete(issueIdentifier);
            return next;
          }),
      }),
    onJoinError: () => void loadJoinFallback(),
  });

  const value = useMemo<AgentExecutionsContextValue>(() => ({ executions }), [executions]);
  return <AgentExecutionsContext.Provider value={value}>{children}</AgentExecutionsContext.Provider>;
}

export function useAgentExecutionsContext(): AgentExecutionsContextValue {
  const value = useContext(AgentExecutionsContext);
  if (!value) {
    throw new Error("useAgentExecutions must be used within AgentExecutionsProvider");
  }
  return value;
}
