import { useCallback, useState } from "react";

import type { SidebarActionResult } from "@/hooks/useSidebarActions";

interface SidebarDialogMutationOptions {
  fallbackError: string;
  onCommitted(): void;
  onCommittedWarning?(warning: string): void;
}

export function useSidebarDialogMutation({
  fallbackError,
  onCommitted,
  onCommittedWarning,
}: SidebarDialogMutationOptions) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPending(false);
    setError(null);
  }, []);

  const run = useCallback(
    async (mutation: () => Promise<SidebarActionResult>) => {
      if (pending) return;
      setPending(true);
      setError(null);
      try {
        const result = await mutation();
        if (result.ok) {
          onCommitted();
          return;
        }
        if (result.committed === true) {
          onCommittedWarning?.(result.warning);
          onCommitted();
          return;
        }
        setError(result.error);
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : fallbackError,
        );
      } finally {
        setPending(false);
      }
    },
    [fallbackError, onCommitted, onCommittedWarning, pending],
  );

  return { pending, error, reset, run };
}
