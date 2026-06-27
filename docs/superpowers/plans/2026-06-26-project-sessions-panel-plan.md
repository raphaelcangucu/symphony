# Easily-Accessible Project Sessions Panel

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. One focused subagent per task with review between tasks. Replace example commands with this repo's real tools.

**Goal:** Mirror Jean's "sessions are one click away inside the project" UX. Add a project-level **Sessions** tab that lists every agent run/session for the project — grouped by status (Active / Waiting review / Saved-resumable / Recent) — each row deep-linking straight to that issue's Agent → Execution view and offering a one-click **Resume**.

**Why (verified state):** Symphony has no per-project session index. To reach a run you navigate Project → Board → issue → Agent tab → Execution. The data already exists: `AgentExecution.list/0` (`agent_execution_controller.ex:10-14`) projects live/recent runs with `issueIdentifier / status / agentKind / lastEventAt / turnCount / runtimeSeconds / goal` (`types/agent-execution.ts:31-54`, `AgentExecutionStatus` includes `"saved"` = resumable). The tracker already has a `useAgentExecutions()` hook, deep-link helpers `issuePath` + `withAgentSection` (`lib/workspaceRoutes.ts:108,180`), and a global "running sessions" table in `ObservabilityPage.tsx:251-287`. This plan re-hosts that data as a focused, **project-scoped** panel.

**Architecture:** A pure `groupProjectSessions` helper buckets a joined view (executions ⋈ project issues) by status. A `useProjectSessions(slug)` hook joins `useAgentExecutions()` with `listIssues(slug)` (so only the project's issues appear) and feeds the grouping. `ProjectSessionsPanel` renders collapsible status groups of `SessionListItem`s with deep-links + a quick-resume that reuses the existing `dispatchIssueAgent` service. Live updates ride the existing executions hook (no new socket). No backend change required; an optional `?project_slug=` filter on the executions index is a deferred optimization.

**Tech Stack:** React 19 + TanStack Query + shadcn/ui + lucide, vitest. (No Elixir change in the core path.)

---

## File Structure

**Create (tracker):**
- `tracker/src/lib/projectSessions.ts` — `SessionBucket`, `groupProjectSessions(executions, issues)`, status→bucket mapping.
- `tracker/src/hooks/useProjectSessions.ts` — join executions + issues for one project.
- `tracker/src/components/sessions/ProjectSessionsPanel.tsx`
- `tracker/src/components/sessions/SessionListItem.tsx`
- `tracker/src/components/sessions/SessionStatusBadge.tsx`
- `tracker/src/pages/ProjectSessionsPage.tsx`
- tests for the helper, hook, panel, item.

**Modify (tracker):**
- `tracker/src/components/layout/ProjectWorkspaceLayout.tsx` (+ router) — add a "Sessions" tab/route.
- `tracker/src/lib/workspaceRoutes.ts` — `sessionsPath(slug)` (+ `WorkspaceView` member if needed).
- locale files `en` + `pt-BR`.

---

## Task 1: groupProjectSessions helper (pure)

**Files:** Create `lib/projectSessions.ts` + `lib/__tests__/projectSessions.test.ts`.

Buckets: `active` (`live`, `retrying`), `waiting` (`waiting`, `idle`), `saved` (`saved`), `recent` (`error`, `aborted`). Each session row = `{ issueIdentifier, title, agentKind, status, bucket, lastEventAt, turnCount, runtimeSeconds, goalObjective }`. Only executions whose `issueIdentifier` is in the project's issue set are included; project issues with no execution but a prior run marker are **not** synthesized here (kept simple — executions are the source of truth).

- [ ] **Step 1: Write failing test**

```ts
import { groupProjectSessions, sessionBucketFor } from "@/lib/projectSessions";

it("maps statuses to buckets", () => {
  expect(sessionBucketFor("live")).toBe("active");
  expect(sessionBucketFor("retrying")).toBe("active");
  expect(sessionBucketFor("waiting")).toBe("waiting");
  expect(sessionBucketFor("saved")).toBe("saved");
  expect(sessionBucketFor("error")).toBe("recent");
});

it("joins executions to project issues and groups, newest first", () => {
  const issues = [{ identifier: "DEMO-1", title: "A" }, { identifier: "DEMO-2", title: "B" }] as any;
  const executions = new Map<string, any>([
    ["DEMO-1", { issueIdentifier: "DEMO-1", status: "live", lastEventAt: "2026-06-26T10:00:00Z", agentKind: "codex" }],
    ["OTHER-9", { issueIdentifier: "OTHER-9", status: "live" }], // excluded — not in project
    ["DEMO-2", { issueIdentifier: "DEMO-2", status: "saved", lastEventAt: "2026-06-26T09:00:00Z", agentKind: "claude" }],
  ]);
  const grouped = groupProjectSessions(executions, issues);
  expect(grouped.active.map((s) => s.issueIdentifier)).toEqual(["DEMO-1"]);
  expect(grouped.saved.map((s) => s.issueIdentifier)).toEqual(["DEMO-2"]);
  expect(grouped.active.find((s) => s.issueIdentifier === "OTHER-9")).toBeUndefined();
});
```

- [ ] **Step 2: Run (expect fail)** — `cd tracker && npx vitest run src/lib/__tests__/projectSessions.test.ts`

- [ ] **Step 3: Implement** — `sessionBucketFor`, a `SESSION_BUCKETS` order const, and `groupProjectSessions` that builds an issue-title map, filters executions to project issues, maps to rows, sorts each bucket by `lastEventAt` desc.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(sessions): project session grouping helper`.

---

## Task 2: useProjectSessions hook

**Files:** Create `hooks/useProjectSessions.ts` + test.

- [ ] **Step 1: Write failing test** — with `useAgentExecutions` + `listIssues` mocked, the hook returns `{ groups, isLoading }` where `groups` is the output of `groupProjectSessions` for the project's issues; refetches issues on mount; reflects live execution changes.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `useQuery(["issues", slug], () => listIssues(slug))` + `useAgentExecutions()`; `useMemo(() => groupProjectSessions(executions, issues), [executions, issues])`. (Executions hook already polls/streams.)

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(sessions): useProjectSessions hook`.

---

## Task 3: SessionStatusBadge + SessionListItem

**Files:** Create the two components + tests.

- [ ] **Step 1: Write failing badge test** — `SessionStatusBadge({status})` renders a colored dot + label per status (`live`=green pulse, `waiting`=amber, `saved`=slate, `error`=red). Reuse existing `agentExecutionDisplay` label/derive helpers if present.

- [ ] **Step 2: Write failing item test** — `SessionListItem({session, projectSlug, onResume})` renders the issue identifier as a `Link` to `withAgentSection(issuePath(slug,"board",id,"agent"),"","execution")`, the agent chip (reuse `AgentChip`), the status badge, relative last-activity, turn count, the **run duration** (`formatRuntime(session.runtimeSeconds)`, e.g. `2m 03s`), and goal objective when present; a **Resume** button calls `onResume(session)` and is hidden for `active` sessions. For an **active** session (`live`/`retrying`) the duration is a **live ticking timer** (advances ~1/s), mirroring Jean's elapsed timer and Symphony's own `ObservabilityPage`/`WorkingIndicator`.

- [ ] **Step 3: Run (expect fail).**

- [ ] **Step 4: Implement** both, reusing `AgentChip`, `issuePath`/`withAgentSection`, and a relative-time util. **Duration:** reuse the existing `formatRuntime` helper (`AgentTab.tsx:37`); for active rows, drive a live value with the same `nowMs`-tick pattern as `ObservabilityPage.formatRuntime(startedAt, nowMs)` (lines 54, 324) or the `WorkingIndicator` `setInterval` elapsed loop (`WorkingIndicator.tsx:41-45`) — extract a tiny shared `useTickingRuntime(session)` so the timer logic lives in one place and the row stays pure. Settled (`saved`/`recent`) rows show the static `runtimeSeconds`. Keep rows compact and keyboard-focusable.

- [ ] **Step 5: Run (expect pass).**

- [ ] **Step 6: Commit** — `feat(sessions): session row + status badge`.

---

## Task 4: ProjectSessionsPanel

**Files:** Create `ProjectSessionsPanel.tsx` + test.

- [ ] **Step 1: Write failing test** — renders a section per non-empty bucket (Active / Waiting review / Saved / Recent) with a count, lists `SessionListItem`s; empty state when no sessions; clicking Resume on a saved session calls `dispatchIssueAgent(slug, id, {action:"resume"})` (mocked) and shows a toast.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — `useProjectSessions(slug)`; render `SESSION_BUCKETS` in order, each as a labeled group with a count badge; `onResume` wraps `dispatchIssueAgent(slug, id, {action:"resume"})` with optimistic toast + executions-hook refresh + error toast (mirror `ExecutionControlComposer.runDispatch` error handling). Loading + empty states.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(sessions): project sessions panel`.

---

## Task 5: Mount as a project "Sessions" route/tab

**Files:** Create `ProjectSessionsPage.tsx`; modify `ProjectWorkspaceLayout.tsx` + router + `workspaceRoutes.ts`; locales.

- [ ] **Step 1: Write failing test** — navigating to `/projects/:slug/sessions` renders the panel; the project nav shows a "Sessions" entry (lucide `MessagesSquare`/`History`); a live execution count badge appears on the tab when there are active sessions.

- [ ] **Step 2: Run (expect fail).**

- [ ] **Step 3: Implement** — add `sessionsPath(slug)` + `WorkspaceView` member, register the route + nav tab (follow Board/KB tab registration), render `ProjectSessionsPage` → `ProjectSessionsPanel`. Optional: a small active-count badge on the tab from `useProjectSessions`. i18n keys under `sessions.*` in both locales.

- [ ] **Step 4: Run (expect pass).**

- [ ] **Step 5: Commit** — `feat(sessions): project Sessions tab`.

---

## Task 6: Full gates + docs

- [ ] **Step 1: Tracker gate** — `cd tracker && npm run lint && npx vitest run && npm run build` → pass.
- [ ] **Step 2: (If the optional backend filter was added) Backend gate** — `cd elixir && mix specs.check && make all` → pass.
- [ ] **Step 3: Docs** — note the project Sessions tab (buckets, deep-link, quick-resume) in `elixir/README.md` or `../SPEC.md`.
- [ ] **Step 4: Commit** — `docs(sessions): document project Sessions panel`.

---

## Self-Review (spec coverage)

| Requirement (from user) | Task(s) |
| --- | --- |
| "sessões facilmente acessíveis dentro do projeto" (easily accessible sessions in the project) | 1–5 (one-click deep links, grouped by status, per project) |
| Resume a session quickly | 4 (quick-resume reuses dispatch) |
| **Per-session run duration (Jean-style timer)** | 1 (carries `runtimeSeconds`), 3 (renders `formatRuntime` + live ticking timer for active rows) |

**Notes / decisions:**
- Source of truth is the live `AgentExecution` projection (includes `saved`/resumable). Symphony has no persistent run-history store, so "Recent/done" reflects what the projection retains; a durable run-history table is a separate, larger plan if full history is wanted.
- The panel is project-scoped via a client-side join (executions ⋈ `listIssues(slug)`), avoiding any backend change. If the executions list grows large, add an optional `?project_slug=` filter to `agent_execution_controller.index` and resolve project membership server-side — left as a deferred optimization.
- Resume uses the existing `dispatchIssueAgent` service (no new endpoint); when Plan 2a lands, the saved model/effort/mode are already honored by dispatch, so resuming from here respects them automatically.
