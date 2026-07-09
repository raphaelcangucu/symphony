# Workspaces Page UI Polish — Implementation Plan

**Goal:** Make `/tracker/projects/:slug/workspaces` scannable and consistent by polishing hybrid workspace cards, inventory toolbar chips, standardized `Button` actions, and relative session timestamps.

**Architecture:** Local UI polish only. Redesign `WorkspaceCardItem` to a hybrid one-line header + aligned session sub-rows; upgrade the list toolbar and empty states in `ProjectSessionsWorkspace`; add `formatRelativeTime` to the shared time helpers. No inventory API, chrome redesign, or new design-system primitives.

**Tech Stack:** React 19, Tailwind v4, Vitest, i18next, existing `Button` / `EmptyState` / `statusPresentation`.

**Spec:** `docs/superpowers/specs/2026-07-09-workspaces-page-ui-polish-design.md`

**Out of scope:** Project header redesign, new shared primitives package, inventory data-model changes, theme redesign, `workspaceCards.ts` grouping changes.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `tracker/src/lib/timeFormat.ts` | Modify | Add `formatRelativeTime` |
| `tracker/src/lib/__tests__/timeFormat.test.ts` | Create | Threshold / null / i18n coverage |
| `tracker/locales/en/tracker.json` | Modify | `time.relative.*` + inventory chip labels |
| `tracker/locales/pt-BR/tracker.json` | Modify | Matching PT strings |
| `tracker/src/components/sessions/WorkspaceCardItem.tsx` | Modify | Hybrid card anatomy |
| `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx` | Modify | Toolbar chips, sentence-case sections, `EmptyState` |
| `tracker/src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx` | Modify | Relative time + link/button assertions |
| `tracker/src/lib/utils.ts` | Modify | Re-export `formatRelativeTime` if other utils re-exports stay the pattern |

---

### Task 1: `formatRelativeTime` helper + i18n keys

**Files:**
- Create: `tracker/src/lib/__tests__/timeFormat.test.ts`
- Modify: `tracker/src/lib/timeFormat.ts`
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`
- Modify: `tracker/src/lib/utils.ts` (re-export)

- [ ] **Step 1: Add i18n keys**

In `tracker/locales/en/tracker.json`, add sibling to `"common"` (top-level):

```json
"time": {
  "relative": {
    "justNow": "just now",
    "seconds": "{{count}}s ago",
    "minutes": "{{count}}m ago",
    "hours": "{{count}}h ago",
    "days": "{{count}}d ago"
  }
}
```

Also under `workspacesPage` add chip labels used by the toolbar:

```json
"inventoryLabel": "Inventory",
"totalsTrees": "{{count}} trees",
"totalsSize": "{{size}}",
"totalsReclaimable": "{{reclaimable}} reclaimable"
```

In `tracker/locales/pt-BR/tracker.json` mirror:

```json
"time": {
  "relative": {
    "justNow": "agora",
    "seconds": "há {{count}}s",
    "minutes": "há {{count}}m",
    "hours": "há {{count}}h",
    "days": "há {{count}}d"
  }
}
```

```json
"inventoryLabel": "Inventário",
"totalsTrees": "{{count}} trees",
"totalsSize": "{{size}}",
"totalsReclaimable": "{{reclaimable}} recuperáveis"
```

Keep existing `workspacesPage.totals` / `totalsLoading` keys (may still be used while loading).

- [ ] **Step 2: Write the failing unit tests**

Create `tracker/src/lib/__tests__/timeFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { formatRelativeTime } from "@/lib/timeFormat";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-09T15:00:00.000Z");

  it("returns '-' for null, undefined, and invalid", () => {
    expect(formatRelativeTime(null, now)).toBe("-");
    expect(formatRelativeTime(undefined, now)).toBe("-");
    expect(formatRelativeTime("not-a-date", now)).toBe("-");
  });

  it("uses justNow under 5 seconds", () => {
    expect(formatRelativeTime("2026-07-09T14:59:57.000Z", now)).toBe(i18n.t("time.relative.justNow"));
  });

  it("formats seconds, minutes, hours, and days", () => {
    expect(formatRelativeTime("2026-07-09T14:59:30.000Z", now)).toBe(
      i18n.t("time.relative.seconds", { count: 30 }),
    );
    expect(formatRelativeTime("2026-07-09T14:45:00.000Z", now)).toBe(
      i18n.t("time.relative.minutes", { count: 15 }),
    );
    expect(formatRelativeTime("2026-07-09T13:00:00.000Z", now)).toBe(
      i18n.t("time.relative.hours", { count: 2 }),
    );
    expect(formatRelativeTime("2026-07-07T15:00:00.000Z", now)).toBe(
      i18n.t("time.relative.days", { count: 2 }),
    );
  });

  it("clamps future timestamps to justNow", () => {
    expect(formatRelativeTime("2026-07-09T16:00:00.000Z", now)).toBe(i18n.t("time.relative.justNow"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd tracker && npm test -- src/lib/__tests__/timeFormat.test.ts
```

Expected: FAIL — `formatRelativeTime` is not exported.

- [ ] **Step 4: Implement `formatRelativeTime`**

Append to `tracker/src/lib/timeFormat.ts`:

```ts
import { i18n } from "@/i18n";

const RELATIVE_JUST_NOW_SECONDS = 5;
const RELATIVE_MINUTE_SECONDS = 60;
const RELATIVE_HOUR_SECONDS = 3600;
const RELATIVE_DAY_SECONDS = 86400;

/**
 * Compact relative time for dense UI rows: "just now", "30s ago", "15m ago", "2h ago", "2d ago".
 * Locale strings live under `time.relative.*`. Invalid/null → "-".
 */
export function formatRelativeTime(value: string | null | undefined, nowMs: number = Date.now()): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return "-";

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));

  if (elapsedSeconds < RELATIVE_JUST_NOW_SECONDS) {
    return i18n.t("time.relative.justNow");
  }
  if (elapsedSeconds < RELATIVE_MINUTE_SECONDS) {
    return i18n.t("time.relative.seconds", { count: elapsedSeconds });
  }
  if (elapsedSeconds < RELATIVE_HOUR_SECONDS) {
    return i18n.t("time.relative.minutes", { count: Math.floor(elapsedSeconds / RELATIVE_MINUTE_SECONDS) });
  }
  if (elapsedSeconds < RELATIVE_DAY_SECONDS) {
    return i18n.t("time.relative.hours", { count: Math.floor(elapsedSeconds / RELATIVE_HOUR_SECONDS) });
  }
  return i18n.t("time.relative.days", { count: Math.floor(elapsedSeconds / RELATIVE_DAY_SECONDS) });
}
```

Place the `i18n` import with other imports at the top of the file (do not leave a mid-file import).

Re-export from `tracker/src/lib/utils.ts` next to the existing `formatDateTime` re-export:

```ts
export { formatDateTime, formatRelativeTime } from "@/lib/timeFormat";
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd tracker && npm test -- src/lib/__tests__/timeFormat.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/lib/timeFormat.ts tracker/src/lib/utils.ts \
  tracker/src/lib/__tests__/timeFormat.test.ts \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): add formatRelativeTime for dense workspace rows

Give session sub-rows compact locale-aware freshness without losing absolute timestamps.
EOF
)"
```

---

### Task 2: Hybrid `WorkspaceCardItem` layout

**Files:**
- Modify: `tracker/src/components/sessions/WorkspaceCardItem.tsx`
- Modify: `tracker/src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx`

- [ ] **Step 1: Update the panel test that asserts absolute timestamps in the list**

In `ProjectSessionsPanel.test.tsx`, replace the absolute datetime visibility assertion with relative-time awareness. Keep open/link assertions.

Find:

```ts
expect(screen.getAllByText(formatDateTime("2026-07-04T15:30:00Z")).length).toBeGreaterThan(0);
```

Replace with (keep `formatDateTime` import for title checks if still needed, or switch):

```ts
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

// ...
const relativeAuthoring = formatRelativeTime("2026-07-04T15:30:00Z");
expect(screen.getAllByText(relativeAuthoring).length).toBeGreaterThan(0);
// Absolute value remains available on title for the matching meta node
expect(
  screen.getAllByTitle(formatDateTime("2026-07-04T15:30:00Z")).length,
).toBeGreaterThan(0);
```

Also assert the issue link still resolves (already present) and that New session / Open buttons remain role-queryable.

- [ ] **Step 2: Run the panel test to verify the relative assertion fails on old markup**

Run:

```bash
cd tracker && npm test -- src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx
```

Expected: FAIL on relative text / title attributes (old markup still prints absolute `formatDateTime` as visible text without relative).

- [ ] **Step 3: Rewrite `WorkspaceCardItem` to the hybrid anatomy**

Replace the component body in `tracker/src/components/sessions/WorkspaceCardItem.tsx` with this structure (preserve exports/props):

```tsx
import { AlertTriangle, ExternalLink, GitBranch, HardDrive, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { ResumeSessionButton } from "@/components/shared/ResumeSessionButton";
import { SessionAgentBadge, SessionTypeBadge } from "@/components/shared/SessionBadge";
import { Button } from "@/components/ui/button";
import { canResumeExecution } from "@/lib/agentExecutionDisplay";
import { executionStatusDotClass } from "@/lib/statusPresentation";
import { formatBytes, type WorkspaceCard } from "@/lib/workspaceCards";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { AgentExecutionStatus } from "@/types/agent-execution";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceRepoState } from "@/types/worktrees";

// ... WorkspaceCardItemProps unchanged ...

export function WorkspaceCardItem(/* props */) {
  const { t } = useTranslation();
  const inventory = card.inventory;
  const orphan = inventory?.classification === "orphan";

  return (
    <li
      className={cn(
        "rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm transition-all",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem] sm:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {card.execution ? <ExecutionStatusDot status={card.execution.status} /> : null}
            {card.issueIdentifier ? (
              <span className="font-mono text-xs font-semibold text-primary">{card.issueIdentifier}</span>
            ) : null}
            {card.kind === "project" ? (
              <span className="truncate text-sm font-semibold text-foreground">
                {t("workspacesPage.projectWorkspace")}
              </span>
            ) : null}
            {card.kind === "standalone" ? (
              <span className="truncate text-sm font-semibold text-foreground">{card.title}</span>
            ) : null}
            {card.kind === "issue" || card.kind === "orphan" || card.kind === "issue_parallel" ? (
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{card.title}</span>
            ) : null}
            {card.kind === "standalone" ? <CardBadge>{t("workspacesPage.standaloneBadge")}</CardBadge> : null}
            {card.kind === "issue_parallel" ? <CardBadge>{t("workspacesPage.parallelBadge")}</CardBadge> : null}
            {orphan ? <CardBadge tone="warning">{t("workspacesPage.orphanBadge")}</CardBadge> : null}
            {card.execution ? <SessionStatusBadge status={card.execution.status} /> : null}
            {card.execution?.agentKind ? <SessionAgentBadge kind={card.execution.agentKind} /> : null}
          </div>

          {inventory ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {inventory.repos.map((repo) => (
                <RepoChip key={repo.path} repo={repo} showName={inventory.repos.length > 1} />
              ))}
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                <HardDrive className="h-3 w-3" />
                {formatBytes(inventory.sizeBytes)}
              </span>
              {inventory.workPresent && orphan ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  {t("workspacesPage.workPresentWarning")}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            {card.execution ? (
              <SessionRow
                label={t("workspacesPage.sessionRows.execution")}
                meta={`${t("sessions.turns", { count: card.execution.turnCount })} · ${formatRelativeTime(card.execution.lastEventAt)}`}
                absoluteTitle={formatDateTime(card.execution.lastEventAt)}
                openAriaLabel={t("sessions.openExecutionAria", { identifier: card.issueIdentifier ?? "" })}
                onOpen={onOpenExecution ? () => onOpenExecution(card.execution!) : undefined}
                trailing={
                  onResume && canResumeExecution(card.execution.execution) ? (
                    <ResumeSessionButton pending={resumePending} onResume={() => onResume(card.execution!)} />
                  ) : null
                }
              />
            ) : null}
            {card.authoring && card.issueIdentifier ? (
              <SessionRow
                label={t("workspacesPage.sessionRows.authoring")}
                meta={formatRelativeTime(card.authoring.updatedAt)}
                absoluteTitle={formatDateTime(card.authoring.updatedAt)}
                openAriaLabel={t("sessions.openAuthoringAria", { identifier: card.issueIdentifier })}
                onOpen={onOpenAuthoring ? () => onOpenAuthoring(card.issueIdentifier!) : undefined}
              />
            ) : null}
            {card.sessions.map((session) => (
              <SessionRow
                key={session.id}
                label={session.title}
                statusDot={<RecentStatusDot statusKind={session.statusKind} className="mt-0.5" />}
                meta={formatRelativeTime(session.updatedAt)}
                absoluteTitle={formatDateTime(session.updatedAt)}
                badge={<SessionTypeBadge kind="chat" />}
                onOpen={onOpenSession ? () => onOpenSession(session) : undefined}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-row flex-wrap items-center gap-1 sm:w-[7.5rem] sm:flex-col sm:items-stretch">
          {card.issueIdentifier && onNewSession ? (
            <Button type="button" variant="default" size="sm" onClick={() => onNewSession(card.issueIdentifier!)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="truncate">{t("workspacesPage.newSession.button")}</span>
            </Button>
          ) : null}
          {issueHref ? (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 sm:w-full sm:justify-center">
              <Link
                to={issueHref}
                aria-label={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
                title={t("sessions.openIssueAria", { identifier: card.issueIdentifier ?? "" })}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
          {inventory?.removable && onRemove && card.kind !== "issue" && card.kind !== "project" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(inventory.path)}
            >
              {t("workspacesPage.sessionRows.remove")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function RepoChip({ repo, showName }: { repo: WorkspaceRepoState; showName: boolean }) {
  const { t } = useTranslation();
  const dirtyLabel = repo.dirty ? t("workspacesPage.workPresentWarning") : t("workspacesPage.clean");

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground",
        repo.dirty && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500",
      )}
    >
      <GitBranch className="h-3 w-3 shrink-0 opacity-60" />
      {showName ? <span className="font-medium text-foreground/80">{repo.name}</span> : null}
      <span className="truncate font-mono text-foreground/80">{repo.branch ?? "?"}</span>
      <span>·</span>
      <span>{dirtyLabel}</span>
      {repo.aheadCount > 0 ? <span>· {t("workspacesPage.ahead", { count: repo.aheadCount })}</span> : null}
    </span>
  );
}

function SessionRow({
  label,
  meta,
  absoluteTitle,
  badge = null,
  statusDot = null,
  trailing = null,
  openAriaLabel,
  onOpen,
}: {
  label: string;
  meta: string;
  absoluteTitle?: string;
  badge?: React.ReactNode;
  statusDot?: React.ReactNode;
  trailing?: React.ReactNode;
  openAriaLabel?: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {statusDot}
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {badge}
        <span className="truncate text-[11px] text-muted-foreground" title={absoluteTitle}>
          {meta}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpen ? (
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5" aria-label={openAriaLabel} onClick={onOpen}>
            {t("workspacesPage.sessionRows.open")}
          </Button>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}

function CardBadge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "warning"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-500"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ExecutionStatusDot({ status }: { status: AgentExecutionStatus }) {
  const { t } = useTranslation();
  const label = t(`sessions.status.${status}`);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", executionStatusDotClass(status))}
    />
  );
}
```

Delete the local `STATUS_DOT_CLASS` map entirely. Keep `Clock` import out (relative text no longer needs the clock icon in every row — saves density).

- [ ] **Step 4: Re-run panel tests**

Run:

```bash
cd tracker && npm test -- src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx
```

Expected: PASS. If New session labels or layout queries break, adjust aria/name queries only — do not loosen behavior assertions.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/sessions/WorkspaceCardItem.tsx \
  tracker/src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): polish workspace cards for hybrid scan layout

Put ID, title, and status on one line; chip repo health; align Abrir actions and standardize Button variants.
EOF
)"
```

---

### Task 3: Inventory toolbar, section titles, EmptyState

**Files:**
- Modify: `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- Modify: `tracker/src/components/sessions/__tests__/ProjectSessionsWorkspace.test.tsx` (only if assertions mention uppercase or old empty markup)

- [ ] **Step 1: Update list toolbar + empty/loading + section heading**

In `ProjectSessionsWorkspace.tsx`:

1. Import `EmptyState` from `@/components/ui/empty-state`.

2. Replace the inventory totals strip (the `mb-2 flex flex-wrap…` block around lines 415–444) with:

```tsx
<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2 shadow-sm">
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
      {t("workspacesPage.inventoryLabel")}
    </span>
    {inventory ? (
      <>
        <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80">
          {isInventoryLoading
            ? t("workspacesPage.totalsLoading", {
                count: inventory.totals.count,
                size: formatBytes(inventory.totals.sizeBytes),
              })
            : t("workspacesPage.totalsTrees", { count: inventory.totals.count })}
        </span>
        {!isInventoryLoading ? (
          <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80">
            {t("workspacesPage.totalsSize", { size: formatBytes(inventory.totals.sizeBytes) })}
          </span>
        ) : null}
        {!isInventoryLoading && inventory.totals.reclaimableBytes > 0 ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
            {t("workspacesPage.totalsReclaimable", {
              reclaimable: formatBytes(inventory.totals.reclaimableBytes),
            })}
          </span>
        ) : null}
      </>
    ) : isInventoryLoading ? (
      <span className="text-xs text-muted-foreground">{t("workspacesPage.inventoryLoading")}</span>
    ) : null}
  </div>
  <div className="flex items-center gap-2">
    <Button type="button" variant="outline" size="sm" onClick={() => setNewWorkspaceOpen(true)}>
      <FolderPlus className="h-3.5 w-3.5" />
      {t("workspacesPage.newWorkspace.button")}
    </Button>
    {inventory && !isInventoryLoading ? (
      <Button type="button" variant="outline" size="sm" onClick={() => setCleanupOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        {t("workspacesPage.cleanup.button")}
      </Button>
    ) : null}
  </div>
</div>
```

3. Replace loading / empty dashed boxes with:

```tsx
{isLoading && total === 0 ? (
  <EmptyState variant="simple">{t("sessions.loading")}</EmptyState>
) : null}

{!isLoading && total === 0 && !isInventoryLoading ? (
  <EmptyState variant="simple">{t("sessions.empty")}</EmptyState>
) : null}
```

4. In `WorkspaceCardSection`, change the heading class from:

```tsx
<h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
```

to:

```tsx
<h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
```

(drop `uppercase` so pt-BR “Aguardando” stays sentence case).

- [ ] **Step 2: Run workspace + panel tests**

Run:

```bash
cd tracker && npm test -- src/components/sessions/__tests__/ProjectSessionsWorkspace.test.tsx src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx
```

Expected: PASS. Update any brittle text queries if they depended on the old concatenated totals string.

- [ ] **Step 3: Commit**

```bash
git add tracker/src/components/sessions/ProjectSessionsWorkspace.tsx \
  tracker/src/components/sessions/__tests__/ProjectSessionsWorkspace.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): polish workspaces inventory toolbar and empty states

Surface reclaimable disk as a success chip and align section titles with shared EmptyState.
EOF
)"
```

---

### Task 4: Full verification + manual scan checklist

**Files:** none required beyond fixes discovered by tests.

- [ ] **Step 1: Run focused suites + timeFormat**

```bash
cd tracker && npm test -- \
  src/lib/__tests__/timeFormat.test.ts \
  src/lib/__tests__/workspaceCards.test.ts \
  src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx \
  src/components/sessions/__tests__/ProjectSessionsWorkspace.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Manual checklist on `http://localhost:4000/tracker/projects/gamba/workspaces`**

Confirm:

1. Header line shows ID + title + status without a second title block.
2. Abrir buttons share a vertical action column across Execution/Authoring rows.
3. Dirty repo chips are amber; disk size visible; reclaimable chip green when non-zero.
4. Sub-row times look like `há 2h` / `2h ago` with absolute `title` on hover.
5. Card is `rounded-xl` with light hover lift; section titles are sentence case (“Aguardando”).
6. All actions use shared Button sizing (no micro Abrir, issue open is Button+Link).

- [ ] **Step 3: Fix any visual/test regressions found, then final commit if needed**

```bash
git add -A
git status
# only if there are fixes:
git commit -m "$(cat <<'EOF'
fix(tracker): tidy workspaces UI polish follow-ups

EOF
)"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Hybrid one-line header + sub-rows | Task 2 |
| Repo chips + disk + amber dirty | Task 2 |
| Action gutter with Button variants | Task 2 |
| Relative time + absolute title | Task 1 + 2 |
| Reuse `executionStatusDotClass` | Task 2 |
| Inventory chips + reclaimable success | Task 3 |
| Sentence-case section titles | Task 3 |
| EmptyState for loading/empty | Task 3 |
| No chrome redesign / no API change | Out of scope (honored) |
| Tests stay green + relative assertions | Tasks 1–4 |

No placeholders remain. Types/helpers are named consistently: `formatRelativeTime`, `RepoChip`, `SessionRow`, `time.relative.*`, `workspacesPage.totalsTrees|totalsSize|totalsReclaimable|inventoryLabel`.
