import { MessageSquarePlus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createFreeformThread, listAssistantThreads } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";

function freeformThreadTitle(thread: AssistantThread): string {
  const title = thread.title?.trim();
  if (title) return title;

  const preview = thread.preview?.trim();
  if (preview) return preview;

  return "Untitled chat";
}

function parseThreadId(raw: string | undefined): number | null {
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function AssistantPage() {
  const navigate = useNavigate();
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const selectedThreadId = parseThreadId(threadIdParam);

  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadThreads = useCallback(async () => {
    try {
      const items = await listAssistantThreads("freeform");
      setThreads(items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const handleNewChat = useCallback(async () => {
    if (creating) return;

    setCreating(true);
    try {
      const thread = await createFreeformThread();
      setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
      navigate(`/assistant/${thread.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start a new chat");
    } finally {
      setCreating(false);
    }
  }, [creating, navigate]);

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-4">
          <h1 className="text-base font-semibold">Chats</h1>
          <Button type="button" size="sm" onClick={() => void handleNewChat()} disabled={creating}>
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-auto p-2" aria-label="Freeform chats">
          {loading ? (
            <>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </>
          ) : null}

          {!loading && threads.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">No chats yet. Start a new one.</p>
          ) : null}

          {threads.map((thread) => (
            <NavLink
              key={thread.id}
              to={`/assistant/${thread.id}`}
              className={({ isActive }) =>
                cn(
                  "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-foreground",
                  isActive ? "bg-accent text-foreground" : "text-muted-foreground",
                )
              }
            >
              <span className="truncate font-medium text-foreground">{freeformThreadTitle(thread)}</span>
              {thread.preview ? <span className="truncate text-xs text-muted-foreground">{thread.preview}</span> : null}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {selectedThreadId != null ? (
          <ProjectAssistantPanel key={selectedThreadId} threadId={selectedThreadId} view="board" mode="page" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <MessageSquarePlus className="h-8 w-8" />
            <p className="text-sm">Select a chat or start a new one.</p>
          </div>
        )}
      </main>
    </div>
  );
}
