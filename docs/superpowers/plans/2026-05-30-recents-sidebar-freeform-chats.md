# Recents Sidebar + Freeform Assistant Chats Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. This repo's real tools: backend tests `cd elixir && mix test <file>:<line>`, full gate `cd elixir && make all`, spec check `cd elixir && mix specs.check`; frontend tests `cd tracker && npx vitest run <path>`, lint `cd tracker && npm run lint`.

**Goal:** Add a sidebar **Recents** list of recent assistant chat threads and Codex/issue runs (each tagged with project + status), and upgrade the assistant to support project-less **freeform chats** and multiple threads.

**Architecture:** Extend the persisted `assistant_threads` model with a `scope` (`project`/`freeform`/`issue`), nullable `project_slug`, `issue_identifier`, and `title`; add thread-id-keyed channel + REST APIs and a global `/assistant` area for freeform chats; build a `Recents` aggregator (chat threads + branch/live issues) exposed at `GET /recents` and rendered in `ProjectSidebar`.

**Tech Stack:** Elixir/Phoenix + Ecto (SQLite via `SymphonyElixir.Repo`), React + TypeScript + Vite + Vitest, Tailwind, `react-router-dom`, `phoenix` JS, `@assistant-ui/react`.

Spec: `docs/superpowers/specs/2026-05-30-recents-sidebar-sessions-design.md`.

---

## File Structure

**Backend — create:**
- `elixir/priv/repo/migrations/20260531120000_extend_assistant_threads_scope.exs` — scope/nullable-project migration.
- `elixir/lib/symphony_elixir/recents.ex` — unified recents aggregator.
- `elixir/lib/symphony_elixir_web/controllers/tracker/recents_controller.ex` — `GET /recents`.
- `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex` — `GET/POST /assistant/threads`.

**Backend — modify:**
- `elixir/lib/symphony_elixir/assistant/thread.ex` — scope + conditional validations.
- `elixir/lib/symphony_elixir/assistant/history.ex` — `get_thread/1`, `list_threads/1`, `create_thread/1` (freeform), `latest_message/1`, `list_messages_for_thread/1`.
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` — freeform workspace + `send_message_to_thread/4`.
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — `assistant:thread:<id>` topic.
- `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex` — `recent_item/1`, `assistant_thread/1`.
- `elixir/lib/symphony_elixir_web/router.ex` — new routes.

**Frontend — create:**
- `tracker/src/types/recents.ts`, `tracker/src/types/assistant-thread.ts`
- `tracker/src/services/recents.ts`, `tracker/src/services/assistantThreads.ts`
- `tracker/src/hooks/useRecents.ts`
- `tracker/src/components/layout/RecentStatusDot.tsx`
- `tracker/src/components/layout/RecentsSection.tsx`
- `tracker/src/pages/AssistantPage.tsx`

**Frontend — modify:**
- `tracker/src/services/assistant.ts`, `tracker/src/services/phoenix/assistantChannel.ts`
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- `tracker/src/components/layout/ProjectSidebar.tsx`
- `tracker/src/App.tsx`

**Tests — create/extend:** as listed per task.

---

## WS-A — Thread model v2

### Task A1: Migration — scope, nullable project, issue_identifier, title

**Files:**
- Create: `elixir/priv/repo/migrations/20260531120000_extend_assistant_threads_scope.exs`

- [ ] **Step 1: Write the migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.ExtendAssistantThreadsScope do
  use Ecto.Migration

  def up do
    alter table(:assistant_threads) do
      add(:scope, :string, null: false, default: "project")
      add(:issue_identifier, :string)
      add(:title, :string)
    end

    # SQLite-friendly: drop and recreate the partial unique index scoped to project chats.
    drop(index(:assistant_threads, [:project_slug], name: :assistant_threads_active_project_slug_index))

    alter table(:assistant_threads) do
      modify(:project_slug, :string, null: true)
    end

    create(
      unique_index(:assistant_threads, [:project_slug],
        where: "status = 'active' AND scope = 'project'",
        name: :assistant_threads_active_project_index
      )
    )

    create(
      unique_index(:assistant_threads, [:project_slug, :issue_identifier],
        where: "status = 'active' AND scope = 'issue'",
        name: :assistant_threads_active_issue_index
      )
    )
  end

  def down do
    drop(index(:assistant_threads, [:project_slug], name: :assistant_threads_active_issue_index))
    drop(index(:assistant_threads, [:project_slug], name: :assistant_threads_active_project_index))

    alter table(:assistant_threads) do
      modify(:project_slug, :string, null: false)
      remove(:title)
      remove(:issue_identifier)
      remove(:scope)
    end

    create(
      unique_index(:assistant_threads, [:project_slug],
        where: "status = 'active'",
        name: :assistant_threads_active_project_slug_index
      )
    )
  end
end
```

- [ ] **Step 2: Run the migration**

Run: `cd elixir && mix ecto.migrate`
Expected: `* running up 20260531120000 ... :ok` and migration completes without error. (If SQLite rejects `modify` on the column, fall back to keeping `project_slug` not-null but inserting freeform rows with an empty-string sentinel is NOT acceptable — instead use a table rebuild; see note below.)

> **SQLite note:** `SymphonyElixir.Repo` uses SQLite (`ecto_sqlite3`), which supports `ALTER TABLE ADD COLUMN` and (in recent versions) limited `ALTER`. `modify` of nullability may require a table rebuild. If `mix ecto.migrate` errors on the `modify`, replace the `modify` line with a documented rebuild (create new table, copy rows, drop, rename) in the same migration. Verify which path is needed by running Step 2 first.

- [ ] **Step 3: Verify schema**

Run: `cd elixir && mix run -e "IO.inspect(SymphonyElixir.Repo.query!(\"PRAGMA table_info(assistant_threads)\").rows)"`
Expected: rows include `scope`, `issue_identifier`, `title`; `project_slug` notnull flag is `0`.

- [ ] **Step 4: Commit**

```bash
git add elixir/priv/repo/migrations/20260531120000_extend_assistant_threads_scope.exs
git commit -m "feat(assistant): add scope/freeform columns to assistant_threads"
```

### Task A2: `Thread` schema + scope-aware changeset

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/thread.ex`
- Test: `elixir/test/symphony_elixir/assistant/thread_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.ThreadTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.Thread

  test "project scope requires project_slug" do
    changeset = Thread.changeset(%Thread{}, %{scope: "project", workspace_path: "/tmp/a", status: "active"})
    refute changeset.valid?
    assert %{project_slug: _} = errors_on(changeset)
  end

  test "freeform scope rejects a project_slug" do
    changeset =
      Thread.changeset(%Thread{}, %{scope: "freeform", project_slug: "p", workspace_path: "/tmp/a", status: "active"})

    refute changeset.valid?
    assert %{project_slug: _} = errors_on(changeset)
  end

  test "freeform scope is valid without a project" do
    changeset =
      Thread.changeset(%Thread{}, %{scope: "freeform", title: "Brainstorm", workspace_path: "/tmp/a", status: "active"})

    assert changeset.valid?
  end

  test "rejects unknown scope" do
    changeset = Thread.changeset(%Thread{}, %{scope: "weird", workspace_path: "/tmp/a", status: "active"})
    refute changeset.valid?
    assert %{scope: _} = errors_on(changeset)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd elixir && mix test test/symphony_elixir/assistant/thread_test.exs`
Expected: failures (current changeset always requires `project_slug`, ignores `scope`).

- [ ] **Step 3: Implement the schema + changeset**

Replace `thread.ex` body:

```elixir
defmodule SymphonyElixir.Assistant.Thread do
  @moduledoc "Persistent Codex-backed assistant thread (project, freeform, or issue scoped)."

  use Ecto.Schema
  import Ecto.Changeset

  alias SymphonyElixir.Assistant.Message

  @type t :: %__MODULE__{}

  @scopes ["project", "freeform", "issue"]

  schema "assistant_threads" do
    field(:scope, :string, default: "project")
    field(:project_slug, :string)
    field(:issue_identifier, :string)
    field(:title, :string)
    field(:codex_thread_id, :string)
    field(:workspace_path, :string)
    field(:status, :string, default: "active")
    field(:metadata, :map, default: %{})

    has_many(:messages, Message, foreign_key: :thread_id)

    timestamps(type: :utc_datetime_usec)
  end

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(thread, attrs) when is_map(attrs) do
    thread
    |> cast(attrs, [:scope, :project_slug, :issue_identifier, :title, :codex_thread_id, :workspace_path, :status, :metadata])
    |> validate_required([:workspace_path, :status])
    |> validate_inclusion(:scope, @scopes)
    |> validate_inclusion(:status, ["active", "closed", "error"])
    |> normalize_project_slug()
    |> validate_scope_fields()
    |> unique_constraint(:project_slug, name: :assistant_threads_active_project_index)
  end

  defp validate_scope_fields(changeset) do
    case get_field(changeset, :scope) do
      "project" -> validate_required(changeset, [:project_slug])
      "issue" -> validate_required(changeset, [:project_slug, :issue_identifier])
      "freeform" -> reject_project(changeset)
      _ -> changeset
    end
  end

  defp reject_project(changeset) do
    if get_field(changeset, :project_slug) in [nil, ""] do
      put_change(changeset, :project_slug, nil)
    else
      add_error(changeset, :project_slug, "must be empty for freeform chats")
    end
  end

  defp normalize_project_slug(changeset) do
    case get_change(changeset, :project_slug) do
      slug when is_binary(slug) -> put_change(changeset, :project_slug, String.trim(slug))
      _ -> changeset
    end
  end
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/thread_test.exs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/thread.ex elixir/test/symphony_elixir/assistant/thread_test.exs
git commit -m "feat(assistant): scope-aware Thread changeset"
```

### Task A3: `History` — thread listing, freeform create, previews

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/history_test.exs` (extend existing if present; else create)

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.Assistant.HistoryTest do
  use SymphonyElixir.DataCase, async: true

  alias SymphonyElixir.Assistant.History

  test "create_freeform_thread/1 persists a project-less thread" do
    assert {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: "/tmp/f"})
    assert thread.scope == "freeform"
    assert thread.project_slug == nil
  end

  test "list_threads/1 returns freeform and project threads newest first" do
    {:ok, t1} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    {:ok, t2} = History.create_freeform_thread(%{title: "B", workspace_path: "/tmp/b"})

    ids = History.list_threads(scope: "freeform", limit: 10) |> Enum.map(& &1.id)
    assert ids == [t2.id, t1.id]
  end

  test "latest_message/1 returns the most recent message map" do
    {:ok, thread} = History.create_freeform_thread(%{title: "A", workspace_path: "/tmp/a"})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "hello"})
    {:ok, _} = History.append_message(thread, %{role: "assistant", content: "hi there"})

    assert %{content: "hi there"} = History.latest_message(thread.id)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs`
Expected: failures (`create_freeform_thread/1`, `list_threads/1`, `latest_message/1` undefined).

- [ ] **Step 3: Implement the new `History` functions**

Add to `history.ex` (keep existing functions; add specs per `AGENTS.md`):

```elixir
  @spec create_freeform_thread(attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def create_freeform_thread(attrs) when is_map(attrs) do
    attrs
    |> Map.put(:scope, "freeform")
    |> Map.delete(:project_slug)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
  end

  @spec get_thread(integer()) :: {:ok, Thread.t()} | {:error, :not_found}
  def get_thread(id) when is_integer(id) do
    case Repo.get(Thread, id) do
      %Thread{} = thread -> {:ok, thread}
      nil -> {:error, :not_found}
    end
  end

  @spec list_threads(keyword()) :: [Thread.t()]
  def list_threads(opts \\ []) when is_list(opts) do
    Thread
    |> filter_scope(Keyword.get(opts, :scope))
    |> filter_project(Keyword.get(opts, :project_slug))
    |> order_by([t], desc: t.updated_at, desc: t.id)
    |> limit(^Keyword.get(opts, :limit, 50))
    |> Repo.all()
  end

  @spec latest_message(integer()) :: map() | nil
  def latest_message(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], desc: m.sequence)
    |> limit(1)
    |> Repo.one()
    |> case do
      nil -> nil
      %Message{} = message -> message_payload(message)
    end
  end

  @spec list_messages_for_thread(integer()) :: [map()]
  def list_messages_for_thread(thread_id) when is_integer(thread_id), do: messages_for_thread(thread_id)

  defp filter_scope(query, nil), do: query
  defp filter_scope(query, scope) when is_binary(scope), do: where(query, [t], t.scope == ^scope)

  defp filter_project(query, nil), do: query
  defp filter_project(query, slug) when is_binary(slug), do: where(query, [t], t.project_slug == ^slug)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/history_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex elixir/test/symphony_elixir/assistant/history_test.exs
git commit -m "feat(assistant): thread listing, freeform create, latest_message"
```

---

## WS-B — Channel & APIs

### Task B1: `CodexSession.send_message_to_thread/4` (freeform, no tools)

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`
- Test: `elixir/test/symphony_elixir/assistant/codex_session_test.exs` (extend)

- [ ] **Step 1: Write failing test**

```elixir
  test "send_message_to_thread/4 runs a freeform turn without tracker tools" do
    {:ok, thread} = SymphonyElixir.Assistant.History.create_freeform_thread(%{title: "F", workspace_path: tmp_dir()})

    runner = fn _workspace, _prompt, _issue, opts ->
      send(self(), {:opts, opts})
      {:ok, %{assistant_message: "ok", tool_calls: [], codex_thread_id: "ct-1", turn_id: "t-1"}}
    end

    assert {:ok, result} =
             SymphonyElixir.Assistant.CodexSession.send_message_to_thread(thread, "hi", %{}, runner: runner)

    assert result.assistant_message == "ok"
    assert_received {:opts, opts}
    refute Keyword.has_key?(opts, :dynamic_tools)
    refute Keyword.has_key?(opts, :tool_executor)
  end
```

(Add a `tmp_dir/0` helper that returns a unique `System.tmp_dir!()` path; mirror existing test setup in the file.)

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs`
Expected: failure (`send_message_to_thread/4` undefined).

- [ ] **Step 3: Implement freeform turn**

Add to `codex_session.ex`:

```elixir
  @spec send_message_to_thread(SymphonyElixir.Assistant.Thread.t(), String.t(), map(), keyword()) ::
          {:ok, turn_result()} | {:error, term()}
  def send_message_to_thread(%{scope: "freeform", id: thread_id} = thread, message, context, opts \\ [])
      when is_binary(message) and is_map(context) and is_list(opts) do
    with {:ok, trimmed} <- normalize_message(message),
         workspace <- freeform_workspace(thread_id, opts),
         :ok <- File.mkdir_p(workspace),
         {:ok, history} <- {:ok, History.list_messages_for_thread(thread_id)},
         {:ok, user_message} <- History.append_message(thread, %{role: "user", content: trimmed, metadata: stringify_map(context)}),
         prompt <- build_freeform_prompt(trimmed, context, history),
         :ok <- maybe_call(opts, :on_message_created, History.message_payload(user_message)),
         {:ok, runner_result} <- run_freeform_turn(workspace, prompt, opts),
         {:ok, updated_thread} <- maybe_update_codex_thread(thread, runner_result),
         {:ok, assistant_message} <- persist_assistant_message(updated_thread, runner_result) do
      {:ok,
       %{
         assistant_message: assistant_message.content,
         tool_calls: assistant_message.tool_calls,
         codex_thread_id: Map.get(runner_result, :codex_thread_id),
         turn_id: Map.get(runner_result, :turn_id),
         user_message: History.message_payload(user_message),
         assistant_chat_message: History.message_payload(assistant_message)
       }}
    end
  end

  defp run_freeform_turn(workspace, prompt, opts) do
    runner = Keyword.get(opts, :runner, &default_runner/4)
    runner_opts = Keyword.drop(opts, [:dynamic_tools, :tool_executor])
    runner.(workspace, prompt, freeform_issue(), runner_opts) |> normalize_runner_result()
  end

  defp freeform_issue, do: %{id: "assistant:freeform", identifier: "freeform", title: "Freeform assistant chat"}

  defp freeform_workspace(thread_id, opts) do
    root = opts |> Keyword.get(:workspace_root, Config.workspace_root()) |> Path.expand()
    Path.join([root, "assistant", "freeform", to_string(thread_id)])
  end

  defp build_freeform_prompt(message, context, history) do
    """
    You are the Symphony freeform assistant. There is no project or repository context.
    Behave like a real conversational coding assistant. Answer naturally in the user's language.
    Do not call tracker tools; none are available in this chat.

    Recent conversation:
    #{format_history(history)}

    Context:
    #{inspect(context)}

    Current user message:
    #{message}
    """
    |> String.trim()
  end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir/assistant/codex_session_test.exs
git commit -m "feat(assistant): freeform Codex turn without tracker tools"
```

### Task B2: Assistant channel — `assistant:thread:<id>` topic

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs` (extend)

- [ ] **Step 1: Write failing tests**

```elixir
  test "join assistant:thread:<id> loads that thread's history", %{socket: socket} do
    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: System.tmp_dir!()})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "hello freeform"})

    {:ok, payload, _socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})
    assert [%{content: "hello freeform"}] = payload.messages
  end

  test "freeform send_message routes through send_message_to_thread", %{socket: socket} do
    Application.put_env(:symphony_elixir, :assistant_runner, fn _w, _p, _i, _o ->
      {:ok, %{assistant_message: "freeform reply", tool_calls: []}}
    end)

    {:ok, thread} = History.create_freeform_thread(%{title: "F", workspace_path: System.tmp_dir!()})
    {:ok, _payload, socket} = subscribe_and_join(socket, "assistant:thread:#{thread.id}", %{})

    ref = push(socket, "send_message", %{"message" => "hi"})
    assert_reply ref, :ok
    assert_push "assistant_completed", %{message: %{content: "freeform reply"}}
  after
    Application.delete_env(:symphony_elixir, :assistant_runner)
  end
```

(Use the existing channel test's socket setup; ensure `alias SymphonyElixir.Assistant.History`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: failure (`invalid_topic` for the thread topic).

- [ ] **Step 3: Implement the thread topic + routing**

In `assistant_channel.ex`, add a join clause **above** the catch-all and branch `handle_in` by socket scope:

```elixir
  def join("assistant:thread:" <> raw_id, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, id} <- parse_id(raw_id),
         {:ok, thread} <- History.get_thread(id) do
      messages = History.list_messages_for_thread(thread.id)
      payload = %{messages: Enum.map(messages, & &1)}
      socket = socket |> assign(:thread, thread) |> assign(:project_slug, thread.project_slug)
      send(self(), {:assistant_history_loaded, payload})
      {:ok, payload, socket}
    else
      false -> {:error, %{reason: "unauthorized"}}
      {:error, :not_found} -> {:error, %{reason: "thread not found"}}
      _ -> {:error, %{reason: "invalid_topic"}}
    end
  end
```

Note: `list_messages_for_thread/1` already returns public message maps; wrap them with `History.message_payload/1` only if they are `Message` structs. Since `messages_for_thread/1` returns maps via `public_message`, map them through `History.message_payload/1`-equivalent — confirm shape in Task A3 (they are `%Message{}` maps with `tool_calls` list). Use `Enum.map(messages, &History.message_payload/1)` for consistency with the project path; adjust `list_messages_for_thread/1` to return `%Message{}` structs (not pre-mapped) so the channel maps them once. Update the Task A3 helper accordingly:

```elixir
  def list_messages_for_thread(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], asc: m.sequence)
    |> Repo.all()
  end
```

Then in the channel: `payload = %{messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1)}`.

Branch `handle_in("send_message", ...)` by scope:

```elixir
    result =
      case socket.assigns[:thread] do
        %{scope: "freeform"} = thread -> CodexSession.send_message_to_thread(thread, trimmed, context, opts)
        _ -> CodexSession.send_message(project_slug, trimmed, context, opts)
      end
```

Add helper:

```elixir
  defp parse_id(raw) do
    case Integer.parse(raw) do
      {id, ""} -> {:ok, id}
      _ -> {:error, :invalid_id}
    end
  end
```

Guard the project path: when joining the thread topic for a freeform chat, `project_slug` is `nil`; attachments normalization (`Payload.normalize_attachments/2`) must tolerate a `nil` slug — pass `socket.assigns[:project_slug]` and skip image persistence when `nil` (freeform v1 has no attachment storage; treat attachments as empty). Add an early branch: if `socket.assigns[:thread]` is freeform, set `attachments = []`.

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS (both new tests + existing project tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/lib/symphony_elixir/assistant/history.ex elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat(assistant): thread-id channel topic with freeform routing"
```

### Task B3: Threads REST API + presenter + routes

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`

- [ ] **Step 1: Write failing controller test**

```elixir
defmodule SymphonyElixirWeb.Tracker.AssistantThreadControllerTest do
  use SymphonyElixirWeb.ConnCase, async: true

  alias SymphonyElixir.Assistant.History

  setup %{conn: conn} do
    token = System.get_env("SYMPHONY_LOCAL_API_TOKEN") || "test-token"
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  test "POST creates a freeform thread", %{conn: conn} do
    conn = post(conn, ~p"/api/tracker/v1/assistant/threads", %{scope: "freeform", title: "Ideas"})
    assert %{"data" => %{"scope" => "freeform", "title" => "Ideas", "project_slug" => nil, "id" => _}} = json_response(conn, 201)
  end

  test "GET lists freeform threads", %{conn: conn} do
    {:ok, _} = History.create_freeform_thread(%{title: "A", workspace_path: System.tmp_dir!()})
    conn = get(conn, ~p"/api/tracker/v1/assistant/threads?scope=freeform")
    assert %{"data" => [%{"scope" => "freeform"} | _]} = json_response(conn, 200)
  end
end
```

(Match the repo's existing ConnCase auth pattern; reuse how other tracker controller tests set the token — check an existing `*_controller_test.exs`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
Expected: failure (route + controller undefined).

- [ ] **Step 3: Implement presenter, controller, routes**

Presenter (`tracker_presenter.ex`), add (with `@spec`):

```elixir
  @spec assistant_thread(map()) :: map()
  def assistant_thread(thread) when is_map(thread) do
    %{
      id: thread.id,
      scope: thread.scope,
      project_slug: thread.project_slug,
      project_name: Map.get(thread, :project_name),
      issue_identifier: thread.issue_identifier,
      title: thread.title,
      status: thread.status,
      preview: Map.get(thread, :preview),
      updated_at: iso8601(thread.updated_at)
    }
  end
```

Controller:

```elixir
defmodule SymphonyElixirWeb.Tracker.AssistantThreadController do
  @moduledoc "Lists and creates assistant chat threads (project or freeform)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.{CodexSession, History}
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    opts =
      []
      |> put_opt(:scope, params["scope"])
      |> put_opt(:project_slug, params["project_slug"])
      |> Keyword.put(:limit, clamp_limit(params["limit"]))

    data = History.list_threads(opts) |> Enum.map(&with_preview/1) |> Enum.map(&TrackerPresenter.assistant_thread/1)
    json(conn, %{data: data})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case params["scope"] do
      "freeform" ->
        title = params["title"]
        {:ok, workspace} = {:ok, freeform_workspace_placeholder()}

        case History.create_freeform_thread(%{title: title, workspace_path: workspace}) do
          {:ok, thread} ->
            conn |> put_status(:created) |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})

          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: changeset_error(changeset)})
        end

      _ ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "only scope=freeform is supported"})
    end
  end

  defp freeform_workspace_placeholder, do: CodexSession.freeform_workspace_root()
  defp put_opt(opts, _key, nil), do: opts
  defp put_opt(opts, key, value), do: Keyword.put(opts, key, value)
  defp clamp_limit(nil), do: 50
  defp clamp_limit(value) when is_binary(value), do: value |> Integer.parse() |> elem_or(50) |> min(100) |> max(1)
  defp elem_or(:error, default), do: default
  defp elem_or({n, _}, _default), do: n
  defp with_preview(thread), do: Map.put(thread, :preview, preview_text(History.latest_message(thread.id)))
  defp preview_text(nil), do: nil
  defp preview_text(%{content: content}), do: content
  defp changeset_error(changeset), do: inspect(changeset.errors)
end
```

> The workspace path for a freeform thread is finalized at first turn (`CodexSession.freeform_workspace/2` uses the thread id). For the create endpoint we still need a non-null `workspace_path`. Add `CodexSession.freeform_workspace_root/0` returning `Path.join([Config.workspace_root() |> Path.expand(), "assistant", "freeform"])`, and have the first turn use `freeform_workspace(thread_id, opts)` (a subdir). This keeps `workspace_path` not-null at insert while the per-thread dir is created lazily.

Router (inside the `tracker_api` scope, near the other assistant routes):

```elixir
    get("/assistant/threads", AssistantThreadController, :index)
    post("/assistant/threads", AssistantThreadController, :create)
    get("/recents", RecentsController, :index)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/lib/symphony_elixir_web/router.ex elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
git commit -m "feat(assistant): threads list/create REST API"
```

---

## WS-D — Recents aggregator + endpoint (backend)

> WS-D backend is built before WS-C frontend so the contract is testable first.

### Task D1: `SymphonyElixir.Recents` aggregator

**Files:**
- Create: `elixir/lib/symphony_elixir/recents.ex`
- Test: `elixir/test/symphony_elixir/recents_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.RecentsTest do
  use SymphonyElixir.DataCase, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Recents

  test "includes freeform chat rows under nil project" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Ideas", workspace_path: System.tmp_dir!()})
    {:ok, _} = History.append_message(thread, %{role: "user", content: "what's up"})

    items = Recents.list(limit: 20, executions: [], issue_lister: fn _slug -> [] end, projects: [])
    assert Enum.any?(items, &(&1.kind == :chat and &1.scope == :freeform and &1.project_slug == nil))
  end

  test "codex rows derive from branch-name issues with live overlay" do
    issue = %{identifier: "ABC-12", title: "Fix bug", status: "In Progress", branch_name: "abc-12", updated_at: DateTime.utc_now()}
    exec = %{issue_identifier: "ABC-12", status: :live, last_event_at: DateTime.utc_now()}

    items =
      Recents.list(
        limit: 20,
        executions: [exec],
        issue_lister: fn "demo" -> [issue] end,
        projects: [%{slug: "demo", name: "Demo"}]
      )

    codex = Enum.find(items, &(&1.kind == :codex))
    assert codex.identifier == "ABC-12"
    assert codex.status_kind == :running
    assert codex.project_slug == "demo"
  end

  test "respects limit and orders by updated_at desc" do
    {:ok, t} = History.create_freeform_thread(%{title: "old", workspace_path: System.tmp_dir!()})
    _ = t

    items = Recents.list(limit: 1, executions: [], issue_lister: fn _ -> [] end, projects: [])
    assert length(items) <= 1
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/recents_test.exs`
Expected: failure (`Recents` undefined).

- [ ] **Step 3: Implement `Recents`**

```elixir
defmodule SymphonyElixir.Recents do
  @moduledoc "Builds a unified, time-ranked list of recent assistant chats and Codex/issue runs."

  alias SymphonyElixir.{AgentExecution, LocalTracker.Context}
  alias SymphonyElixir.Assistant.History

  @type kind :: :chat | :codex
  @type item :: map()

  @spec list(keyword()) :: [item()]
  def list(opts \\ []) when is_list(opts) do
    limit = Keyword.get(opts, :limit, 20)
    executions = Keyword.get_lazy(opts, :executions, &safe_executions/0)
    projects = Keyword.get_lazy(opts, :projects, &Context.list_projects/0)
    issue_lister = Keyword.get(opts, :issue_lister, &default_issue_lister/1)

    (chat_items(limit) ++ codex_items(projects, issue_lister, executions))
    |> Enum.sort_by(& &1.updated_at, {:desc, DateTime})
    |> Enum.take(limit)
  end

  defp chat_items(limit) do
    History.list_threads(limit: limit)
    |> Enum.map(fn thread ->
      preview = thread.id |> History.latest_message() |> preview_text()

      %{
        kind: :chat,
        scope: String.to_existing_atom(thread.scope),
        id: "chat:#{thread.id}",
        project_slug: thread.project_slug,
        project_name: project_name(thread.project_slug),
        title: chat_title(thread, preview),
        identifier: nil,
        thread_id: thread.id,
        status: humanize_thread_status(thread.status),
        status_kind: String.to_existing_atom(thread.status),
        preview: preview,
        updated_at: thread.updated_at
      }
    end)
  end

  defp codex_items(projects, issue_lister, executions) do
    by_identifier = Map.new(executions, &{&1.issue_identifier, &1})

    Enum.flat_map(projects, fn project ->
      project.slug
      |> issue_lister.()
      |> Enum.filter(&codex_candidate?(&1, by_identifier))
      |> Enum.map(&codex_item(&1, project, Map.get(by_identifier, &1.identifier)))
    end)
  end

  defp codex_candidate?(issue, by_identifier) do
    Map.has_key?(by_identifier, issue.identifier) or present?(Map.get(issue, :branch_name))
  end

  defp codex_item(issue, project, nil) do
    base_codex_item(issue, project)
    |> Map.merge(%{status: issue.status, status_kind: workflow_status_kind(issue.status)})
  end

  defp codex_item(issue, project, exec) do
    base_codex_item(issue, project)
    |> Map.merge(%{
      status: humanize_exec_status(exec.status),
      status_kind: exec.status,
      updated_at: exec.last_event_at || issue.updated_at
    })
  end

  defp base_codex_item(issue, project) do
    %{
      kind: :codex,
      scope: nil,
      id: "codex:#{issue.identifier}",
      project_slug: project.slug,
      project_name: project.name,
      title: issue.title,
      identifier: issue.identifier,
      thread_id: nil,
      preview: nil,
      updated_at: issue.updated_at
    }
  end

  defp safe_executions do
    AgentExecution.list()
  rescue
    _ -> []
  catch
    _, _ -> []
  end

  defp default_issue_lister(slug) do
    slug
    |> Context.list_issues([])
    |> Enum.map(fn issue ->
      %{
        identifier: issue.identifier,
        title: issue.title,
        status: issue_status_name(issue),
        branch_name: issue.branch_name,
        updated_at: issue.updated_at
      }
    end)
  end

  defp issue_status_name(%{status: %{name: name}}), do: name
  defp issue_status_name(_), do: nil

  defp project_name(nil), do: nil
  defp project_name(slug) do
    case Context.get_project(slug) do
      {:ok, project} -> project.name
      _ -> slug
    end
  end

  defp chat_title(%{title: title}, _preview) when is_binary(title) and title != "", do: title
  defp chat_title(_thread, preview) when is_binary(preview) and preview != "", do: String.slice(preview, 0, 80)
  defp chat_title(%{project_slug: slug}, _preview) when is_binary(slug), do: slug
  defp chat_title(_thread, _preview), do: "Freeform chat"

  defp preview_text(nil), do: nil
  defp preview_text(%{content: content}), do: content

  defp humanize_thread_status("active"), do: "Active"
  defp humanize_thread_status("closed"), do: "Closed"
  defp humanize_thread_status("error"), do: "Error"
  defp humanize_thread_status(other), do: other

  defp humanize_exec_status(status), do: status |> Atom.to_string() |> String.capitalize()

  defp workflow_status_kind(name) when is_binary(name) do
    down = String.downcase(name)

    cond do
      String.contains?(down, ["done", "complete", "merged", "closed"]) -> :done
      String.contains?(down, ["review"]) -> :in_progress
      String.contains?(down, ["progress", "doing", "started"]) -> :in_progress
      String.contains?(down, ["todo", "backlog", "triage"]) -> :todo
      true -> :active
    end
  end

  defp workflow_status_kind(_name), do: :active

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false
end
```

> Note: `String.to_existing_atom/1` on `thread.scope`/`thread.status` is safe because those atoms (`:project`, `:freeform`, `:issue`, `:active`, `:closed`, `:error`) exist in compiled code. Confirm by referencing them once; they appear above.

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/recents_test.exs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/recents.ex elixir/test/symphony_elixir/recents_test.exs
git commit -m "feat(recents): unified chat + codex aggregator"
```

### Task D2: `GET /recents` controller + presenter

**Files:**
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/recents_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/recents_controller_test.exs`

- [ ] **Step 1: Write failing test**

```elixir
defmodule SymphonyElixirWeb.Tracker.RecentsControllerTest do
  use SymphonyElixirWeb.ConnCase, async: false

  alias SymphonyElixir.Assistant.History

  setup %{conn: conn} do
    token = System.get_env("SYMPHONY_LOCAL_API_TOKEN") || "test-token"
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  test "returns recents with snake_case keys", %{conn: conn} do
    {:ok, _} = History.create_freeform_thread(%{title: "Ideas", workspace_path: System.tmp_dir!()})
    conn = get(conn, ~p"/api/tracker/v1/recents?limit=10")
    assert %{"data" => [item | _]} = json_response(conn, 200)
    assert Map.has_key?(item, "status_kind")
    assert Map.has_key?(item, "project_slug")
  end

  test "requires auth", %{conn: _conn} do
    conn = build_conn() |> get(~p"/api/tracker/v1/recents")
    assert json_response(conn, 401)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/recents_controller_test.exs`
Expected: failure (controller undefined; route added in B3).

- [ ] **Step 3: Implement controller + presenter**

Presenter `recent_item/1` (with `@spec`):

```elixir
  @spec recent_item(map()) :: map()
  def recent_item(item) when is_map(item) do
    %{
      type: Atom.to_string(item.kind),
      scope: item.scope && Atom.to_string(item.scope),
      id: item.id,
      project_slug: item.project_slug,
      project_name: item.project_name,
      title: item.title,
      identifier: item.identifier,
      thread_id: item.thread_id,
      status: item.status,
      status_kind: Atom.to_string(item.status_kind),
      preview: item.preview,
      updated_at: iso8601(item.updated_at)
    }
  end
```

Controller:

```elixir
defmodule SymphonyElixirWeb.Tracker.RecentsController do
  @moduledoc "Unified recents feed of assistant chats and Codex/issue runs."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Recents
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    data = Recents.list(limit: limit(params)) |> Enum.map(&TrackerPresenter.recent_item/1)
    json(conn, %{data: data})
  end

  defp limit(%{"limit" => raw}) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, _} -> n |> min(50) |> max(1)
      :error -> 20
    end
  end

  defp limit(_params), do: 20
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/recents_controller_test.exs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir_web/controllers/tracker/recents_controller.ex elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex elixir/test/symphony_elixir_web/controllers/tracker/recents_controller_test.exs
git commit -m "feat(recents): GET /recents endpoint"
```

### Task D3: Backend gate

- [ ] **Step 1: Run spec check + full gate**

Run: `cd elixir && mix specs.check && make all`
Expected: format/lint/coverage/dialyzer all pass. Fix any `@spec` gaps on new public `def`s.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A elixir
git commit -m "chore(assistant,recents): satisfy specs and quality gates"
```

---

## WS-C — Frontend types, services, hook

### Task C1: Recents + thread types and services

**Files:**
- Create: `tracker/src/types/recents.ts`, `tracker/src/types/assistant-thread.ts`
- Create: `tracker/src/services/recents.ts`, `tracker/src/services/assistantThreads.ts`
- Test: `tracker/src/services/__tests__/recents.test.ts`, `tracker/src/services/__tests__/assistantThreads.test.ts`

- [ ] **Step 1: Write the types** (no test; pure types)

`types/recents.ts` and `types/assistant-thread.ts` exactly as in spec §D.3 and §C.3.

- [ ] **Step 2: Write failing service tests**

`recents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRecentSession } from "@/services/recents";

describe("normalizeRecentSession", () => {
  it("maps snake_case codex rows", () => {
    const item = normalizeRecentSession({
      type: "codex",
      scope: null,
      id: "codex:ABC-1",
      project_slug: "demo",
      project_name: "Demo",
      title: "Fix bug",
      identifier: "ABC-1",
      thread_id: null,
      status: "Live",
      status_kind: "running",
      preview: null,
      updated_at: "2026-05-30T00:00:00Z",
    });
    expect(item.kind).toBe("codex");
    expect(item.projectSlug).toBe("demo");
    expect(item.statusKind).toBe("running");
  });

  it("defaults missing project to null for freeform chats", () => {
    const item = normalizeRecentSession({ type: "chat", scope: "freeform", id: "chat:1", title: "Ideas", status_kind: "active" });
    expect(item.projectSlug).toBeNull();
    expect(item.scope).toBe("freeform");
  });
});
```

`assistantThreads.test.ts`: assert `normalizeAssistantThread` maps snake/camel and `projectSlug` null.

- [ ] **Step 3: Run to verify failure**

Run: `cd tracker && npx vitest run src/services/__tests__/recents.test.ts src/services/__tests__/assistantThreads.test.ts`
Expected: failure (modules not found).

- [ ] **Step 4: Implement services**

`services/recents.ts`:

```ts
import type { RecentSession, RecentStatusKind } from "@/types/recents";
import { http, trackerPath, unwrapData } from "./http";

interface BackendRecentDto {
  type?: string | null;
  scope?: string | null;
  id?: string | null;
  project_slug?: string | null;
  projectSlug?: string | null;
  project_name?: string | null;
  projectName?: string | null;
  title?: string | null;
  identifier?: string | null;
  thread_id?: number | null;
  threadId?: number | null;
  status?: string | null;
  status_kind?: string | null;
  statusKind?: string | null;
  preview?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

const STATUS_KINDS: readonly RecentStatusKind[] = [
  "running", "waiting", "retrying", "idle", "active", "done", "closed", "error", "todo", "in_progress",
];

export function normalizeRecentSession(dto: BackendRecentDto): RecentSession {
  const statusKind = (dto.statusKind ?? dto.status_kind ?? "active") as RecentStatusKind;
  return {
    kind: dto.type === "codex" ? "codex" : "chat",
    scope: (dto.scope as RecentSession["scope"]) ?? null,
    id: String(dto.id ?? `${dto.type}:${dto.identifier ?? dto.threadId ?? Math.random()}`),
    projectSlug: dto.projectSlug ?? dto.project_slug ?? null,
    projectName: dto.projectName ?? dto.project_name ?? null,
    title: dto.title ?? "Untitled",
    identifier: dto.identifier ?? null,
    threadId: dto.threadId ?? dto.thread_id ?? null,
    status: dto.status ?? "",
    statusKind: STATUS_KINDS.includes(statusKind) ? statusKind : "active",
    preview: dto.preview ?? null,
    updatedAt: dto.updatedAt ?? dto.updated_at ?? "",
  };
}

export async function listRecents(limit = 20): Promise<RecentSession[]> {
  const response = await http.get(trackerPath(`/recents`), { params: { limit } });
  return unwrapData<BackendRecentDto[]>(response).map(normalizeRecentSession);
}
```

`services/assistantThreads.ts`: `listThreads({ scope, projectSlug, limit })` → `GET /assistant/threads`; `createThread({ scope, title })` → `POST /assistant/threads`; `normalizeAssistantThread` tolerant of snake/camel.

- [ ] **Step 5: Run to verify pass**

Run: `cd tracker && npx vitest run src/services/__tests__/recents.test.ts src/services/__tests__/assistantThreads.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/recents.ts tracker/src/types/assistant-thread.ts tracker/src/services/recents.ts tracker/src/services/assistantThreads.ts tracker/src/services/__tests__/recents.test.ts tracker/src/services/__tests__/assistantThreads.test.ts
git commit -m "feat(tracker): recents + assistant-thread services"
```

### Task C2: `useRecents` hook

**Files:**
- Create: `tracker/src/hooks/useRecents.ts`
- Test: `tracker/src/hooks/__tests__/useRecents.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/recents", () => ({ listRecents: vi.fn() }));
import { listRecents } from "@/services/recents";
import { useRecents } from "@/hooks/useRecents";

describe("useRecents", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads recents and keeps last value on error", async () => {
    (listRecents as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: "chat:1", kind: "chat" }])
      .mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useRecents({ intervalMs: 10 }));
    await waitFor(() => expect(result.current.recents).toHaveLength(1));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.recents).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useRecents.test.tsx`
Expected: failure (hook missing).

- [ ] **Step 3: Implement the hook** (model after `useAgentExecutions`)

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { useWindowFocus } from "@/hooks/useWindowFocus";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import { listRecents } from "@/services/recents";
import type { RecentSession } from "@/types/recents";

const DEFAULT_INTERVAL_MS = 10_000;

export interface UseRecentsResult {
  recents: RecentSession[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useRecents({ limit = 20, intervalMs = DEFAULT_INTERVAL_MS } = {}): UseRecentsResult {
  const [recents, setRecents] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef(false);
  const focused = useWindowFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const refetch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setRecents(await listRecents(limit));
    } catch {
      /* keep last known recents */
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refetch();
    const timer = setInterval(() => {
      if (focusedRef.current) void refetch();
    }, intervalMs);
    const onProjects = () => void refetch();
    window.addEventListener(TRACKER_PROJECTS_CHANGED_EVENT, onProjects);
    return () => {
      clearInterval(timer);
      window.removeEventListener(TRACKER_PROJECTS_CHANGED_EVENT, onProjects);
    };
  }, [intervalMs, refetch]);

  return { recents, loading, refetch };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd tracker && npx vitest run src/hooks/__tests__/useRecents.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useRecents.ts tracker/src/hooks/__tests__/useRecents.test.tsx
git commit -m "feat(tracker): useRecents polling hook"
```

### Task C3: `RecentStatusDot` component

**Files:**
- Create: `tracker/src/components/layout/RecentStatusDot.tsx`
- Test: `tracker/src/components/layout/__tests__/RecentStatusDot.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";

describe("RecentStatusDot", () => {
  it("labels each status kind", () => {
    render(<RecentStatusDot statusKind="running" />);
    expect(screen.getByTitle(/running/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/components/layout/__tests__/RecentStatusDot.test.tsx`
Expected: failure (component missing).

- [ ] **Step 3: Implement**

```tsx
import { cn } from "@/lib/utils";
import type { RecentStatusKind } from "@/types/recents";

const DOT: Record<RecentStatusKind, { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-emerald-500" },
  waiting: { label: "Waiting", dot: "bg-amber-500" },
  retrying: { label: "Retrying", dot: "bg-orange-500" },
  idle: { label: "Idle", dot: "bg-slate-400" },
  active: { label: "Active", dot: "bg-blue-500" },
  in_progress: { label: "In progress", dot: "bg-blue-500" },
  done: { label: "Done", dot: "bg-emerald-600" },
  todo: { label: "Todo", dot: "bg-slate-400" },
  closed: { label: "Closed", dot: "bg-slate-500" },
  error: { label: "Error", dot: "bg-red-500" },
};

export function RecentStatusDot({ statusKind, className }: { statusKind: RecentStatusKind; className?: string }) {
  const meta = DOT[statusKind] ?? DOT.active;
  return <span title={meta.label} className={cn("inline-block h-2 w-2 shrink-0 rounded-full", meta.dot, className)} />;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd tracker && npx vitest run src/components/layout/__tests__/RecentStatusDot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/RecentStatusDot.tsx tracker/src/components/layout/__tests__/RecentStatusDot.test.tsx
git commit -m "feat(tracker): RecentStatusDot status vocabulary"
```

### Task C4: `RecentsSection` + sidebar integration

**Files:**
- Create: `tracker/src/components/layout/RecentsSection.tsx`
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx`
- Test: extend `tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx`

- [ ] **Step 1: Write failing test** (extend ProjectSidebar test)

```tsx
// mock useRecents to return one chat + one codex row, then assert:
it("renders Recents rows with project labels and links", async () => {
  // arrange mock useRecents -> [{kind:"chat",scope:"freeform",title:"Ideas",threadId:7,projectName:null,statusKind:"active",...},
  //                              {kind:"codex",identifier:"ABC-1",title:"Fix bug",projectSlug:"demo",projectName:"Demo",statusKind:"running",...}]
  // render <ProjectSidebar/> inside MemoryRouter
  expect(await screen.findByText("Ideas")).toBeInTheDocument();
  expect(screen.getByText("Fix bug")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Fix bug/ })).toHaveAttribute("href", "/projects/demo/board/issues/ABC-1/agent");
  expect(screen.getByRole("link", { name: /Ideas/ })).toHaveAttribute("href", "/assistant/7");
});
```

Mock `@/services/projects` (existing pattern) and `@/hooks/useRecents`.

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/components/layout/__tests__/ProjectSidebar.test.tsx`
Expected: failure (no Recents rows yet).

- [ ] **Step 3: Implement `RecentsSection` and mount it**

`RecentsSection.tsx`:

```tsx
import { Bot, MessageSquare } from "lucide-react";
import { NavLink } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { useRecents } from "@/hooks/useRecents";
import { assistantPath, issuePath } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import type { RecentSession } from "@/types/recents";

function rowHref(item: RecentSession): string | null {
  if (item.kind === "codex" && item.projectSlug && item.identifier) {
    return issuePath(item.projectSlug, "board", item.identifier, "agent");
  }
  if (item.kind === "chat" && item.scope === "freeform" && item.threadId != null) {
    return `/assistant/${item.threadId}`;
  }
  if (item.kind === "chat" && item.projectSlug) return assistantPath(item.projectSlug);
  return null;
}

export function RecentsSection() {
  const { recents, loading } = useRecents();

  return (
    <div className="mb-3">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recents</div>
      {!loading && recents.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No recent sessions yet.</div>
      ) : null}
      <div className="space-y-1">
        {recents.map((item) => {
          const href = rowHref(item);
          const Icon = item.kind === "codex" ? Bot : MessageSquare;
          const inner = (
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{item.title}</div>
                <div className="truncate text-[11px] opacity-70">{item.projectName ?? "Geral"}</div>
              </div>
              <RecentStatusDot statusKind={item.statusKind} />
            </div>
          );

          return href ? (
            <NavLink
              key={item.id}
              to={href}
              className={({ isActive }) =>
                cn("block rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground", isActive && "bg-accent text-foreground")
              }
            >
              {inner}
            </NavLink>
          ) : (
            <div key={item.id} className="block rounded-md px-3 py-2 text-muted-foreground">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
```

In `ProjectSidebar.tsx`: import `RecentsSection` and the `Bot` icon; add an **Assistant** `NavLink` to `/assistant` after the Observability link; inside the scroll area (`min-h-0 flex-1 ... overflow-auto`), render `<RecentsSection />` above the existing **Boards** header/block.

- [ ] **Step 4: Run to verify pass**

Run: `cd tracker && npx vitest run src/components/layout/__tests__/ProjectSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/layout/RecentsSection.tsx tracker/src/components/layout/ProjectSidebar.tsx tracker/src/components/layout/__tests__/ProjectSidebar.test.tsx
git commit -m "feat(tracker): Recents section in sidebar"
```

### Task C5: Channel topic helper + panel opens by thread id

**Files:**
- Modify: `tracker/src/services/phoenix/assistantChannel.ts`, `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Test: extend `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Assert that when `ProjectAssistantPanel` is rendered with `threadId={7}` it joins topic `assistant:thread:7` (mock the socket/channel as the existing test does) instead of `assistant:<slug>`.

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: failure (panel ignores `threadId`).

- [ ] **Step 3: Implement**

Add to `assistantChannel.ts`:

```ts
export function assistantThreadTopic(threadId: number | string): string {
  const id = String(threadId).trim();
  if (!id) throw new Error("threadId is required");
  return `assistant:thread:${id}`;
}
```

In `ProjectAssistantPanel.tsx`: add optional `threadId?: number | null` to props; compute `const topic = threadId != null ? assistantThreadTopic(threadId) : assistantTopic(projectSlug);` and `socket.channel(topic)`. Keep all other behavior identical.

- [ ] **Step 4: Run to verify pass**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/phoenix/assistantChannel.ts tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(tracker): assistant panel opens by thread id"
```

### Task C6: `/assistant` freeform page + routes

**Files:**
- Create: `tracker/src/pages/AssistantPage.tsx`
- Modify: `tracker/src/App.tsx`
- Test: `tracker/src/pages/__tests__/AssistantPage.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// mock services/assistantThreads (listThreads -> [{id:1,title:"A",scope:"freeform",...}], createThread -> {id:2,...})
// render <AssistantPage/> in MemoryRouter at /assistant
it("lists freeform chats and creates a new one", async () => {
  expect(await screen.findByText("A")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
  await waitFor(() => expect(createThread).toHaveBeenCalledWith({ scope: "freeform" }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/pages/__tests__/AssistantPage.test.tsx`
Expected: failure (page missing).

- [ ] **Step 3: Implement page + routes**

`AssistantPage.tsx`: two-pane layout — left list from `listThreads({ scope: "freeform" })` with a **New chat** button calling `createThread({ scope: "freeform" })` then navigating to `/assistant/${id}`; right pane renders `<ProjectAssistantPanel mode="page" projectSlug="" view="board" threadId={selectedId} />` when a `:threadId` route param is present. (Reuse the existing panel; `projectSlug` unused for freeform topic.)

`App.tsx`: add under `<Route path="/" element={<Layout />}>`:

```tsx
<Route path="assistant" element={<AssistantPage />} />
<Route path="assistant/:threadId" element={<AssistantPage />} />
```

- [ ] **Step 4: Run to verify pass**

Run: `cd tracker && npx vitest run src/pages/__tests__/AssistantPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/pages/AssistantPage.tsx tracker/src/App.tsx tracker/src/pages/__tests__/AssistantPage.test.tsx
git commit -m "feat(tracker): freeform assistant page and routes"
```

### Task C7: Frontend gate

- [ ] **Step 1: Lint + full test run + build**

Run: `cd tracker && npm run lint && npx vitest run && npm run build`
Expected: lint clean, all tests pass, `tsc -b && vite build` succeeds.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A tracker
git commit -m "chore(tracker): lint/build fixes for recents + freeform chats"
```

---

## WS-E — End-to-end verification & docs

### Task E1: Manual smoke test

- [ ] **Step 1: Run backend + frontend**

Run backend (per repo README) and `cd tracker && npm run dev`. With a token set, open the tracker.

- [ ] **Step 2: Verify**

Expected:
- Sidebar shows a **Recents** group and an **Assistant** nav link.
- Creating a freeform chat at `/assistant` and sending a message returns a conversational reply; the chat appears in Recents under "Geral".
- A project with a branched/active issue shows a **codex** row that links to `/projects/<slug>/board/issues/<id>/agent` with a status dot.
- A project chat appears and links to the project assistant.

### Task E2: Docs

**Files:**
- Modify: `elixir/README.md` (new endpoints `GET /recents`, `GET/POST /assistant/threads`, freeform chats), `README.md` if the feature is user-facing.

- [ ] **Step 1: Update docs** to describe Recents + freeform chats and the new endpoints (per `elixir/AGENTS.md` docs policy).

- [ ] **Step 2: Commit**

```bash
git add README.md elixir/README.md
git commit -m "docs: recents sidebar and freeform assistant chats"
```

---

## Self-Review

**Spec coverage:**
- Recents group in sidebar, ranked, capped, project/"Geral" + status → D1, D2, C2, C4. ✓
- Chat row (thread, title/preview, status) → D1 (`chat_items`), C4. ✓
- Codex row (branch/live signal, live status else workflow) → D1 (`codex_items`, §3 signal), C4. ✓
- Freeform chats: create/open, multiple, conversational only → A2/A3 (model), B1 (no tools), B2 (channel), B3 (API), C6 (UI). ✓
- Multiple threads, open by thread id → A3, B2, C5. ✓
- Click navigation (assistant project/freeform; issue agent) → C4 (`rowHref`). ✓
- Graceful degradation (orchestrator down; client keep-last) → D1 (`safe_executions`), C2 (catch). ✓
- Contract ready for issue scope (not implemented) → A1 (indexes), A2 (validations), types include scope. ✓
- Migration (scope, nullable project, issue_identifier, title, index swap) → A1. ✓
- Back-compat `assistant:<slug>` topic → B2 (kept). ✓
- Tests (backend + frontend) → each task's test step; gates D3, C7. ✓

**Placeholder scan:** No `TBD`/`TODO`/"implement later". The SQLite `modify` caveat (A1) gives a concrete fallback (table rebuild) gated on running Step 2. Test stubs in C4/C6/C7 describe exact assertions and selectors.

**Type consistency:** `RecentSession`/`RecentStatusKind` (types/recents.ts) used identically in `recents.ts`, `useRecents.ts`, `RecentStatusDot.tsx`, `RecentsSection.tsx`. Backend `recent_item/1` keys (`type`, `scope`, `status_kind`, `thread_id`, …) match the frontend `BackendRecentDto`. `assistant_thread/1` keys match `assistant-thread.ts`. `send_message_to_thread/4` (B1) is the function the channel (B2) calls. `freeform_workspace_root/0` introduced in B3 and referenced by the controller.

**Open follow-ups (not blockers):** freeform attachment storage is out of scope (channel forces empty attachments for freeform); issue-scoped chats and assistant-creates-issue remain future per spec §10.
