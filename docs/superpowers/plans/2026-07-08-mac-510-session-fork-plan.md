# Session Fork Implementation Plan

**Goal:** Add a "Fork session" action that creates a new, independent parallel agent session carrying over the source chat transcript but with a fresh isolated working tree and a fresh agent brain.

**Architecture:** A new `POST /assistant/threads/:id/fork` endpoint delegates to a small `SymphonyElixir.Assistant.ForkSession` domain module. For `issue_session` sources it reuses `History.create_issue_session_thread(..., isolated_workspace: true)`; for `project_session` sources it creates a fresh standalone workspace. In both cases it copies the transcript with `History.copy_messages_to_empty_thread/2` and deliberately does NOT copy `agent_thread_ids`/`codex_thread_id` (clean fork). The frontend adds a `ForkSessionButton` in the open-session toolbar that calls the endpoint and navigates to the new thread (which opens as a new tab while the original stays open).

**Tech Stack:** Elixir/Phoenix (Ecto, SQLite), React + TypeScript, Vite, Vitest, react-i18next, lucide-react, sonner.

**Note on commits:** Commit steps are included per the writing-plans workflow, but during execution I will NOT run any `git commit` unless you explicitly approve it.

---

## File Structure

**Backend (Elixir)**
- Create: `elixir/lib/symphony_elixir/assistant/fork_session.ex` — the fork domain logic (one public function `fork/1`).
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` — add `fork/2` action + alias.
- Modify: `elixir/lib/symphony_elixir_web/router.ex:110` — add the fork route.
- Create: `elixir/test/symphony_elixir/assistant/fork_session_test.exs` — unit tests.
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs` — endpoint tests.
- Modify: `elixir/README.md` — document the new endpoint (docs policy).

**Frontend (React/TS)**
- Modify: `tracker/src/services/assistantThreads.ts` — add `forkAssistantThread`.
- Modify: `tracker/src/services/__tests__/assistantThreads.test.ts` — service test.
- Create: `tracker/src/hooks/useForkSession.ts` — fork hook (API + toast).
- Create: `tracker/src/components/sessions/ForkSessionButton.tsx` — toolbar button.
- Create: `tracker/src/components/sessions/__tests__/ForkSessionButton.test.tsx` — component test.
- Modify: `tracker/src/components/sessions/AssistantSessionTabContent.tsx` — place the button in both branches.
- Modify: `tracker/locales/en/tracker.json` (top-level `"sessions"` block ~line 2448).
- Modify: `tracker/locales/pt-BR/tracker.json` (top-level `"sessions"` block ~line 2448).

---

## Task 1: `ForkSession` domain module

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/fork_session.ex`
- Test: `elixir/test/symphony_elixir/assistant/fork_session_test.exs`

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/assistant/fork_session_test.exs`:

```elixir
defmodule SymphonyElixir.Assistant.ForkSessionTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{ForkSession, History, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_repo()

    tmp_dir = Path.join(System.tmp_dir!(), "symphony-fork-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp_dir)
    File.mkdir_p!(tmp_dir)

    workflow_file = Path.join(tmp_dir, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: tmp_dir)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(tmp_dir)
    end)

    {:ok, tmp_dir: tmp_dir}
  end

  test "forking an issue_session copies transcript into a fresh isolated thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, source} =
      History.create_issue_session_thread("macro-markets", "MAC-510", %{
        title: "Nova sessao",
        agent_kind: "claude",
        execution_mode: "build"
      })

    {:ok, source} = History.put_agent_thread_id(source, "claude", "claude-native-abc")
    {:ok, _} = History.append_message(source, %{role: "user", content: "context please"})
    {:ok, _} = History.append_message(source, %{role: "assistant", content: "got it"})

    assert {:ok, %Thread{} = fork} = ForkSession.fork(source)

    assert fork.id != source.id
    assert fork.scope == "issue_session"
    assert fork.issue_identifier == "MAC-510"
    assert fork.agent_kind == "claude"
    assert fork.title == "Nova sessao (fork)"
    assert fork.workspace_path != source.workspace_path
    assert fork.metadata["forked_from_thread_id"] == source.id
    assert fork.metadata["workspace_kind"] == "isolated"

    # Clean fork: no native agent brain carried over.
    assert fork.agent_thread_ids == %{}
    assert fork.codex_thread_id == nil

    copied = History.list_messages_for_thread(fork.id)
    assert Enum.map(copied, & &1.role) == ["user", "assistant"]
    assert Enum.map(copied, & &1.content) == ["context please", "got it"]
  end

  test "forking a project_session creates a standalone workspace thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
    {:ok, source} = History.create_project_session_thread("macro-markets", %{title: "Explore"})
    {:ok, _} = History.append_message(source, %{role: "user", content: "hello"})

    assert {:ok, %Thread{} = fork} = ForkSession.fork(source)

    assert fork.id != source.id
    assert fork.scope == "project_session"
    assert fork.title == "Explore (fork)"
    assert fork.workspace_path != source.workspace_path
    assert fork.metadata["forked_from_thread_id"] == source.id
    assert Enum.map(History.list_messages_for_thread(fork.id), & &1.content) == ["hello"]
  end

  test "forking an unsupported scope is rejected" do
    {:ok, source} = History.create_freeform_thread(%{title: "Freeform", workspace_path: System.tmp_dir!()})
    assert {:error, :unsupported_scope} = ForkSession.fork(source)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "assistant_messages",
          "assistant_threads",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_comments",
          "local_tracker_issue_labels",
          "local_tracker_issues",
          "local_tracker_labels",
          "local_tracker_workflow_statuses",
          "local_tracker_project_setups",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/fork_session_test.exs`
Expected: FAIL — `(UndefinedFunctionError) function SymphonyElixir.Assistant.ForkSession.fork/1 is undefined (module SymphonyElixir.Assistant.ForkSession is not available)`.

- [ ] **Step 3: Write minimal implementation**

Create `elixir/lib/symphony_elixir/assistant/fork_session.ex`:

```elixir
defmodule SymphonyElixir.Assistant.ForkSession do
  @moduledoc """
  Forks an assistant session into a new, independent parallel session.

  A fork creates a brand-new thread that carries over the source conversation
  transcript (so the new agent starts with the same context) but gets its own
  fresh isolated working tree and a fresh agent brain: native agent thread ids
  (`agent_thread_ids`/`codex_thread_id`) and goal state are intentionally NOT
  copied, so the source and the fork can run in parallel without colliding.

  Supported source scopes:

    * `"issue_session"` -> new isolated sibling working tree (`<id>__pN`)
    * `"project_session"` -> new standalone workspace (`__ws_fork-...`)
  """

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Workspace.Standalone

  @forkable_scopes ~w(issue_session project_session)

  @spec fork(Thread.t()) :: {:ok, Thread.t()} | {:error, term()}
  def fork(%Thread{scope: scope} = source) when scope in @forkable_scopes do
    with {:ok, target} <- create_target(source),
         {:ok, target} <- copy_history(source, target) do
      {:ok, target}
    end
  end

  def fork(%Thread{}), do: {:error, :unsupported_scope}

  defp create_target(%Thread{scope: "issue_session"} = source) do
    History.create_issue_session_thread(source.project_slug, source.issue_identifier, %{
      title: fork_title(source),
      agent_kind: source.agent_kind,
      execution_mode: execution_mode(source),
      isolated_workspace: true,
      metadata: %{"forked_from_thread_id" => source.id}
    })
  end

  defp create_target(%Thread{scope: "project_session"} = source) do
    name = "fork-#{source.id}-#{System.unique_integer([:positive])}"

    with {:ok, path} <- Standalone.create(source.project_slug, name) do
      History.create_workspace_session_thread(source.project_slug, path, %{
        title: fork_title(source),
        agent_kind: source.agent_kind,
        metadata: %{"forked_from_thread_id" => source.id}
      })
    end
  end

  defp copy_history(%Thread{} = source, %Thread{} = target) do
    messages = History.list_messages_for_thread(source.id)
    History.copy_messages_to_empty_thread(target, messages)
  end

  defp fork_title(%Thread{title: title}) when is_binary(title) and title != "",
    do: "#{title} (fork)"

  defp fork_title(%Thread{}), do: "Session fork"

  defp execution_mode(%Thread{metadata: %{"execution_mode" => mode}}) when is_binary(mode), do: mode
  defp execution_mode(%Thread{}), do: nil
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/fork_session_test.exs`
Expected: PASS (3 tests, 0 failures).

- [ ] **Step 5: Verify @spec compliance**

Run: `cd elixir && mix specs.check`
Expected: no missing-spec errors for `fork_session.ex` (the single public `fork/1` already has an `@spec`).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/fork_session.ex elixir/test/symphony_elixir/assistant/fork_session_test.exs
git commit -m "feat: add ForkSession domain module for parallel session forks"
```

---

## Task 2: Fork HTTP endpoint

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex:110`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`

- [ ] **Step 1: Write the failing tests**

Append these tests to `assistant_thread_controller_test.exs` (before the private `defp authorize do` at line 115):

```elixir
  test "POST fork clones an issue_session into a new thread with copied history" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    {:ok, source} =
      History.create_issue_session_thread("macro-markets", "MAC-510", %{
        title: "Nova sessao",
        agent_kind: "claude",
        execution_mode: "build"
      })

    {:ok, _} = History.append_message(source, %{role: "user", content: "carry this over"})

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads/#{source.id}/fork")

    assert %{"data" => %{"id" => fork_id, "scope" => "issue_session", "issue_identifier" => "MAC-510"}} =
             json_response(conn, 201)

    assert fork_id != source.id
    assert Enum.map(History.list_messages_for_thread(fork_id), & &1.content) == ["carry this over"]
  end

  test "POST fork returns 404 for a missing thread" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads/999999/fork")

    assert %{"error" => %{"code" => "thread_not_found"}} = json_response(conn, 404)
  end

  test "POST fork returns 422 for a non-forkable scope" do
    {:ok, source} = History.create_freeform_thread(%{title: "Freeform", workspace_path: System.tmp_dir!()})

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads/#{source.id}/fork")

    assert %{"error" => %{"message" => _}} = json_response(conn, 422)
  end
```

Note: this test file's `setup` does not set a tmp workspace root, so the isolated-tree materialization uses the process-level workspace root. That is consistent with how the existing `issue_session` create is exercised in this suite. If materialization fails in CI due to root config, move these three tests to a `describe "fork"` block that reuses the tmp-root setup from `fork_session_test.exs` (copy the `tmp_dir`/`write_workflow_file!` lines into a scoped `setup`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
Expected: FAIL — the POST to `/fork` returns 404 from the router (no matching route), so the 201/422 assertions fail with an unexpected status.

- [ ] **Step 3: Add the route**

In `elixir/lib/symphony_elixir_web/router.ex`, add the fork route directly under the archive route (line 110):

```elixir
    post("/assistant/threads/:thread_id/archive", AssistantThreadController, :archive)
    post("/assistant/threads/:thread_id/fork", AssistantThreadController, :fork)
```

- [ ] **Step 4: Add the controller action**

In `assistant_thread_controller.ex`, extend the alias line 7 to include `ForkSession`:

```elixir
  alias SymphonyElixir.Assistant.{CodexSession, ForkSession, History}
```

Then add the `fork/2` action immediately after the `archive/2` clauses (after line 116, before the private `parse_thread_id/1`):

```elixir
  @spec fork(Conn.t(), map()) :: Conn.t()
  def fork(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, source} <- History.get_thread(id),
         {:ok, thread} <- ForkSession.fork(source) do
      conn
      |> put_status(:created)
      |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :unsupported_scope} ->
        TrackerErrors.validation(conn, "This session type cannot be forked")

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def fork(conn, _params) do
    TrackerErrors.validation_msg(conn, "thread id is required")
  end
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
Expected: PASS (all tests, including the 3 new fork tests).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
git commit -m "feat: add POST /assistant/threads/:id/fork endpoint"
```

---

## Task 3: Frontend fork service

**Files:**
- Modify: `tracker/src/services/assistantThreads.ts`
- Test: `tracker/src/services/__tests__/assistantThreads.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `assistantThreads.test.ts`:

```typescript
describe("forkAssistantThread", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockReset();
  });

  it("posts to the fork endpoint and normalizes the new thread", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: 8001,
          scope: "issue_session",
          project_slug: "macro-markets",
          issue_identifier: "510",
          agent_kind: "claude",
          title: "Nova sessao (fork)",
          status: "active",
          updated_at: "2026-07-08T00:00:00Z",
        },
      },
    });

    const thread = await forkAssistantThread(7999);

    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/assistant/threads/7999/fork");
    expect(thread).toMatchObject({ id: 8001, scope: "issue_session", agentKind: "claude" });
  });

  it("rejects invalid thread ids", async () => {
    await expect(forkAssistantThread(0)).rejects.toThrow(/threadId/);
  });
});
```

Update the top import in the same file to include the new function:

```typescript
import {
  archiveAssistantThread,
  createProjectSessionThread,
  forkAssistantThread,
  normalizeAssistantThread,
} from "@/services/assistantThreads";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/assistantThreads.test.ts`
Expected: FAIL — `forkAssistantThread` is not exported / is not a function.

- [ ] **Step 3: Write minimal implementation**

Append to `tracker/src/services/assistantThreads.ts` (after `archiveAssistantThread`):

```typescript
export async function forkAssistantThread(threadId: number): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");

  const response = await http.post(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/fork`),
  );
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/assistantThreads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/assistantThreads.ts tracker/src/services/__tests__/assistantThreads.test.ts
git commit -m "feat: add forkAssistantThread service call"
```

---

## Task 4: Fork hook + button component

**Files:**
- Create: `tracker/src/hooks/useForkSession.ts`
- Create: `tracker/src/components/sessions/ForkSessionButton.tsx`
- Test: `tracker/src/components/sessions/__tests__/ForkSessionButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/sessions/__tests__/ForkSessionButton.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForkSessionButton } from "@/components/sessions/ForkSessionButton";
import { forkAssistantThread } from "@/services/assistantThreads";

const navigateMock = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/services/assistantThreads", () => ({
  forkAssistantThread: vi.fn(),
}));

describe("ForkSessionButton", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(forkAssistantThread).mockReset();
  });

  it("forks the thread and navigates to the new session", async () => {
    vi.mocked(forkAssistantThread).mockResolvedValue({
      id: 8001,
      scope: "issue_session",
      agentKind: "claude",
      projectSlug: "macro-markets",
      projectName: null,
      issueIdentifier: "510",
      title: "Nova sessao (fork)",
      status: "active",
      preview: null,
      updatedAt: "2026-07-08T00:00:00Z",
    });

    render(<ForkSessionButton projectSlug="macro-markets" threadId={7999} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(forkAssistantThread).toHaveBeenCalledWith(7999);
      expect(navigateMock).toHaveBeenCalledWith("/projects/macro-markets/workspaces/8001");
    });
  });

  it("does not navigate when the fork fails", async () => {
    vi.mocked(forkAssistantThread).mockRejectedValue(new Error("boom"));

    render(<ForkSessionButton projectSlug="macro-markets" threadId={7999} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(forkAssistantThread).toHaveBeenCalledWith(7999));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/sessions/__tests__/ForkSessionButton.test.tsx`
Expected: FAIL — cannot resolve `@/components/sessions/ForkSessionButton`.

- [ ] **Step 3: Write the hook**

Create `tracker/src/hooks/useForkSession.ts`:

```typescript
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { i18n } from "@/i18n";
import { forkAssistantThread } from "@/services/assistantThreads";
import type { AssistantThread } from "@/types/assistant-thread";

export interface UseForkSessionResult {
  forking: boolean;
  forkSession: (threadId: number) => Promise<AssistantThread | null>;
}

/**
 * Forks an assistant session into a new parallel session. Returns the new
 * thread on success so callers can navigate to it, or null on failure (a toast
 * is shown).
 */
export function useForkSession(): UseForkSessionResult {
  const [forking, setForking] = useState(false);

  const forkSession = useCallback(
    async (threadId: number) => {
      if (forking) return null;

      setForking(true);
      try {
        return await forkAssistantThread(threadId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : i18n.t("sessions.forkError"));
        return null;
      } finally {
        setForking(false);
      }
    },
    [forking],
  );

  return { forking, forkSession };
}
```

- [ ] **Step 4: Write the button component**

Create `tracker/src/components/sessions/ForkSessionButton.tsx`:

```tsx
import { GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useForkSession } from "@/hooks/useForkSession";
import { projectSessionPath } from "@/lib/workspaceRoutes";

interface ForkSessionButtonProps {
  projectSlug: string;
  threadId: number;
}

/**
 * Forks the current session into a new parallel session and opens it. The new
 * thread opens as a new workspace tab (the original tab stays open), so the two
 * sessions can run side by side.
 */
export function ForkSessionButton({ projectSlug, threadId }: ForkSessionButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { forking, forkSession } = useForkSession();

  async function handleFork() {
    const thread = await forkSession(threadId);
    if (thread) {
      navigate(projectSessionPath(projectSlug, thread.id));
    }
  }

  return (
    <button
      type="button"
      aria-label={t("sessions.fork")}
      title={forking ? t("sessions.forking") : t("sessions.fork")}
      disabled={forking}
      onClick={() => void handleFork()}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GitFork className="h-4 w-4" />
    </button>
  );
}
```

- [ ] **Step 5: Add the i18n keys used by the hook/button**

In `tracker/locales/en/tracker.json`, inside the top-level `"sessions"` block (starts ~line 2448), add after `"createFailed"` (line 2456):

```json
    "createFailed": "Could not create a project session.",
    "fork": "Fork session",
    "forking": "Forking…",
    "forkError": "Could not fork this session.",
```

In `tracker/locales/pt-BR/tracker.json`, inside the top-level `"sessions"` block, add after its `"createFailed"` (line 2456):

```json
    "createFailed": "Não foi possível criar a sessão do projeto.",
    "fork": "Fork da sessão",
    "forking": "Forkando…",
    "forkError": "Não foi possível forkar esta sessão.",
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/sessions/__tests__/ForkSessionButton.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add tracker/src/hooks/useForkSession.ts tracker/src/components/sessions/ForkSessionButton.tsx tracker/src/components/sessions/__tests__/ForkSessionButton.test.tsx tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat: add ForkSessionButton and useForkSession hook"
```

---

## Task 5: Wire the button into the open-session view

**Files:**
- Modify: `tracker/src/components/sessions/AssistantSessionTabContent.tsx`

- [ ] **Step 1: Import the button**

Add to the imports at the top of `AssistantSessionTabContent.tsx` (after the `IssueSessionSplitLayout` import, line 6):

```tsx
import { ForkSessionButton } from "@/components/sessions/ForkSessionButton";
```

- [ ] **Step 2: Add the button to the issue-session toolbar**

In the `issueIdentifier ?` branch, add a `toolbarTrailing` prop to `IssueSessionSplitLayout` (it already renders `toolbarLeading`). Insert it right after the `toolbarLeading={...}` prop block (after line 68):

```tsx
          toolbarTrailing={<ForkSessionButton projectSlug={projectSlug} threadId={threadId} />}
```

- [ ] **Step 3: Add a slim toolbar for the project-session branch**

Replace the non-issue `else` branch (lines 81-93) with a version that carries the same button in a slim header row:

```tsx
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-8 shrink-0 items-center justify-end border-b border-border/50 pb-1.5">
            <ForkSessionButton projectSlug={projectSlug} threadId={threadId} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden pt-1.5">
            <ProjectAssistantPanel
              projectSlug={projectSlug}
              threadId={threadId}
              view={view}
              mode="page"
              hideHeader
              diffRequestId={diffRequestId}
              contentMaxWidth="wide"
            />
          </div>
        </div>
      )}
```

- [ ] **Step 4: Lint the changed files**

Run: `cd tracker && npx eslint src/components/sessions/AssistantSessionTabContent.tsx src/components/sessions/ForkSessionButton.tsx src/hooks/useForkSession.ts`
Expected: no errors.

- [ ] **Step 5: Type-check**

Run: `cd tracker && npx tsc -p tsconfig.app.json --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/sessions/AssistantSessionTabContent.tsx
git commit -m "feat: surface fork action in the open session toolbar"
```

---

## Task 6: Full validation + docs

**Files:**
- Modify: `elixir/README.md` (endpoint documentation)

- [ ] **Step 1: Document the endpoint**

In `elixir/README.md`, find the assistant threads endpoint list (search for `POST /api/tracker/v1/assistant/threads`) and add a row/line for the fork endpoint mirroring the existing style, e.g.:

```markdown
- `POST /api/tracker/v1/assistant/threads/:id/fork` — fork an `issue_session` or `project_session` into a new parallel session: copies the transcript into a fresh isolated working tree with a fresh agent brain (native agent thread ids are not copied).
```

- [ ] **Step 2: Run the full backend gate**

Run: `cd elixir && make all`
Expected: format check, credo, tests, and dialyzer all pass. (If `make all` is heavy, at minimum run `mix format --check-formatted`, `mix credo`, `mix specs.check`, and `mix test test/symphony_elixir/assistant/fork_session_test.exs test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`.)

- [ ] **Step 3: Run the full frontend gate**

Run: `cd tracker && npx vitest run src/services/__tests__/assistantThreads.test.ts src/components/sessions/__tests__/ForkSessionButton.test.tsx && npx eslint src && npx tsc -p tsconfig.app.json --noEmit`
Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 4: Manual smoke test (optional, requires the dev stack)**

1. Start the stack (`cd elixir && make serve`, then the tracker dev server).
2. Open `http://localhost:4000/tracker/projects/macro-markets/workspaces/7999`.
3. Click the fork (branch) icon in the session toolbar.
4. Confirm a new tab opens with title `Nova sessao (fork)`, the transcript is present, and the original tab is still open.
5. Send a message in the fork and confirm it runs independently of the original.

- [ ] **Step 5: Commit docs**

```bash
git add elixir/README.md
git commit -m "docs: document the assistant thread fork endpoint"
```

---

## Self-Review

**1. Spec coverage**
- Clean fork semantics (chat copied, isolated tree, fresh agent brain) → Task 1 `ForkSession` (asserts `agent_thread_ids == %{}`, `codex_thread_id == nil`, isolated `workspace_path`).
- Both issue and project sessions supported → Task 1 (both `create_target/1` clauses + two passing tests).
- HTTP surface → Task 2 (route + `fork/2`, 201/404/422 tests).
- Frontend call → Task 3 (`forkAssistantThread` + test).
- UI action + parallel-friendly navigation → Tasks 4-5 (button, hook, placement in both branches, navigation test).
- i18n → Task 4 Step 5 (en + pt-BR).
- Provenance (`forked_from_thread_id`) → Task 1 (asserted).
- Docs policy → Task 6.

**2. Placeholder scan** — no TBD/TODO; every code step contains full code and exact commands with expected output.

**3. Type consistency** — `ForkSession.fork/1` returns `{:ok, Thread.t()} | {:error, term()}`; controller matches `{:error, :not_found | :unsupported_scope | :invalid_thread_id | %Ecto.Changeset{}}`. Frontend `forkAssistantThread(threadId: number): Promise<AssistantThread>`; `useForkSession.forkSession` returns `AssistantThread | null`; `ForkSessionButton` navigates with `projectSessionPath(projectSlug, thread.id)` which yields `/projects/:slug/workspaces/:id` (matches the component test expectation). i18n keys `sessions.fork` / `sessions.forking` / `sessions.forkError` are defined in Task 4 and consumed in the hook/button.
