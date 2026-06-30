import { useCallback, useEffect, useRef, useState } from "react";

import type { SlashCommandContext } from "@/components/assistant/slashCommands";
import { listAssistantCommands } from "@/services/assistantCommands";
import type { AssistantCommand } from "@/types/assistant-command";

interface UseAssistantCommandsArgs {
  projectSlug?: string;
  context: SlashCommandContext;
}

interface UseAssistantCommandsResult {
  commands: AssistantCommand[];
  isLoading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useAssistantCommands({
  projectSlug,
  context,
}: UseAssistantCommandsArgs): UseAssistantCommandsResult {
  const [commands, setCommands] = useState<AssistantCommand[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await listAssistantCommands(context, projectSlug);
      if (requestId !== requestIdRef.current) return;
      setCommands(result);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setCommands([]);
      setError(cause instanceof Error ? cause : new Error("failed to load assistant commands"));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [context, projectSlug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { commands, isLoading, error, reload };
}
