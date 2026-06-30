import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type RunPromptTemplateOverrides,
  type RunPromptTemplateResult,
  runPromptTemplate,
} from "@/services/magicCommands";
import { listPromptTemplates } from "@/services/promptTemplates";
import type { PromptTemplate } from "@/types/prompt-template";

interface UseMagicCommandsArgs {
  projectSlug: string;
  identifier: string;
  onRan?: (result: RunPromptTemplateResult) => void;
}

interface UseMagicCommandsResult {
  commands: PromptTemplate[];
  isLoading: boolean;
  error: Error | null;
  run: (slug: string, overrides?: RunPromptTemplateOverrides) => Promise<RunPromptTemplateResult>;
  isRunning: boolean;
}

export function useMagicCommands({
  projectSlug,
  identifier,
  onRan,
}: UseMagicCommandsArgs): UseMagicCommandsResult {
  const [commands, setCommands] = useState<PromptTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const isMountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;

  const normalizedProjectSlug = useMemo(() => projectSlug.trim(), [projectSlug]);
  const normalizedIdentifier = useMemo(() => identifier.trim(), [identifier]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const requestId = ++loadRequestIdRef.current;

    if (!normalizedProjectSlug) {
      setCommands([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    void listPromptTemplates(normalizedProjectSlug)
      .then((templates) => {
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;

        const sortedEnabledTemplates = templates
          .filter((template) => template.enabled !== false)
          .sort(compareCommands);
        setCommands(sortedEnabledTemplates);
      })
      .catch((cause: unknown) => {
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
        setCommands([]);
        setError(cause instanceof Error ? cause : new Error("Failed to load magic commands"));
      })
      .finally(() => {
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
        setIsLoading(false);
      });
  }, [normalizedProjectSlug]);

  const run = useCallback(
    async (slug: string, overrides?: RunPromptTemplateOverrides): Promise<RunPromptTemplateResult> => {
      if (!normalizedProjectSlug) {
        throw new Error("projectSlug is required");
      }
      if (!normalizedIdentifier) {
        throw new Error("identifier is required");
      }
      if (isRunningRef.current) {
        throw new Error("A magic command is already running");
      }

      setIsRunning(true);
      setError(null);

      try {
        const result = await runPromptTemplate(normalizedProjectSlug, normalizedIdentifier, slug, overrides);
        onRan?.(result);
        return result;
      } catch (cause: unknown) {
        const runError = cause instanceof Error ? cause : new Error("Failed to run magic command");
        if (isMountedRef.current) setError(runError);
        throw runError;
      } finally {
        if (isMountedRef.current) setIsRunning(false);
      }
    },
    [normalizedIdentifier, normalizedProjectSlug, onRan],
  );

  return {
    commands,
    isLoading,
    error,
    run,
    isRunning,
  };
}

function compareCommands(left: PromptTemplate, right: PromptTemplate): number {
  const leftCategory = normalizedCategory(left.category);
  const rightCategory = normalizedCategory(right.category);
  const categoryComparison = leftCategory.localeCompare(rightCategory);
  if (categoryComparison !== 0) return categoryComparison;

  const positionComparison = left.position - right.position;
  if (positionComparison !== 0) return positionComparison;

  return left.name.localeCompare(right.name);
}

function normalizedCategory(value: string | null): string {
  if (typeof value !== "string") return "";
  return value.trim().toLocaleLowerCase();
}
