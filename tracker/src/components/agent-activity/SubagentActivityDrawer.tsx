import { ChevronLeft } from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { SubagentTranscript } from "@/components/agent-activity/SubagentTranscript";
import {
  SubagentDrawerContext,
  type SubagentDrawerController,
} from "@/components/agent-activity/subagentDrawerContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SubagentRef } from "@/lib/subagentRef";
import { listSubagents, type SubagentSummary } from "@/services/subagents";

const MAX_STACK_DEPTH = 5;

export interface ResolvedSubagent {
  subagentId: string;
  agentKind: string;
  label: string | null;
  nickname: string | null;
  role: string | null;
  toolUseId: string | null;
}

export interface SubagentDrawerProviderProps {
  projectSlug: string;
  threadId: number | null;
  agentKind: string | null;
  children: ReactNode;
}

export function SubagentDrawerProvider({
  projectSlug,
  threadId,
  agentKind,
  children,
}: SubagentDrawerProviderProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<ResolvedSubagent[]>([]);
  const [picker, setPicker] = useState<SubagentSummary[] | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const pushResolved = useCallback((entry: ResolvedSubagent) => {
    setPicker(null);
    setUnavailable(false);
    setError(null);
    setStack((current) => {
      const next = [...current, entry];
      return next.length > MAX_STACK_DEPTH ? next.slice(next.length - MAX_STACK_DEPTH) : next;
    });
  }, []);

  const resetDrawerState = useCallback(() => {
    setStack([]);
    setPicker(null);
    setResolving(false);
    setError(null);
    setUnavailable(false);
  }, []);

  const openSubagent = useCallback(
    (ref: SubagentRef) => {
      setOpen(true);
      setError(null);
      setPicker(null);
      setUnavailable(false);

      if (ref.resolve === "id") {
        const id = ref.id?.trim();
        if (!id) {
          setError(t("issue.toolCall.subagent.error"));
          return;
        }
        pushResolved({
          subagentId: id,
          agentKind: agentKind?.trim() || "codex",
          label: ref.taskPreview?.trim() || null,
          nickname: ref.nickname?.trim() || null,
          role: ref.subagentType?.trim() || null,
          toolUseId: null,
        });
        return;
      }

      const slug = projectSlug.trim();
      if (!slug || threadId == null || !Number.isInteger(threadId) || threadId <= 0) {
        setUnavailable(true);
        return;
      }

      void resolveFromList({
        ref,
        projectSlug: slug,
        threadId,
        pushResolved,
        setPicker,
        setResolving,
        setError,
        t,
      });
    },
    [agentKind, projectSlug, pushResolved, t, threadId],
  );

  const controller = useMemo<SubagentDrawerController>(
    () => ({
      openSubagent,
      agentKind,
    }),
    [agentKind, openSubagent],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) resetDrawerState();
    },
    [resetDrawerState],
  );

  const handleBack = useCallback(() => {
    setPicker(null);
    setError(null);
    setStack((current) => {
      if (current.length <= 1) {
        setOpen(false);
        return [];
      }
      return current.slice(0, -1);
    });
  }, []);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  const title =
    current?.nickname ||
    current?.label ||
    t("issue.toolCall.subagent.drawerTitle");

  return (
    <SubagentDrawerContext.Provider value={controller}>
      {children}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl lg:max-w-2xl"
        >
          <SheetHeader className="shrink-0 space-y-2 border-b px-6 py-4 pr-12 text-left">
            <div className="flex items-center gap-2">
              {stack.length > 0 || picker ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleBack}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  {t("issue.toolCall.subagent.back")}
                </Button>
              ) : null}
              <SheetTitle className="min-w-0 truncate text-base">{title}</SheetTitle>
              {current?.role ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {current.role}
                </span>
              ) : null}
            </div>
            {stack.length > 1 ? (
              <p className="truncate text-xs text-muted-foreground">
                {stack.map((entry) => entry.nickname || entry.label || entry.subagentId).join(" › ")}
              </p>
            ) : null}
            <SheetDescription className="sr-only">
              {t("issue.toolCall.subagent.drawerTitle")}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {unavailable ? (
              <p className="text-sm text-muted-foreground">{t("issue.toolCall.subagent.unavailable")}</p>
            ) : resolving ? (
              <p className="text-sm text-muted-foreground">{t("issue.toolCall.subagent.loading")}</p>
            ) : error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : picker ? (
              <SubagentPickerList
                items={picker}
                onPick={(entry) =>
                  pushResolved({
                    subagentId: entry.id,
                    agentKind: entry.agentKind,
                    label: entry.label,
                    nickname: entry.nickname,
                    role: entry.role,
                    toolUseId: entry.toolUseId,
                  })
                }
              />
            ) : current && threadId != null ? (
              <SubagentTranscript
                projectSlug={projectSlug}
                parentSessionId={threadId}
                agentKind={current.agentKind}
                subagentId={current.subagentId}
                toolUseId={current.toolUseId}
                enabled={open}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("issue.toolCall.subagent.empty")}</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </SubagentDrawerContext.Provider>
  );
}

function SubagentPickerList({
  items,
  onPick,
}: {
  items: SubagentSummary[];
  onPick: (entry: SubagentSummary) => void;
}) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("issue.toolCall.subagent.empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("issue.toolCall.subagent.pickOne")}</p>
      <ul className="space-y-1">
        {items.map((entry) => {
          const label = entry.nickname || entry.label || entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-left text-sm hover:bg-muted/50"
                onClick={() => onPick(entry)}
              >
                <span className="min-w-0 truncate">{label}</span>
                {entry.role ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {entry.role}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function resolveFromList(args: {
  ref: SubagentRef;
  projectSlug: string;
  threadId: number;
  pushResolved: (entry: ResolvedSubagent) => void;
  setPicker: (items: SubagentSummary[] | null) => void;
  setResolving: (value: boolean) => void;
  setError: (value: string | null) => void;
  t: (key: string) => string;
}): Promise<void> {
  const { ref, projectSlug, threadId, pushResolved, setPicker, setResolving, setError, t } = args;
  setResolving(true);
  setError(null);

  try {
    if (ref.resolve === "toolUseId") {
      const toolUseId = ref.toolUseId?.trim();
      if (!toolUseId) {
        setError(t("issue.toolCall.subagent.error"));
        return;
      }

      const filtered = await listSubagents(projectSlug, threadId, {
        agentKind: "claude",
        toolUseId,
      });
      if (filtered.length === 1) {
        pushFromSummary(filtered[0], pushResolved);
        return;
      }

      const all = await listSubagents(projectSlug, threadId, { agentKind: "claude" });
      setPicker(all);
      return;
    }

    if (ref.resolve === "matchPrompt") {
      const matchPrompt = ref.matchPrompt?.trim();
      if (!matchPrompt) {
        setError(t("issue.toolCall.subagent.error"));
        return;
      }

      const filtered = await listSubagents(projectSlug, threadId, {
        agentKind: "cursor",
        matchPrompt,
      });
      if (filtered.length === 1) {
        pushFromSummary(filtered[0], pushResolved);
        return;
      }

      if (filtered.length === 0) {
        const all = await listSubagents(projectSlug, threadId, { agentKind: "cursor" });
        setPicker(all);
        return;
      }

      setPicker(filtered);
      return;
    }

    setError(t("issue.toolCall.subagent.error"));
  } catch {
    setError(t("issue.toolCall.subagent.error"));
  } finally {
    setResolving(false);
  }
}

function pushFromSummary(
  entry: SubagentSummary,
  pushResolved: (entry: ResolvedSubagent) => void,
): void {
  pushResolved({
    subagentId: entry.id,
    agentKind: entry.agentKind,
    label: entry.label,
    nickname: entry.nickname,
    role: entry.role,
    toolUseId: entry.toolUseId,
  });
}
