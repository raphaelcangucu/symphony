import { Clock, ExternalLink, ListFilter, Plus, Search } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { FreeformAssistantPanel } from "@/components/assistant/FreeformAssistantPanel";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { ResumeSessionButton } from "@/components/shared/ResumeSessionButton";
import {
  SessionAgentBadge,
  SessionBadgeShell,
  SessionStatusKindBadge,
  SessionTypeBadge,
  type SessionBadgeKind,
} from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useCreateFreeformChat } from "@/hooks/useCreateFreeformChat";
import { useRecents } from "@/hooks/useRecents";
import { toggleListParam } from "@/lib/issueFilters";
import { cn, formatDateTime } from "@/lib/utils";
import { issuePath } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { AgentKind } from "@/types/issue";
import type { RecentSession, RecentStatusKind } from "@/types/recents";

const SESSIONS_LIMIT = 50;
const TYPE_PARAM = "type";
const STATUS_PARAM = "status";
const PROJECT_PARAM = "project";
const NO_PROJECT_VALUE = "@none";

type AssistantSessionType = "chat" | "execution";

interface AssistantFilters {
  types: AssistantSessionType[];
  statuses: RecentStatusKind[];
  projects: string[];
}

interface FilterOption {
  value: string;
  label: string;
}

function parseThreadId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function matchesQuery(session: RecentSession, query: string): boolean {
  if (!query) return true;

  const haystack = [
    session.title,
    session.preview ?? "",
    session.identifier ?? "",
    session.projectName ?? "",
    session.projectSlug ?? "",
    session.kind,
    session.agentKind ?? "",
    session.status,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function assistantFiltersFromSearchParams(params: URLSearchParams): AssistantFilters {
  return {
    types: parseListParam(params, TYPE_PARAM).filter(isAssistantSessionType),
    statuses: parseListParam(params, STATUS_PARAM).filter(isRecentStatusKind),
    projects: parseListParam(params, PROJECT_PARAM),
  };
}

function parseListParam(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isAssistantSessionType(value: string): value is AssistantSessionType {
  return value === "chat" || value === "execution";
}

function isRecentStatusKind(value: string): value is RecentStatusKind {
  return [
    "running",
    "waiting",
    "retrying",
    "idle",
    "active",
    "closed",
    "error",
    "aborted",
    "done",
    "in_progress",
    "todo",
  ].includes(value);
}

function sessionTypeValue(session: RecentSession): AssistantSessionType {
  return session.kind === "codex" ? "execution" : "chat";
}

function sessionProjectValue(session: RecentSession): string {
  return session.projectSlug?.trim() || NO_PROJECT_VALUE;
}

function matchesAssistantFilters(session: RecentSession, filters: AssistantFilters): boolean {
  if (filters.types.length > 0 && !filters.types.includes(sessionTypeValue(session))) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(session.statusKind)) return false;
  if (filters.projects.length > 0 && !filters.projects.includes(sessionProjectValue(session))) return false;
  return true;
}

function countAssistantFilters(filters: AssistantFilters): number {
  return filters.types.length + filters.statuses.length + filters.projects.length;
}

function sessionTypeValueLabel(value: AssistantSessionType, t: TFunction): string {
  return value === "execution" ? t("assistant.page.type.execution") : t("assistant.page.type.chat");
}

function statusLabel(session: RecentSession): string {
  const status = session.status.trim();
  return status || titleizeToken(session.statusKind);
}

function titleizeToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildStatusOptions(sessions: RecentSession[]): FilterOption[] {
  const options = new Map<string, string>();
  for (const session of sessions) {
    if (!options.has(session.statusKind)) options.set(session.statusKind, statusLabel(session));
  }
  return Array.from(options, ([value, label]) => ({ value, label })).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function buildProjectOptions(sessions: RecentSession[], t: TFunction): FilterOption[] {
  const options = new Map<string, string>();
  for (const session of sessions) {
    const value = sessionProjectValue(session);
    if (options.has(value)) continue;
    options.set(value, session.projectName?.trim() || session.projectSlug?.trim() || t("assistant.page.filters.noProject"));
  }
  return Array.from(options, ([value, label]) => ({ value, label })).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function sessionBadgeKind(session: RecentSession): SessionBadgeKind {
  return session.kind === "codex" ? "execution" : "chat";
}

function sessionAgentKind(session: RecentSession): AgentKind | null {
  return session.agentKind ?? (session.kind === "codex" ? "codex" : null);
}

/** Live run states where a resume action would be meaningless. Mirrors the
 * sessions list, which hides resume while `canResumeExecution` is false. */
const ACTIVE_EXECUTION_STATUS_KINDS = new Set<RecentStatusKind>(["running", "waiting", "idle", "retrying"]);

function isExecutionSession(
  session: RecentSession,
): session is RecentSession & { projectSlug: string; identifier: string } {
  return session.kind === "codex" && Boolean(session.projectSlug) && Boolean(session.identifier);
}

function isResumableExecutionSession(session: RecentSession): boolean {
  if (!isExecutionSession(session)) return false;
  return !ACTIVE_EXECUTION_STATUS_KINDS.has(session.statusKind);
}

function executionIssueHref(session: RecentSession): string | null {
  if (!isExecutionSession(session)) return null;
  return issuePath(session.projectSlug, "board", session.identifier);
}

function SessionAgentBadgeForSession({ session }: { session: RecentSession }) {
  const agentKind = sessionAgentKind(session);
  return agentKind ? <SessionAgentBadge kind={agentKind} /> : null;
}

function SessionsView({
  sessions,
  loading,
  refetch,
  archiving,
  onArchive,
  resumePending,
  onResume,
}: {
  sessions: RecentSession[];
  loading: boolean;
  refetch: () => Promise<void>;
  archiving: boolean;
  onArchive: (threadId: number) => void;
  resumePending: string | null;
  onResume: (session: RecentSession) => void;
}) {
  const { t } = useTranslation();
  const { creating, createChat } = useCreateFreeformChat(() => void refetch());
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filters = useMemo(() => assistantFiltersFromSearchParams(searchParams), [searchParams]);
  const activeFiltersCount = countAssistantFilters(filters);
  const filtered = useMemo(
    () => sessions.filter((session) => matchesQuery(session, normalizedQuery) && matchesAssistantFilters(session, filters)),
    [sessions, normalizedQuery, filters],
  );
  const filterButtonLabel =
    activeFiltersCount === 0
      ? t("assistant.page.filters.trigger")
      : t("assistant.page.filters.triggerCount", { count: activeFiltersCount });

  function toggleFilterParam(key: string, value: string) {
    setSearchParams((current) => toggleListParam(current, key, value), { replace: true });
  }

  function clearFilters() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(TYPE_PARAM);
        next.delete(STATUS_PARAM);
        next.delete(PROJECT_PARAM);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className="flex h-full flex-col" aria-label={t("assistant.page.conversationsAria")}>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <h1 className="text-base font-semibold">{t("assistant.page.title")}</h1>
        <Button type="button" size="sm" onClick={() => void createChat()} disabled={creating}>
          <Plus className="h-4 w-4" />
          {t("assistant.page.newChat")}
        </Button>
      </div>

      <div className="border-b px-6 py-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("assistant.page.searchPlaceholder")}
            aria-label={t("assistant.page.searchAria")}
            className="pl-9"
          />
          </div>
          <Button type="button" variant="outline" onClick={() => setFiltersOpen(true)} aria-label={filterButtonLabel}>
            <ListFilter className="h-4 w-4" />
            {filterButtonLabel}
          </Button>
        </div>
      </div>

      <AssistantFiltersDrawer
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        sessions={sessions}
        filters={filters}
        onToggle={toggleFilterParam}
        onClear={clearFilters}
      />

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {loading && sessions.length === 0 ? (
          <div className="space-y-2 px-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("assistant.page.empty")}</p>
        ) : null}

        {!loading && sessions.length > 0 && filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("assistant.page.noMatch")}</p>
        ) : null}

        <ul className="space-y-1">
          {filtered.map((session) => {
            const issueHref = executionIssueHref(session);
            return (
              <li key={session.id} className="group flex items-start gap-1 rounded-md hover:bg-accent">
                <Link
                  to={recentSessionPath(session)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5"
                >
                  <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{session.title}</span>
                      <SessionTypeBadge kind={sessionBadgeKind(session)} />
                      <SessionAgentBadgeForSession session={session} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{recentSessionSubtitle(session, t)}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDateTime(session.updatedAt)}
                    </span>
                  </span>
                </Link>
                {session.threadId != null ? (
                  <ArchiveChatButton
                    threadId={session.threadId}
                    archiving={archiving}
                    onArchive={onArchive}
                    className="mr-1 mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  />
                ) : null}
                {issueHref ? (
                  <Link
                    to={issueHref}
                    aria-label={t("sessions.openIssueAria", { identifier: session.identifier })}
                    title={t("sessions.openIssueAria", { identifier: session.identifier })}
                    className="mr-1 mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : null}
                {isResumableExecutionSession(session) ? (
                  <ResumeSessionButton
                    pending={resumePending === session.id}
                    onResume={() => onResume(session)}
                    className="mr-1 mt-1.5"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function AssistantFiltersDrawer({
  open,
  onOpenChange,
  sessions,
  filters,
  onToggle,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: RecentSession[];
  filters: AssistantFilters;
  onToggle: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const statusOptions = useMemo(() => buildStatusOptions(sessions), [sessions]);
  const projectOptions = useMemo(() => buildProjectOptions(sessions, t), [sessions, t]);
  const typeOptions = useMemo<FilterOption[]>(
    () => [
      { value: "chat", label: sessionTypeValueLabel("chat", t) },
      { value: "execution", label: sessionTypeValueLabel("execution", t) },
    ],
    [t],
  );
  const activeCount = countAssistantFilters(filters);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("assistant.page.filters.title")}</SheetTitle>
          <SheetDescription>{t("assistant.page.filters.description")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-y-auto pr-1">
          <FilterSection title={t("assistant.page.filters.type")}>
            {typeOptions.map((option) => (
              <FilterOptionButton
                key={option.value}
                label={option.label}
                selected={filters.types.includes(option.value as AssistantSessionType)}
                onClick={() => onToggle(TYPE_PARAM, option.value)}
              >
                <SessionTypeBadge kind={option.value as SessionBadgeKind} />
              </FilterOptionButton>
            ))}
          </FilterSection>

          <FilterSection title={t("assistant.page.filters.status")}>
            {statusOptions.length > 0 ? (
              statusOptions.map((option) => (
                <FilterOptionButton
                  key={option.value}
                  label={option.label}
                  selected={filters.statuses.includes(option.value as RecentStatusKind)}
                  onClick={() => onToggle(STATUS_PARAM, option.value)}
                >
                  <SessionStatusKindBadge statusKind={option.value as RecentStatusKind} label={option.label} />
                </FilterOptionButton>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("assistant.page.filters.noOptions")}</p>
            )}
          </FilterSection>

          <FilterSection title={t("assistant.page.filters.project")}>
            {projectOptions.length > 0 ? (
              projectOptions.map((option) => (
                <FilterOptionButton
                  key={option.value}
                  label={option.label}
                  selected={filters.projects.includes(option.value)}
                  onClick={() => onToggle(PROJECT_PARAM, option.value)}
                >
                  <SessionBadgeShell label={option.label} />
                </FilterOptionButton>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("assistant.page.filters.noOptions")}</p>
            )}
          </FilterSection>
        </div>

        <SheetFooter className="mt-auto flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={activeCount === 0} onClick={onClear}>
            {t("assistant.page.filters.clear")}
          </Button>
          <SheetClose asChild>
            <Button size="sm">{t("assistant.page.filters.done")}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterOptionButton({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "ring-2 ring-primary/35 ring-offset-1 ring-offset-background"
          : "opacity-80 hover:opacity-100",
      )}
    >
      {children}
    </button>
  );
}

export function AssistantPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const selectedThreadId = parseThreadId(threadIdParam);
  const { sessions, loading, refetch } = useRecents({ limit: SESSIONS_LIMIT });
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());
  const [resumePending, setResumePending] = useState<string | null>(null);

  const handleArchive = useCallback(
    (threadId: number) => {
      void archiveChat(threadId);
    },
    [archiveChat],
  );

  const handleArchiveOpenChat = useCallback(() => {
    if (selectedThreadId == null) return;
    void (async () => {
      const archived = await archiveChat(selectedThreadId);
      if (archived) navigate("/assistant");
    })();
  }, [archiveChat, navigate, selectedThreadId]);

  const handleResume = useCallback(
    (session: RecentSession) => {
      if (!isExecutionSession(session)) return;

      setResumePending(session.id);
      void (async () => {
        try {
          const result = await dispatchIssueAgent(session.projectSlug, session.identifier, { action: "resume" });
          toast.success(result.message || t("sessions.resumeStarted", { identifier: session.identifier }));
          await refetch();
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : t("sessions.resumeFailed", { identifier: session.identifier }));
        } finally {
          setResumePending(null);
        }
      })();
    },
    [refetch, t],
  );

  if (selectedThreadId == null) {
    return (
      <SessionsView
        sessions={sessions}
        loading={loading}
        refetch={refetch}
        archiving={archiving}
        onArchive={handleArchive}
        resumePending={resumePending}
        onResume={handleResume}
      />
    );
  }

  return (
    <FreeformAssistantPanel
      key={selectedThreadId}
      threadId={selectedThreadId}
      archiving={archiving}
      onArchive={handleArchiveOpenChat}
    />
  );
}
