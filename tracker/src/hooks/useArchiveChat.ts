import { useCallback, useState } from "react";
import { toast } from "sonner";

import { archiveAssistantThread } from "@/services/assistantThreads";

export interface UseArchiveChatResult {
  archiving: boolean;
  archiveChat: (threadId: number) => Promise<boolean>;
}

/**
 * Archives an assistant thread so it drops out of recents. Returns true when
 * the archive succeeded so callers can navigate away from a deleted list row.
 */
export function useArchiveChat(onArchived?: () => void): UseArchiveChatResult {
  const [archiving, setArchiving] = useState(false);

  const archiveChat = useCallback(
    async (threadId: number) => {
      if (archiving) return false;

      setArchiving(true);
      try {
        await archiveAssistantThread(threadId);
        onArchived?.();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to archive chat");
        return false;
      } finally {
        setArchiving(false);
      }
    },
    [archiving, onArchived],
  );

  return { archiving, archiveChat };
}
