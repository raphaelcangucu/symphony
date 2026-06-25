import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { i18n } from "@/i18n";
import { createFreeformThread } from "@/services/assistantThreads";

export interface UseCreateFreeformChatResult {
  creating: boolean;
  createChat: () => Promise<void>;
}

/**
 * Creates a freeform assistant chat and navigates to it. Re-entrancy is guarded
 * so rapid clicks cannot spawn duplicate threads. `onCreated` lets callers
 * refresh dependent views (e.g. the Recents list) before navigation.
 */
export function useCreateFreeformChat(onCreated?: () => void): UseCreateFreeformChatResult {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const createChat = useCallback(async () => {
    if (creating) return;

    setCreating(true);
    try {
      const thread = await createFreeformThread();
      onCreated?.();
      navigate(`/assistant/${thread.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t("assistant.freeform.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [creating, navigate, onCreated]);

  return { creating, createChat };
}
