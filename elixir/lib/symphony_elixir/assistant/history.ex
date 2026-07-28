defmodule SymphonyElixir.Assistant.History do
  @moduledoc "Persistence boundary for project assistant threads and messages."

  import Ecto.Query

  alias SymphonyElixir.Agent.{ConversationRef, Error}

  alias SymphonyElixir.Assistant.{
    Message,
    ProjectExploreWorkspace,
    SessionTitles,
    Thread,
    TitleGenerator,
    TurnTimeline
  }

  alias SymphonyElixir.{ExecutionMode, Workspace}
  alias SymphonyElixir.LocalTracker.{Context, IssueAdapter}
  alias SymphonyElixir.Recents.Broadcaster, as: RecentsBroadcaster
  alias SymphonyElixir.Repo

  @type attrs :: map()

  @current_turn_key "current_turn"
  @pending_turns_key "pending_turns"
  @sidebar_title_max_graphemes 160
  @sidebar_label_max_graphemes 40
  @sidebar_label_count_max 12
  @deletable_scopes ~w(freeform project project_session project_explore issue_session issue issue_execution kb)
  @cas_retries 5

  @spec ensure_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug) do
      case active_thread(normalized_slug) do
        %Thread{} = thread -> {:ok, thread}
        nil -> create_thread(normalized_slug, attrs)
      end
    end
  end

  @spec thread_by_client_request_id(String.t()) :: Thread.t() | nil
  def thread_by_client_request_id(client_request_id) when is_binary(client_request_id) do
    Repo.get_by(Thread, client_request_id: client_request_id)
  end

  @spec ensure_project_explore_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_project_explore_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, project} <- Context.get_project(normalized_slug),
         {:ok, workspace} <- ProjectExploreWorkspace.ensure(normalized_slug, explore_workspace_opts(attrs)) do
      attrs = Map.put_new(attrs, :workspace_path, workspace)

      case active_project_explore_thread(normalized_slug) do
        %Thread{} = thread ->
          {:ok, thread}

        nil ->
          default_title =
            SessionTitles.default_title("project_explore",
              project_name: project.name,
              project_slug: normalized_slug
            )

          attrs
          |> Map.put(:scope, "project_explore")
          |> Map.put(:project_slug, normalized_slug)
          |> Map.put_new(:status, "active")
          |> Map.put_new(:title, default_title)
          |> then(&Thread.changeset(%Thread{}, &1))
          |> Repo.insert()
          |> notify_recents()
      end
    end
  end

  @doc """
  Finds or creates the knowledge base assistant thread for a single open page,
  scoped by `(project, repository, path-within-docs)`. The page identity is stored
  in metadata (`kb_page_key`/`kb_repo_slug`/`kb_page_path`) so each open document
  keeps its own revisitable conversation history.
  """
  @spec ensure_kb_thread(String.t(), String.t(), String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_kb_thread(project_slug, repo_slug, page_path, attrs \\ %{})
      when is_binary(project_slug) and is_binary(repo_slug) and is_binary(page_path) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, repo} <- normalize_required_string(repo_slug, :repo_slug),
         {:ok, path} <- normalize_required_string(page_path, :page_path),
         {:ok, _scope} <- ensure_kb_project_scope(slug) do
      key = repo <> ":" <> path

      case active_kb_thread(slug, key) do
        %Thread{} = thread ->
          {:ok, thread}

        nil ->
          metadata =
            attrs
            |> Map.get(:metadata, %{})
            |> Map.merge(%{"kb_page_key" => key, "kb_repo_slug" => repo, "kb_page_path" => path})

          attrs
          |> Map.put(:scope, "kb")
          |> Map.put(:project_slug, slug)
          |> Map.put(:metadata, metadata)
          |> Map.put_new(:status, "active")
          |> Map.put_new(:workspace_path, kb_workspace(slug))
          |> Map.put_new(:title, SessionTitles.default_title("kb", page_title: kb_thread_title(path)))
          |> then(&Thread.changeset(%Thread{}, &1))
          |> Repo.insert()
          |> notify_recents()
      end
    end
  end

  @spec ensure_issue_thread(String.t(), String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def ensure_issue_thread(project_slug, issue_identifier, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, _project} <- Context.get_project(slug) do
      case active_issue_thread(slug, identifier) do
        %Thread{} = thread -> {:ok, thread}
        nil -> create_issue_thread(slug, identifier, attrs)
      end
    end
  end

  @doc """
  Returns the workspace path recorded on the active issue thread for `issue_identifier`.

  This is the durable source of truth for an issue's authoring working tree: both the
  document viewer (read) and the authoring turn (write) resolve to this path so they keep
  agreeing even if the workspace-path computation later changes. Returns nil when there is
  no active issue thread or when the persistence layer is unavailable.
  """
  @spec issue_workspace_path(String.t()) :: String.t() | nil
  def issue_workspace_path(issue_identifier) when is_binary(issue_identifier) do
    case issue_workspace_context(issue_identifier) do
      %{workspace_path: path} when is_binary(path) and path != "" -> path
      _ -> nil
    end
  rescue
    _error -> nil
  catch
    :exit, _reason -> nil
  end

  @doc """
  Counts active assistant threads pinned to `workspace_path`.

  Used by the working-tree inventory to decide whether an isolated parallel
  tree or a standalone workspace is orphaned (zero active sessions) and can be
  offered for cleanup.
  """
  @spec count_active_threads_for_workspace(String.t()) :: non_neg_integer()
  def count_active_threads_for_workspace(workspace_path) when is_binary(workspace_path) do
    case String.trim(workspace_path) do
      "" ->
        0

      path ->
        Thread
        |> where([thread], thread.workspace_path == ^path and thread.status == "active")
        |> Repo.aggregate(:count)
    end
  rescue
    _error -> 0
  catch
    :exit, _reason -> 0
  end

  @doc """
  Returns the persisted workspace context for an active issue authoring thread.
  """
  @spec issue_workspace_context(String.t()) ::
          %{
            thread_id: integer(),
            project_slug: String.t() | nil,
            workspace_path: String.t()
          }
          | nil
  def issue_workspace_context(issue_identifier) when is_binary(issue_identifier) do
    case String.trim(issue_identifier) do
      "" ->
        nil

      identifier ->
        Thread
        |> Repo.get_by(issue_identifier: identifier, scope: "issue", status: "active")
        |> case do
          %Thread{id: id, workspace_path: path, project_slug: slug} when is_binary(path) and path != "" ->
            %{thread_id: id, project_slug: slug, workspace_path: path}

          _ ->
            nil
        end
    end
  rescue
    _error -> nil
  catch
    :exit, _reason -> nil
  end

  @doc """
  Promotes the active project-scoped thread into the issue-scoped thread for `issue_identifier`.

  The `/assistant/new-issue` chat lives in the project's active thread until a draft issue is
  created. At that point the same thread must become the issue's authoring thread (spec D1) so it
  is reachable at `/projects/:slug/assistant/issue/:id` and never lingers as an orphan project
  chat in the recents sidebar. Behaviour:

    * no active issue thread yet → upgrade the active project thread in place;
    * an active issue thread already exists → fold the project chat into it and close the orphan;
    * no active project thread → return/create the issue thread.
  """
  @spec promote_project_thread_to_issue(String.t(), String.t(), attrs()) ::
          {:ok, Thread.t()} | {:error, term()}
  def promote_project_thread_to_issue(project_slug, issue_identifier, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, _project} <- Context.get_project(slug) do
      promote_active_project_thread(slug, identifier, attrs)
    end
  end

  @doc """
  Repairs legacy orphan project threads that already produced a draft issue.

  Earlier builds copied the chat into a new issue thread but left the project thread active, so it
  surfaced in recents pointing to the project assistant instead of the issue assistant. This scans
  active project threads, and for any whose history contains a successful `create_draft_issue`,
  promotes it via `promote_project_thread_to_issue/3`. Idempotent and safe to run repeatedly.
  """
  @spec repair_lingering_issue_drafts() :: :ok
  def repair_lingering_issue_drafts do
    Thread
    |> where([t], t.scope == "project" and t.status == "active")
    |> Repo.all()
    |> Enum.each(fn %Thread{project_slug: slug} = thread ->
      case draft_identifier_from_thread(thread.id) do
        nil ->
          :ok

        identifier ->
          promote_project_thread_to_issue(slug, identifier, %{workspace_path: thread.workspace_path})
      end
    end)

    :ok
  end

  @doc """
  Persists agent mode + skill toolkit selection on the thread metadata.

  Used by the interactive session composer so the next join rehydrates the operator's
  Plan/Build/Yolo mode and Auto/Custom toolkit without requiring a migration.
  """
  @spec set_turn_preferences(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, term()}
  def set_turn_preferences(%Thread{} = thread, attrs) when is_map(attrs) do
    mutate_metadata(thread, fn current ->
      next =
        (current.metadata || %{})
        |> maybe_put_meta_string(
          "execution_mode",
          Map.get(attrs, :execution_mode) || Map.get(attrs, "execution_mode")
        )
        |> maybe_put_meta_string(
          "skill_profile",
          Map.get(attrs, :skill_profile) || Map.get(attrs, "skill_profile")
        )

      {:update, next, nil}
    end)
    |> without_mutation_value()
  end

  @spec thread_execution_mode(Thread.t()) :: String.t() | nil
  def thread_execution_mode(%Thread{metadata: %{"execution_mode" => mode}}) when is_binary(mode) do
    case String.trim(mode) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  def thread_execution_mode(_thread), do: nil

  @spec thread_model(Thread.t()) :: String.t() | nil
  def thread_model(%Thread{resolved_model: model}) when is_binary(model), do: model
  def thread_model(%Thread{}), do: nil

  @spec thread_effort(Thread.t()) :: String.t() | nil
  def thread_effort(%Thread{resolved_effort: effort}) when is_binary(effort), do: effort
  def thread_effort(%Thread{}), do: nil

  @spec requested_model(Thread.t()) :: String.t() | nil
  def requested_model(%Thread{requested_model: model}), do: model

  @spec requested_effort(Thread.t()) :: String.t() | nil
  def requested_effort(%Thread{requested_effort: effort}), do: effort

  @spec resolved_model(Thread.t()) :: String.t() | nil
  def resolved_model(%Thread{resolved_model: model}), do: model

  @spec resolved_effort(Thread.t()) :: String.t() | nil
  def resolved_effort(%Thread{resolved_effort: effort}), do: effort

  @spec thread_skill_profile(Thread.t()) :: String.t() | nil
  def thread_skill_profile(%Thread{metadata: %{"skill_profile" => profile}}) when is_binary(profile) do
    case String.trim(profile) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  def thread_skill_profile(_thread), do: nil

  defp maybe_put_meta_string(metadata, _key, nil), do: metadata

  defp maybe_put_meta_string(metadata, key, value) when is_binary(value) do
    case String.trim(value) do
      "" -> Map.delete(metadata, key)
      trimmed -> Map.put(metadata, key, trimmed)
    end
  end

  defp maybe_put_meta_string(metadata, _key, _value), do: metadata

  defp put_requested_model_provenance(attrs) when is_map(attrs) do
    attrs
    |> maybe_copy_attr(:model, "model", :requested_model)
    |> maybe_copy_attr(:effort, "effort", :requested_effort)
  end

  defp maybe_copy_attr(attrs, atom_key, string_key, target_key) do
    cond do
      Map.has_key?(attrs, target_key) ->
        attrs

      Map.has_key?(attrs, Atom.to_string(target_key)) ->
        Map.put(attrs, target_key, Map.get(attrs, Atom.to_string(target_key)))

      Map.has_key?(attrs, atom_key) ->
        Map.put(attrs, target_key, Map.get(attrs, atom_key))

      Map.has_key?(attrs, string_key) ->
        Map.put(attrs, target_key, Map.get(attrs, string_key))

      true ->
        attrs
    end
  end

  defp drop_legacy_model_attrs(attrs) when is_map(attrs) do
    Map.drop(attrs, [:model, "model", :effort, "effort"])
  end

  defp drop_legacy_model_metadata(metadata) when is_map(metadata) do
    metadata
    |> Map.drop(["model", "effort"])
    |> Map.update("current_turn", nil, fn
      turn when is_map(turn) -> Map.drop(turn, ["model", "effort"])
      turn -> turn
    end)
    |> then(fn
      %{"current_turn" => nil} = cleaned -> Map.delete(cleaned, "current_turn")
      cleaned -> cleaned
    end)
  end

  defp take_model_provenance(attrs) when is_map(attrs) do
    Enum.reduce(
      [:requested_model, :requested_effort, :resolved_model, :resolved_effort],
      %{},
      fn key, provenance ->
        string_key = Atom.to_string(key)

        cond do
          Map.has_key?(attrs, key) -> Map.put(provenance, key, Map.get(attrs, key))
          Map.has_key?(attrs, string_key) -> Map.put(provenance, key, Map.get(attrs, string_key))
          true -> provenance
        end
      end
    )
  end

  @doc """
  Persists whether the chat goal is enabled for an assistant thread.

  This is the thread-scoped chat goal: when enabled, the assistant runs native
  goal mode directly inside this conversation (no orchestrator dispatch, no issue status change).
  The flag lives in the thread metadata map alongside `mode` (no migration). It is independent
  from the run objective, which lives on the issue (`agent_goal`) and runs via the orchestrator.
  """
  @spec set_goal_mode(Thread.t(), boolean()) :: {:ok, Thread.t()} | {:error, term()}
  def set_goal_mode(%Thread{} = thread, enabled) when is_boolean(enabled) do
    mutate_metadata(thread, fn current ->
      next =
        (current.metadata || %{})
        |> Map.put("goal_mode", enabled)
        |> put_next_goal_revision()

      {:update, next, nil}
    end)
    |> without_mutation_value()
  end

  @doc """
  Persists the Authoring goal flag together with its objective in a single update.

  Passing a blank/`nil` objective clears the stored objective. Used by the `/goal` command so the
  authoring conversation runs Codex goal mode toward an explicit objective.
  """
  @spec set_goal_mode(Thread.t(), boolean(), String.t() | nil) ::
          {:ok, Thread.t()} | {:error, term()}
  def set_goal_mode(%Thread{} = thread, enabled, objective) when is_boolean(enabled) do
    mutate_metadata(thread, fn current ->
      next =
        (current.metadata || %{})
        |> Map.put("goal_mode", enabled)
        |> put_goal_objective_meta(objective)
        |> put_next_goal_revision()

      {:update, next, nil}
    end)
    |> without_mutation_value()
  end

  @doc "Advances the durable authoring Goal mutation revision without changing its objective."
  @spec bump_goal_revision(Thread.t()) :: {:ok, Thread.t()} | {:error, term()}
  def bump_goal_revision(%Thread{} = thread) do
    mutate_metadata(thread, fn current ->
      {:update, put_next_goal_revision(current.metadata || %{}), nil}
    end)
    |> without_mutation_value()
  end

  @doc "Returns the durable authoring Goal mutation revision."
  @spec thread_goal_revision(Thread.t()) :: String.t() | nil
  def thread_goal_revision(%Thread{metadata: %{"goal_revision" => revision}})
      when is_binary(revision) and revision != "",
      do: revision

  def thread_goal_revision(%Thread{}), do: nil

  @doc "Returns when the durable authoring Goal was last mutated."
  @spec thread_goal_updated_at(Thread.t()) :: String.t() | nil
  def thread_goal_updated_at(%Thread{metadata: %{"goal_updated_at" => updated_at}})
      when is_binary(updated_at) and updated_at != "",
      do: updated_at

  def thread_goal_updated_at(%Thread{}), do: nil

  defp put_goal_objective_meta(metadata, objective) when is_binary(objective) do
    case String.trim(objective) do
      "" -> Map.delete(metadata, "goal_objective")
      trimmed -> Map.put(metadata, "goal_objective", trimmed)
    end
  end

  defp put_goal_objective_meta(metadata, _objective), do: Map.delete(metadata, "goal_objective")

  defp put_next_goal_revision(metadata) do
    current =
      case Map.get(metadata, "goal_revision") do
        revision when is_binary(revision) ->
          case Integer.parse(revision) do
            {value, ""} when value >= 0 -> value
            _ -> 0
          end

        _ ->
          0
      end

    metadata
    |> Map.put("goal_revision", Integer.to_string(current + 1))
    |> Map.put("goal_updated_at", DateTime.utc_now() |> DateTime.to_iso8601())
  end

  @doc """
  Returns whether the Authoring (chat) goal is enabled on a thread's metadata. Defaults to `false`.
  """
  @spec thread_goal_mode(Thread.t()) :: boolean()
  def thread_goal_mode(%Thread{metadata: metadata}) do
    case metadata do
      %{"goal_mode" => enabled} when is_boolean(enabled) -> enabled
      _ -> false
    end
  end

  @doc """
  Returns the Authoring goal objective persisted on a thread's metadata, or `nil` when unset.
  """
  @spec thread_goal_objective(Thread.t()) :: String.t() | nil
  def thread_goal_objective(%Thread{metadata: metadata}) do
    case metadata do
      %{"goal_objective" => objective} when is_binary(objective) and objective != "" -> objective
      _ -> nil
    end
  end

  @doc "Write a fresh `running` current_turn onto the thread's metadata."
  @spec start_turn_state(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def start_turn_state(%Thread{} = thread, attrs) when is_map(attrs) do
    turn = %{
      "status" => "running",
      "trigger" => Map.get(attrs, :trigger, "user"),
      "prompt" => to_string(Map.get(attrs, :prompt, "")),
      "provider" => stringify(Map.get(attrs, :provider)),
      "conversation_id" => stringify(Map.get(attrs, :conversation_id)),
      "run_id" => stringify(Map.get(attrs, :run_id)),
      "execution_id" => stringify(Map.get(attrs, :execution_id)),
      "client_message_id" => stringify(Map.get(attrs, :client_message_id)),
      "error" => nil,
      "error_code" => nil,
      "error_detail" => nil,
      "interrupted_reason" => nil,
      "started_at" => now_iso(),
      "finished_at" => nil
    }

    mutate_metadata(thread, fn current ->
      metadata = Map.put(current.metadata || %{}, @current_turn_key, turn)

      metadata =
        case Map.get(attrs, :queue_id) do
          queue_id when is_binary(queue_id) and queue_id != "" ->
            pending = Enum.reject(pending_turns(current), &(&1["id"] == queue_id))
            Map.put(metadata, @pending_turns_key, pending)

          _queue_id ->
            metadata
        end

      {:update, metadata, nil}
    end)
    |> without_mutation_value()
  end

  @doc "Fills provider-neutral conversation/run identity on the current turn."
  @spec note_run_identity(Thread.t(), map()) ::
          {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def note_run_identity(%Thread{} = thread, attrs) when is_map(attrs) do
    with {:ok, thread} <- maybe_put_run_conversation_ref(thread, attrs) do
      patch_current_turn(thread, fn turn -> merge_run_identity(turn, attrs) end)
    end
  end

  @doc "Upserts a running tool snapshot on the current turn and bumps activity."
  @spec upsert_active_tool(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def upsert_active_tool(%Thread{} = thread, tool) when is_map(tool) do
    tool = stringify_tool(tool)
    id = active_tool_id!(tool)
    tool = Map.put(tool, "id", id)

    patch_running_turn(thread, fn turn ->
      tools =
        turn
        |> active_tools()
        |> Enum.reject(&(&1["id"] == id))

      turn
      |> Map.put("active_tools", tools ++ [tool])
      |> Map.put("last_activity_at", now_iso())
    end)
  end

  def upsert_active_tool(%Thread{}, _tool), do: raise(ArgumentError, "active tool must be a map")

  @doc "Removes a running tool snapshot from the current turn and bumps activity."
  @spec remove_active_tool(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def remove_active_tool(%Thread{} = thread, tool_id) when is_binary(tool_id) do
    tool_id = active_tool_id!(%{"id" => tool_id})

    patch_running_turn(thread, fn turn ->
      tools = Enum.reject(active_tools(turn), &(&1["id"] == tool_id))

      turn
      |> Map.put("active_tools", tools)
      |> Map.put("last_activity_at", now_iso())
    end)
  end

  def remove_active_tool(%Thread{}, _tool_id), do: raise(ArgumentError, "active tool id must be a string")

  @doc "Bumps the current turn activity timestamp."
  @spec touch_turn_activity(Thread.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def touch_turn_activity(%Thread{} = thread) do
    patch_running_turn(thread, &Map.put(&1, "last_activity_at", now_iso()))
  end

  @doc "Transition the current turn to completed."
  @spec complete_turn_state(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def complete_turn_state(%Thread{} = thread, attrs) when is_map(attrs) do
    patch_current_turn(thread, fn turn ->
      turn
      |> merge_run_identity(attrs)
      |> Map.put("status", "completed")
      |> Map.put("finished_at", now_iso())
      |> Map.put("active_tools", [])
    end)
  end

  @doc "Transition the current turn to failed with an error string."
  @spec fail_turn_state(Thread.t(), term()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def fail_turn_state(%Thread{} = thread, reason) do
    error_detail = Error.to_map(reason)

    patch_current_turn(thread, fn turn ->
      turn
      |> Map.put("status", "failed")
      |> Map.put("error", turn_error_text(reason))
      |> Map.put("error_code", error_detail["code"])
      |> Map.put("error_detail", error_detail)
      |> Map.put("finished_at", now_iso())
      |> Map.put("active_tools", [])
    end)
  end

  @doc "Transition the current turn to interrupted with a reason."
  @spec interrupt_turn_state(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def interrupt_turn_state(%Thread{} = thread, reason) when is_binary(reason) do
    patch_current_turn(thread, fn turn ->
      turn
      |> Map.put("status", "interrupted")
      |> Map.put("interrupted_reason", reason)
      |> Map.put("finished_at", now_iso())
      |> Map.put("active_tools", [])
    end)
  end

  @doc """
  Restores `current_turn` to `running` after metadata was marked interrupted while a
  live worker was still registered (e.g. channel leave + boot reconcile desync).
  """
  @spec restore_running_turn_state(Thread.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def restore_running_turn_state(%Thread{} = thread) do
    patch_current_turn(thread, fn turn ->
      turn
      |> Map.put("status", "running")
      |> Map.put("interrupted_reason", nil)
      |> Map.put("error", nil)
      |> Map.put("error_code", nil)
      |> Map.put("error_detail", nil)
      |> Map.put("finished_at", nil)
    end)
  end

  @doc """
  Clears a resumable interrupted turn so the UI stops offering Resume without
  re-dispatching the saved prompt.
  """
  @spec dismiss_interrupted_turn_state(Thread.t()) ::
          {:ok, Thread.t()} | {:error, :not_interrupted | Ecto.Changeset.t()}
  def dismiss_interrupted_turn_state(%Thread{} = thread) do
    case current_turn(thread) do
      %{"status" => "interrupted"} ->
        patch_current_turn(thread, fn turn ->
          turn
          |> Map.put("status", "completed")
          |> Map.put("interrupted_reason", nil)
          |> Map.put("error", nil)
          |> Map.put("error_code", nil)
          |> Map.put("error_detail", nil)
          |> Map.put("active_tools", [])
          |> Map.put("finished_at", turn["finished_at"] || now_iso())
        end)

      _ ->
        {:error, :not_interrupted}
    end
  end

  @doc "Atomically interrupts the same running turn, preserving a completion that won the race."
  @spec interrupt_turn_state_if_running(Thread.t(), String.t()) ::
          {:ok, Thread.t()} | {:already_finished, Thread.t()} | {:error, term()}
  def interrupt_turn_state_if_running(%Thread{} = thread, reason) when is_binary(reason) do
    case current_turn(thread) do
      %{"status" => "running"} = turn ->
        interrupt_same_running_turn(thread, turn, turn_identity(turn), reason, 3)

      _ ->
        {:already_finished, thread}
    end
  end

  @doc "The current turn map stored on the thread metadata, or nil."
  @spec current_turn(Thread.t()) :: map() | nil
  def current_turn(%Thread{metadata: %{@current_turn_key => turn}}) when is_map(turn), do: turn
  def current_turn(%Thread{}), do: nil

  @spec client_message_recorded?(integer(), String.t()) :: boolean()
  def client_message_recorded?(thread_id, client_message_id)
      when is_integer(thread_id) and is_binary(client_message_id) do
    Repo.exists?(
      from(message in Message,
        where:
          message.thread_id == ^thread_id and
            message.client_message_id == ^client_message_id
      )
    )
  end

  @doc "Returns durable pending turn intents in FIFO order."
  @spec pending_turns(Thread.t()) :: [map()]
  def pending_turns(%Thread{metadata: metadata}) when is_map(metadata) do
    case Map.get(metadata, @pending_turns_key) do
      turns when is_list(turns) -> Enum.filter(turns, &valid_pending_turn?/1)
      _ -> []
    end
  end

  @doc "Appends a serializable pending turn intent to the thread."
  @spec enqueue_pending_turn(Thread.t(), map()) ::
          {:ok, Thread.t(), map()} | {:error, term()}
  def enqueue_pending_turn(%Thread{} = thread, attrs) when is_map(attrs) do
    with {:ok, prompt} <- normalize_required_string(Map.get(attrs, :prompt), :prompt),
         {:ok, provider} <- normalize_pending_provider(Map.get(attrs, :provider)) do
      entry = pending_turn_entry(prompt, provider, attrs)

      mutate_metadata(thread, fn current ->
        pending = pending_turns(current) ++ [entry]
        metadata = Map.put(current.metadata || %{}, @pending_turns_key, pending)
        {:update, metadata, entry}
      end)
    end
  end

  @doc "Removes and returns the oldest durable pending turn intent."
  @spec take_pending_turn(Thread.t()) ::
          {:ok, Thread.t(), map() | nil} | {:error, term()}
  def take_pending_turn(%Thread{} = thread) do
    mutate_metadata(thread, fn current ->
      case pending_turns(current) do
        [] ->
          {:noop, nil}

        [entry | rest] ->
          metadata = Map.put(current.metadata || %{}, @pending_turns_key, rest)
          {:update, metadata, entry}
      end
    end)
  end

  @doc "Removes one durable pending turn by queue id after it starts."
  @spec remove_pending_turn(Thread.t(), String.t()) ::
          {:ok, Thread.t()} | {:error, term()}
  def remove_pending_turn(%Thread{} = thread, queue_id) when is_binary(queue_id) do
    mutate_metadata(thread, fn current ->
      remaining = Enum.reject(pending_turns(current), &(&1["id"] == queue_id))
      metadata = Map.put(current.metadata || %{}, @pending_turns_key, remaining)
      {:update, metadata, nil}
    end)
    |> without_mutation_value()
  end

  @doc "Clears every durable pending turn intent for the thread."
  @spec clear_pending_turns(Thread.t()) :: {:ok, Thread.t()} | {:error, term()}
  def clear_pending_turns(%Thread{} = thread) do
    mutate_metadata(thread, fn current ->
      {:update, Map.put(current.metadata || %{}, @pending_turns_key, []), nil}
    end)
    |> without_mutation_value()
  end

  @doc "True when the thread's current turn is running."
  @spec turn_running?(Thread.t()) :: boolean()
  def turn_running?(%Thread{} = thread) do
    match?(%{"status" => "running"}, current_turn(thread))
  end

  @doc "Whole seconds the running turn has been executing, or nil when not running."
  @spec turn_elapsed_seconds(Thread.t()) :: non_neg_integer() | nil
  def turn_elapsed_seconds(%Thread{} = thread) do
    with %{"status" => "running", "started_at" => started} when is_binary(started) <-
           current_turn(thread),
         {:ok, dt, _offset} <- DateTime.from_iso8601(started) do
      max(0, DateTime.diff(DateTime.utc_now(), dt, :second))
    else
      _ -> nil
    end
  end

  @doc "Normalized current-turn payload for the channel/UI, or nil."
  @spec turn_payload(Thread.t() | map() | nil) :: map() | nil
  def turn_payload(nil), do: nil

  def turn_payload(%Thread{} = thread) do
    queued_count = length(pending_turns(thread))

    case turn_payload(current_turn(thread)) do
      nil when queued_count == 0 -> nil
      nil -> %{status: "queued", can_resume: false, active_tools: [], queued_count: queued_count}
      payload -> Map.put(payload, :queued_count, queued_count)
    end
  end

  def turn_payload(turn) when is_map(turn) do
    %{
      status: turn["status"],
      trigger: turn["trigger"],
      provider: turn["provider"],
      conversation_id: turn["conversation_id"],
      run_id: turn["run_id"],
      execution_id: turn["execution_id"],
      started_at: turn["started_at"],
      finished_at: turn["finished_at"],
      can_resume: turn["status"] == "interrupted",
      active_tools: active_tools(turn),
      last_activity_at: turn["last_activity_at"],
      queued_count: 0,
      error: public_error_payload(turn["error_detail"])
    }
  end

  @doc """
  On boot, flip running turns without a live worker in `except_thread_ids` to
  `interrupted(serve_restart)`.
  """
  @spec reconcile_orphaned_turns(keyword()) :: {:ok, non_neg_integer()}
  def reconcile_orphaned_turns(opts \\ []) when is_list(opts) do
    live_thread_ids =
      opts
      |> Keyword.get(:except_thread_ids, [])
      |> MapSet.new()

    count =
      Thread
      |> Repo.all()
      |> Enum.reduce(0, fn thread, acc ->
        if MapSet.member?(live_thread_ids, thread.id),
          do: acc,
          else: acc + reconcile_orphaned_turn(thread)
      end)

    {:ok, count}
  end

  defp reconcile_orphaned_turn(thread) do
    with true <- turn_running?(thread),
         {:ok, _} <- interrupt_turn_state(thread, "serve_restart") do
      1
    else
      _ -> 0
    end
  end

  @spec update_thread(Thread.t(), attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def update_thread(%Thread{} = thread, attrs) when is_map(attrs) do
    thread
    |> Thread.changeset(attrs)
    |> Repo.update()
    |> notify_recents()
  end

  @doc "Persists explicit requested or provider-resolved session model provenance."
  @spec put_model_provenance(Thread.t(), attrs()) ::
          {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def put_model_provenance(%Thread{} = thread, attrs) when is_map(attrs) do
    provenance =
      attrs
      |> take_model_provenance()

    update_thread(thread, provenance)
  end

  @doc "Returns the canonical provider conversation reference stored for `provider`."
  @spec conversation_ref(Thread.t(), String.t()) :: {:ok, ConversationRef.t()} | :error
  def conversation_ref(%Thread{} = thread, provider) when is_binary(provider) do
    provider = String.trim(provider)

    case thread.provider_bindings do
      %{^provider => conversation_id} when is_binary(conversation_id) ->
        ConversationRef.new(provider, conversation_id)

      _ ->
        :error
    end
  end

  @doc "Persists the canonical conversation id for a provider."
  @spec put_conversation_ref(Thread.t(), ConversationRef.t()) ::
          {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def put_conversation_ref(%Thread{} = thread, %ConversationRef{} = ref) do
    with {:ok, validated_ref} <- ConversationRef.load(ref) do
      mutate_provider_bindings(thread, fn current ->
        Map.put(
          current.provider_bindings || %{},
          validated_ref.provider,
          validated_ref.conversation_id
        )
      end)
    end
  end

  @doc """
  Persists the agent choice for this thread as `agent_kind`.
  """
  @spec set_thread_agent(Thread.t(), String.t()) ::
          {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def set_thread_agent(%Thread{} = thread, kind) when kind in ["codex", "claude", "cursor", "opencode"] do
    update_thread(thread, %{agent_kind: kind})
  end

  @spec archive_thread(integer()) :: {:ok, Thread.t()} | {:error, :not_found | Ecto.Changeset.t()}
  def archive_thread(id) when is_integer(id) do
    case get_thread(id) do
      {:ok, thread} -> update_thread(thread, %{status: "archived"})
      {:error, :not_found} -> {:error, :not_found}
    end
  end

  @spec update_thread_sidebar_metadata(integer(), map()) ::
          {:ok, Thread.t()}
          | {:error,
             :not_found
             | :invalid_thread_id
             | :invalid_attrs
             | :invalid_title
             | :invalid_labels
             | :invalid_needs_review
             | Ecto.Changeset.t()}
  @spec update_thread_sidebar_metadata(integer(), map(), keyword()) ::
          {:ok, Thread.t()}
          | {:error,
             :not_found
             | :invalid_thread_id
             | :invalid_attrs
             | :invalid_title
             | :invalid_labels
             | :invalid_needs_review
             | Ecto.Changeset.t()}
  def update_thread_sidebar_metadata(id, attrs, opts \\ [])

  def update_thread_sidebar_metadata(id, attrs, opts)
      when is_integer(id) and id > 0 and is_map(attrs) and is_list(opts) do
    mark_user_title = Keyword.get(opts, :mark_user_title, true)

    with {:ok, title_attrs} <- normalize_sidebar_title(attrs),
         {:ok, metadata_patch} <- normalize_sidebar_metadata_patch(attrs),
         metadata_patch <- maybe_put_title_user_set(metadata_patch, title_attrs, mark_user_title),
         {:ok, metadata_patch_json} <- Jason.encode(metadata_patch) do
      persist_sidebar_update(id, title_attrs, metadata_patch_json)
    end
  end

  def update_thread_sidebar_metadata(id, _attrs, _opts) when not is_integer(id) or id <= 0,
    do: {:error, :invalid_thread_id}

  def update_thread_sidebar_metadata(_id, _attrs, _opts), do: {:error, :invalid_attrs}

  @spec delete_thread(integer()) ::
          {:ok, Thread.t()}
          | {:error,
             :not_found
             | :invalid_thread_id
             | :unsupported_scope
             | Ecto.Changeset.t()}
  def delete_thread(id) when is_integer(id) and id > 0 do
    with {:ok, thread} <- get_thread(id),
         :ok <- validate_thread_deletion(thread) do
      thread
      |> Repo.delete(allow_stale: true)
      |> notify_recents()
    end
  end

  def delete_thread(_id), do: {:error, :invalid_thread_id}

  @spec list_messages(String.t()) :: {:ok, [Message.t()]} | {:error, term()}
  def list_messages(project_slug) when is_binary(project_slug) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug) do
      messages =
        case active_thread(normalized_slug) do
          %Thread{id: thread_id} -> messages_for_thread(thread_id)
          nil -> []
        end

      {:ok, messages}
    end
  end

  @append_message_retry_attempts 5

  @spec append_message(Thread.t(), attrs()) :: {:ok, Message.t()} | {:error, Ecto.Changeset.t() | term()}
  def append_message(%Thread{id: thread_id} = thread, attrs) when is_integer(thread_id) and is_map(attrs) do
    append_message_with_retry(thread, attrs, @append_message_retry_attempts)
  end

  @spec copy_messages_to_empty_thread(Thread.t(), [Message.t() | map()]) :: {:ok, Thread.t()} | {:error, term()}
  def copy_messages_to_empty_thread(%Thread{id: thread_id} = target_thread, messages)
      when is_integer(thread_id) and is_list(messages) do
    case list_messages_for_thread(thread_id) do
      [] -> copy_messages(target_thread, messages)
      _existing_messages -> {:ok, target_thread}
    end
  end

  @spec create_freeform_thread(attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def create_freeform_thread(attrs) when is_map(attrs) do
    metadata =
      attrs
      |> Map.get(:metadata, Map.get(attrs, "metadata", %{}))
      |> Map.new()
      |> drop_legacy_model_metadata()
      |> TitleGenerator.put_auto_eligible()

    attrs
    |> put_requested_model_provenance()
    |> drop_legacy_model_attrs()
    |> Map.put(:scope, "freeform")
    |> Map.delete(:project_slug)
    |> Map.put_new(:status, "active")
    |> Map.put_new(:title, SessionTitles.default_title("freeform"))
    |> Map.put(:metadata, metadata)
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
    |> notify_recents()
  end

  @spec create_gateway_freeform_thread(attrs()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
  def create_gateway_freeform_thread(attrs) when is_map(attrs) do
    attrs
    |> Map.put_new(:title, SessionTitles.default_title("freeform"))
    |> create_freeform_thread()
  end

  @spec create_gateway_project_explore_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def create_gateway_project_explore_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, project} <- Context.get_project(normalized_slug),
         {:ok, workspace} <- ProjectExploreWorkspace.ensure(normalized_slug, explore_workspace_opts(attrs)) do
      default_title =
        SessionTitles.default_title("project_explore",
          project_name: project.name,
          project_slug: normalized_slug
        )

      attrs
      |> Map.put(:scope, "project_explore")
      |> Map.put(:project_slug, normalized_slug)
      |> Map.put_new(:workspace_path, workspace)
      |> Map.put_new(:status, "active")
      |> Map.put_new(:title, default_title)
      |> then(&Thread.changeset(%Thread{}, &1))
      |> Repo.insert()
      |> notify_recents()
    end
  end

  @spec create_project_session_thread(String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def create_project_session_thread(project_slug, attrs \\ %{}) when is_binary(project_slug) and is_map(attrs) do
    with {:ok, normalized_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, _project} <- Context.get_project(normalized_slug),
         {:ok, workspace} <- ProjectExploreWorkspace.ensure(normalized_slug, explore_workspace_opts(attrs)) do
      execution_mode = normalize_execution_mode(Map.get(attrs, :execution_mode) || Map.get(attrs, "execution_mode"))

      metadata =
        attrs
        |> Map.get(:metadata, Map.get(attrs, "metadata", %{}))
        |> Map.new()
        |> Map.put("execution_mode", execution_mode)
        |> drop_legacy_model_metadata()
        |> TitleGenerator.put_auto_eligible()

      workspace_basename = workspace |> Path.basename() |> String.trim()

      attrs
      |> put_requested_model_provenance()
      |> Map.drop([:model, "model", :effort, "effort", :execution_mode, "execution_mode"])
      |> Map.put(:scope, "project_session")
      |> Map.put(:project_slug, normalized_slug)
      |> Map.put_new(
        :title,
        SessionTitles.default_title("project_session", workspace_name: workspace_basename)
      )
      |> Map.put_new(:workspace_path, workspace)
      |> Map.put_new(:status, "active")
      |> Map.put(:metadata, metadata)
      |> then(&Thread.changeset(%Thread{}, &1))
      |> Repo.insert()
      |> notify_recents()
    end
  end

  @doc """
  Creates a new build-mode assistant session bound to an issue.

  Unlike the singular `scope: "issue"` authoring thread, many active
  `issue_session` rows may coexist for the same issue identifier.
  """
  @spec create_issue_session_thread(String.t(), String.t(), attrs()) :: {:ok, Thread.t()} | {:error, term()}
  def create_issue_session_thread(project_slug, issue_identifier, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, _project} <- Context.get_project(slug),
         {:ok, workspace_path, workspace_meta} <- issue_session_workspace(slug, identifier, attrs) do
      execution_mode = normalize_execution_mode(Map.get(attrs, :execution_mode) || Map.get(attrs, "execution_mode"))

      metadata =
        attrs
        |> Map.get(:metadata, Map.get(attrs, "metadata", %{}))
        |> Map.new()
        |> Map.put("execution_mode", execution_mode)
        |> drop_legacy_model_metadata()
        |> Map.merge(workspace_meta)
        |> maybe_put_clone_branches(attrs)
        |> TitleGenerator.put_auto_eligible()

      default_title = issue_session_default_title(slug, identifier)

      attrs
      |> put_requested_model_provenance()
      |> Map.drop([
        :isolated_workspace,
        "isolated_workspace",
        :use_parent_workspace,
        "use_parent_workspace",
        :clone_branches,
        "clone_branches",
        :clone_branch,
        "clone_branch",
        :model,
        "model",
        :effort,
        "effort",
        :execution_mode,
        "execution_mode"
      ])
      |> Map.put(:scope, "issue_session")
      |> Map.put(:project_slug, slug)
      |> Map.put(:issue_identifier, identifier)
      |> Map.put_new(:title, default_title)
      |> Map.put(:workspace_path, workspace_path)
      |> Map.put_new(:status, "active")
      |> Map.put(:metadata, metadata)
      |> then(&Thread.changeset(%Thread{}, &1))
      |> Repo.insert()
      |> notify_recents()
    end
  end

  @doc """
  Creates an issue session pinned to an already-existing explicit workspace.

  The caller is responsible for workspace ownership validation. This function
  only persists the supplied path and never creates, moves, or removes a
  workspace.
  """
  @spec create_issue_workspace_session_thread(String.t(), String.t(), String.t(), attrs()) ::
          {:ok, Thread.t()} | {:error, term()}
  def create_issue_workspace_session_thread(project_slug, issue_identifier, workspace_path, attrs \\ %{})
      when is_binary(project_slug) and is_binary(issue_identifier) and is_binary(workspace_path) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, identifier} <- normalize_required_string(issue_identifier, :issue_identifier),
         {:ok, path} <- normalize_required_string(workspace_path, :workspace_path),
         {:ok, workspace_kind} <- explicit_workspace_kind(attrs),
         {:ok, _project} <- Context.get_project(slug),
         {:ok, issue} <- Context.get_issue(slug, identifier) do
      execution_mode = normalize_execution_mode(Map.get(attrs, :execution_mode) || Map.get(attrs, "execution_mode"))

      metadata =
        attrs
        |> Map.get(:metadata, Map.get(attrs, "metadata", %{}))
        |> Map.new()
        |> Map.put("execution_mode", execution_mode)
        |> drop_legacy_model_metadata()
        |> Map.put("workspace_kind", workspace_kind)
        |> TitleGenerator.put_auto_eligible()

      default_title =
        SessionTitles.default_title("issue_session",
          identifier: identifier,
          issue_title: issue.title
        )

      attrs
      |> put_requested_model_provenance()
      |> Map.drop([
        :isolated_workspace,
        "isolated_workspace",
        :use_parent_workspace,
        "use_parent_workspace",
        :model,
        "model",
        :effort,
        "effort",
        :execution_mode,
        "execution_mode"
      ])
      |> Map.put(:scope, "issue_session")
      |> Map.put(:project_slug, slug)
      |> Map.put(:issue_identifier, identifier)
      |> Map.put_new(:title, default_title)
      |> Map.put(:workspace_path, path)
      |> Map.put_new(:status, "active")
      |> Map.put(:metadata, metadata)
      |> then(&Thread.changeset(%Thread{}, &1))
      |> Repo.insert()
      |> notify_recents()
    end
  end

  @doc """
  Creates a project-scoped session thread pinned to an explicit workspace path.

  Used by standalone workspaces: the tree is materialized by the caller
  (`SymphonyElixir.Workspace.Standalone.create/4`), so unlike
  `create_project_session_thread/2` this does not ensure the shared explore
  workspace.
  """
  @spec create_workspace_session_thread(String.t(), String.t(), attrs()) ::
          {:ok, Thread.t()} | {:error, term()}
  def create_workspace_session_thread(project_slug, workspace_path, attrs \\ %{})
      when is_binary(project_slug) and is_binary(workspace_path) and is_map(attrs) do
    with {:ok, slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, path} <- normalize_required_string(workspace_path, :workspace_path),
         {:ok, _project} <- Context.get_project(slug) do
      execution_mode = normalize_execution_mode(Map.get(attrs, :execution_mode) || Map.get(attrs, "execution_mode"))

      metadata =
        attrs
        |> Map.get(:metadata, Map.get(attrs, "metadata", %{}))
        |> Map.new()
        |> Map.put("execution_mode", execution_mode)
        |> drop_legacy_model_metadata()
        |> TitleGenerator.put_auto_eligible()

      workspace_basename = path |> Path.basename() |> String.trim()

      attrs
      |> put_requested_model_provenance()
      |> Map.drop([
        :model,
        "model",
        :effort,
        "effort",
        :execution_mode,
        "execution_mode"
      ])
      |> Map.put(:scope, "project_session")
      |> Map.put(:project_slug, slug)
      |> Map.put_new(
        :title,
        SessionTitles.default_title("project_session", workspace_name: workspace_basename)
      )
      |> Map.put(:workspace_path, path)
      |> Map.put_new(:status, "active")
      |> Map.put(:metadata, metadata)
      |> then(&Thread.changeset(%Thread{}, &1))
      |> Repo.insert()
      |> notify_recents()
    end
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
    |> filter_scopes(Keyword.get(opts, :scopes))
    |> filter_project(Keyword.get(opts, :project_slug))
    |> filter_issue_identifier(Keyword.get(opts, :issue_identifier))
    |> filter_archived(Keyword.get(opts, :include_archived, false))
    |> order_threads(Keyword.get(opts, :order, :updated_at))
    |> limit(^Keyword.get(opts, :limit, 50))
    |> Repo.all()
  end

  # `:activity` keeps in-progress threads in the fetch window ahead of idle/closed
  # ones so project-session pagination does not drop live work.
  defp order_threads(query, :activity) do
    order_by(query, [t],
      asc:
        fragment(
          "CASE ? WHEN 'active' THEN 0 WHEN 'error' THEN 1 WHEN 'closed' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END",
          t.status
        ),
      desc: t.updated_at,
      desc: t.id
    )
  end

  defp order_threads(query, _order) do
    order_by(query, [t], desc: t.updated_at, desc: t.id)
  end

  @doc """
  Returns the most recently updated active freeform thread, or `nil` when none
  exist. Used by the docked Maestro host to bind home/observability to a single
  shared freeform conversation.
  """
  @spec latest_freeform_thread() :: Thread.t() | nil
  def latest_freeform_thread do
    case list_threads(scope: "freeform", limit: 1) do
      [thread | _] -> thread
      [] -> nil
    end
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

  @spec list_messages_for_thread(integer()) :: [Message.t()]
  def list_messages_for_thread(thread_id) when is_integer(thread_id),
    do: list_messages_for_thread(thread_id, [])

  @doc """
  Lists a thread's messages in ascending `sequence` order.

  Options:

    * `:limit` — when a positive integer, returns only the newest `limit`
      messages (still ascending). Defaults to all messages.
    * `:before_sequence` — when an integer, restricts to messages with
      `sequence < before_sequence` (used to page older messages).
  """
  @spec list_messages_for_thread(integer(), keyword()) :: [Message.t()]
  def list_messages_for_thread(thread_id, opts) when is_integer(thread_id) and is_list(opts) do
    base =
      Message
      |> where([m], m.thread_id == ^thread_id)
      |> maybe_before_sequence(Keyword.get(opts, :before_sequence))

    case Keyword.get(opts, :limit) do
      limit when is_integer(limit) and limit > 0 ->
        base
        |> order_by([m], desc: m.sequence)
        |> limit(^limit)
        |> Repo.all()
        |> Enum.reverse()

      _ ->
        base
        |> order_by([m], asc: m.sequence)
        |> Repo.all()
    end
  end

  @doc """
  Returns true when the thread has at least one message older than `sequence`.
  """
  @spec has_messages_before?(integer(), integer()) :: boolean()
  def has_messages_before?(thread_id, sequence)
      when is_integer(thread_id) and is_integer(sequence) do
    Message
    |> where([m], m.thread_id == ^thread_id and m.sequence < ^sequence)
    |> Repo.exists?()
  end

  defp maybe_before_sequence(query, before_sequence) when is_integer(before_sequence),
    do: where(query, [m], m.sequence < ^before_sequence)

  defp maybe_before_sequence(query, _before_sequence), do: query

  @spec message_payload(Message.t()) :: map()
  def message_payload(%Message{} = message), do: message_payload(message, [])

  @doc """
  Builds a channel/REST payload for a single message.

  Options:

    * `:cap_tool_output_bytes` — when a positive integer, oversized tool-call
      `output` strings are truncated to that many bytes (on a valid UTF-8
      boundary) and annotated with `"output_truncated" => true` plus
      `"output_byte_size" => original_size`. The full output stays fetchable via
      `tool_call_output/2`. Defaults to no cap so REST and live pushes are
      unchanged.
  """
  @spec message_payload(Message.t(), keyword()) :: map()
  def message_payload(%Message{} = message, opts) when is_list(opts) do
    %{
      id: message.id,
      role: message.role,
      content: message.content,
      sequence: message.sequence,
      run_id: message.run_id,
      tool_calls: payload_tool_calls(message, opts),
      content_blocks: message_content_blocks(message),
      metadata: message.metadata || %{},
      inserted_at: message.inserted_at
    }
  end

  @doc """
  Returns the full (uncapped) `output` string for a single tool call within a
  thread's message, or `{:error, :not_found}` when the message/tool call does
  not exist for that thread.
  """
  @spec tool_call_output(integer(), integer(), String.t()) ::
          {:ok, %{output: String.t(), output_byte_size: non_neg_integer()}}
          | {:error, :not_found}
  def tool_call_output(thread_id, message_id, tool_call_id)
      when is_integer(thread_id) and is_integer(message_id) and is_binary(tool_call_id) do
    message =
      Message
      |> where([m], m.thread_id == ^thread_id and m.id == ^message_id)
      |> Repo.one()

    with %Message{} = message <- message,
         %{} = call <- find_tool_call(tool_calls(message), tool_call_id) do
      output = tool_call_output_string(call)
      {:ok, %{output: output, output_byte_size: byte_size(output)}}
    else
      _ -> {:error, :not_found}
    end
  end

  defp payload_tool_calls(message, opts) do
    calls = tool_calls(message)

    case Keyword.get(opts, :cap_tool_output_bytes) do
      cap when is_integer(cap) and cap > 0 -> Enum.map(calls, &cap_tool_call_output(&1, cap))
      _ -> calls
    end
  end

  defp find_tool_call(calls, tool_call_id) when is_list(calls) do
    Enum.find(calls, fn call ->
      is_map(call) and (Map.get(call, "id") == tool_call_id or Map.get(call, :id) == tool_call_id)
    end)
  end

  defp tool_call_output_string(call) do
    case Map.get(call, "output", Map.get(call, :output)) do
      value when is_binary(value) -> value
      _ -> ""
    end
  end

  # Truncate oversized tool outputs so the transcript payload stays small on
  # reload; the untruncated output remains fetchable via `tool_call_output/2`.
  defp cap_tool_call_output(call, cap) when is_map(call) do
    cond do
      is_binary(Map.get(call, "output")) -> cap_output_key(call, "output", cap)
      is_binary(Map.get(call, :output)) -> cap_output_key(call, :output, cap)
      true -> call
    end
  end

  defp cap_tool_call_output(call, _cap), do: call

  defp cap_output_key(call, key, cap) do
    output = Map.fetch!(call, key)
    size = byte_size(output)

    if size > cap do
      call
      |> Map.put(key, truncate_utf8(output, cap) <> tool_output_truncation_marker(size))
      |> Map.put("output_truncated", true)
      |> Map.put("output_byte_size", size)
    else
      call
    end
  end

  defp tool_output_truncation_marker(size) do
    "\n\n… (output truncated; #{size} bytes total — load full output to see the rest)"
  end

  defp truncate_utf8(binary, cap) when byte_size(binary) <= cap, do: binary

  defp truncate_utf8(binary, cap) do
    binary
    |> binary_part(0, cap)
    |> valid_utf8_prefix()
  end

  defp valid_utf8_prefix(binary) do
    cond do
      String.valid?(binary) -> binary
      byte_size(binary) == 0 -> ""
      true -> valid_utf8_prefix(binary_part(binary, 0, byte_size(binary) - 1))
    end
  end

  defp message_content_blocks(%Message{metadata: metadata} = message) when is_map(metadata) do
    blocks = Map.get(metadata, "content_blocks") || Map.get(metadata, :content_blocks)

    if TurnTimeline.valid_content_blocks?(blocks, message.content, tool_calls(message)),
      do: blocks,
      else: []
  end

  defp message_content_blocks(_message), do: []

  defp patch_current_turn(%Thread{} = thread, fun) do
    mutate_metadata(thread, fn current ->
      case current_turn(current) do
        nil ->
          {:noop, nil}

        turn ->
          metadata =
            Map.put(current.metadata || %{}, @current_turn_key, fun.(turn))

          {:update, metadata, nil}
      end
    end)
    |> without_mutation_value()
  end

  defp patch_running_turn(%Thread{} = thread, fun) do
    case current_turn(thread) do
      %{"status" => "running"} = expected_turn ->
        expected_identity = turn_identity(expected_turn)

        mutate_metadata(thread, fn current ->
          case current_turn(current) do
            %{"status" => "running"} = turn ->
              if turn_identity(turn) == expected_identity do
                metadata =
                  Map.put(current.metadata || %{}, @current_turn_key, fun.(turn))

                {:update, metadata, nil}
              else
                {:noop, nil}
              end

            _ ->
              {:noop, nil}
          end
        end)
        |> without_mutation_value()

      _ ->
        {:ok, thread}
    end
  end

  defp mutate_metadata(thread, mutation, retries_left \\ @cas_retries)

  defp mutate_metadata(%Thread{id: thread_id}, mutation, retries_left)
       when is_integer(thread_id) and is_function(mutation, 1) and retries_left >= 0 do
    with {:ok, current} <- get_thread(thread_id) do
      case mutation.(current) do
        {:noop, value} ->
          {:ok, current, value}

        {:update, metadata, value} when is_map(metadata) ->
          updated_at = DateTime.utc_now()

          query =
            from(candidate in Thread,
              where:
                candidate.id == ^current.id and
                  candidate.updated_at == ^current.updated_at
            )

          case Repo.update_all(
                 query,
                 set: [metadata: metadata, updated_at: updated_at]
               ) do
            {1, _rows} ->
              with {:ok, updated} <- get_thread(current.id) do
                _ = notify_recents({:ok, updated})
                {:ok, updated, value}
              end

            {0, _rows} when retries_left > 0 ->
              mutate_metadata(current, mutation, retries_left - 1)

            {0, _rows} ->
              {:error, :thread_metadata_conflict}
          end

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp mutate_provider_bindings(thread, mutation, retries_left \\ @cas_retries)

  defp mutate_provider_bindings(%Thread{id: thread_id}, mutation, retries_left)
       when is_integer(thread_id) and is_function(mutation, 1) and retries_left >= 0 do
    with {:ok, current} <- get_thread(thread_id) do
      bindings = mutation.(current)
      updated_at = DateTime.utc_now()

      query =
        from(candidate in Thread,
          where:
            candidate.id == ^current.id and
              candidate.updated_at == ^current.updated_at
        )

      case Repo.update_all(
             query,
             set: [provider_bindings: bindings, updated_at: updated_at]
           ) do
        {1, _rows} ->
          with {:ok, updated} <- get_thread(current.id) do
            _ = notify_recents({:ok, updated})
            {:ok, updated}
          end

        {0, _rows} when retries_left > 0 ->
          mutate_provider_bindings(current, mutation, retries_left - 1)

        {0, _rows} ->
          {:error, :provider_bindings_conflict}
      end
    end
  end

  defp without_mutation_value({:ok, thread, _value}), do: {:ok, thread}
  defp without_mutation_value({:error, _reason} = error), do: error

  defp maybe_put_run_conversation_ref(thread, attrs) do
    provider = Map.get(attrs, :provider) || Map.get(attrs, "provider")
    conversation_id = Map.get(attrs, :conversation_id) || Map.get(attrs, "conversation_id")

    case ConversationRef.new(provider, conversation_id) do
      {:ok, ref} -> put_conversation_ref(thread, ref)
      {:error, reason} -> {:error, reason}
    end
  end

  defp interrupt_same_running_turn(thread, turn, identity, reason, retries_left) do
    interrupted_turn =
      turn
      |> Map.put("status", "interrupted")
      |> Map.put("interrupted_reason", reason)
      |> Map.put("finished_at", now_iso())
      |> Map.put("active_tools", [])

    metadata = Map.put(thread.metadata || %{}, @current_turn_key, interrupted_turn)
    updated_at = DateTime.utc_now()

    query =
      from(t in Thread,
        where: t.id == ^thread.id and t.updated_at == ^thread.updated_at
      )

    case Repo.update_all(query, set: [metadata: metadata, updated_at: updated_at]) do
      {1, _rows} ->
        get_thread(thread.id)

      {0, _rows} ->
        reconcile_interrupt_conflict(thread.id, identity, reason, retries_left)
    end
  end

  defp reconcile_interrupt_conflict(thread_id, identity, reason, retries_left) do
    with {:ok, current_thread} <- get_thread(thread_id) do
      case current_turn(current_thread) do
        %{"status" => "running"} = current_turn when retries_left > 0 ->
          if turn_identity(current_turn) == identity do
            interrupt_same_running_turn(
              current_thread,
              current_turn,
              identity,
              reason,
              retries_left - 1
            )
          else
            {:already_finished, current_thread}
          end

        %{"status" => "running"} = current_turn ->
          if turn_identity(current_turn) == identity,
            do: {:error, :turn_interrupt_conflict},
            else: {:already_finished, current_thread}

        _ ->
          {:already_finished, current_thread}
      end
    end
  end

  defp turn_identity(turn) when is_map(turn) do
    {
      Map.get(turn, "started_at"),
      Map.get(turn, "execution_id"),
      Map.get(turn, "trigger"),
      Map.get(turn, "prompt")
    }
  end

  defp active_tools(%{"active_tools" => tools}) when is_list(tools) do
    Enum.filter(tools, &is_map/1)
  end

  defp active_tools(%{"active_tools" => nil}), do: []
  defp active_tools(_turn), do: []

  defp stringify_tool(tool) when is_map(tool) do
    %{}
    |> put_tool_field("id", field_any(tool, "id"))
    |> put_tool_field("name", field_any(tool, "name"))
    |> put_tool_field("arguments_summary", field_any(tool, "arguments_summary"))
    |> put_tool_field("started_at", field_any(tool, "started_at"))
  end

  defp put_tool_field(tool, _key, nil), do: tool
  defp put_tool_field(tool, key, value), do: Map.put(tool, key, stringify(value))

  defp active_tool_id!(tool) do
    case field_any(tool, "id") do
      id when is_binary(id) ->
        case String.trim(id) do
          "" -> raise ArgumentError, "active tool requires id"
          trimmed -> trimmed
        end

      nil ->
        raise ArgumentError, "active tool requires id"

      id ->
        id
        |> stringify()
        |> active_tool_id_from_string!()
    end
  end

  defp active_tool_id_from_string!(""), do: raise(ArgumentError, "active tool requires id")
  defp active_tool_id_from_string!(id), do: id

  defp merge_run_identity(turn, attrs) do
    provider = stringify(Map.get(attrs, :provider)) || turn["provider"]
    conversation_id = stringify(Map.get(attrs, :conversation_id)) || turn["conversation_id"]
    run_id = stringify(Map.get(attrs, :run_id)) || turn["run_id"]

    # The execution is a Symphony-owned attempt. A provider result must never
    # replace the execution_id assigned when the durable turn was started.
    execution_id = turn["execution_id"] || stringify(Map.get(attrs, :execution_id))

    turn
    |> Map.put("provider", provider)
    |> Map.put("conversation_id", conversation_id)
    |> Map.put("run_id", run_id)
    |> Map.put("execution_id", execution_id)
  end

  defp pending_turn_entry(prompt, provider, attrs) do
    %{
      "id" => "q-#{System.unique_integer([:positive, :monotonic])}",
      "prompt" => prompt,
      "trigger" => stringify(Map.get(attrs, :trigger)) || "user",
      "provider" => provider,
      "model" => stringify(Map.get(attrs, :model)),
      "effort" => stringify(Map.get(attrs, :effort)),
      "context" => serializable_context(Map.get(attrs, :context)),
      "queued_at" => now_iso()
    }
  end

  defp serializable_context(context) when is_map(context), do: stringify_map_keys(context)
  defp serializable_context(_context), do: %{}

  defp stringify_map_keys(map) do
    Map.new(map, fn {key, value} -> {to_string(key), value} end)
  end

  defp valid_pending_turn?(%{"id" => id, "prompt" => prompt, "provider" => provider})
       when is_binary(id) and id != "" and is_binary(prompt) and prompt != "" and
              is_binary(provider),
       do: provider in ConversationRef.providers()

  defp valid_pending_turn?(_entry), do: false

  defp normalize_pending_provider(provider) when is_binary(provider) do
    normalized = String.trim(provider)

    cond do
      normalized == "" -> {:error, :provider_required}
      normalized in ConversationRef.providers() -> {:ok, normalized}
      true -> {:error, {:unsupported_provider, normalized}}
    end
  end

  defp normalize_pending_provider(_provider), do: {:error, :provider_required}

  defp public_error_payload(error) when is_map(error) do
    %{
      code: error["code"],
      category: error["category"],
      retryable: error["retryable"] == true,
      message: error["message"],
      details: error["details"] || %{}
    }
  end

  defp public_error_payload(_error), do: nil

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp stringify(nil), do: nil
  defp stringify(value) when is_binary(value), do: value
  defp stringify(value), do: to_string(value)

  defp turn_error_text(reason) when is_binary(reason), do: reason
  defp turn_error_text(reason), do: inspect(reason)

  defp active_thread(project_slug) do
    Repo.get_by(Thread, project_slug: project_slug, scope: "project", status: "active")
  end

  defp active_project_explore_thread(project_slug) do
    Repo.get_by(Thread, project_slug: project_slug, scope: "project_explore", status: "active")
  end

  defp active_kb_thread(project_slug, page_key) do
    Thread
    |> where([t], t.project_slug == ^project_slug and t.scope == "kb" and t.status == "active")
    |> where([t], fragment("json_extract(?, '$.kb_page_key')", t.metadata) == ^page_key)
    |> limit(1)
    |> Repo.one()
  end

  # The personal KB (`@user`) is a pseudo-project with no tracker row, so its KB
  # assistant thread is allowed without a `Context.get_project/1` lookup.
  defp ensure_kb_project_scope("@user"), do: {:ok, :general}
  defp ensure_kb_project_scope(slug), do: Context.get_project(slug)

  defp kb_workspace(project_slug) do
    root = SymphonyElixir.Config.workspace_root() |> Path.expand()
    Path.join([root, "assistant", "kb", safe_workspace_segment(project_slug)])
  end

  defp kb_thread_title(page_path) do
    page_path
    |> Path.basename()
    |> String.replace(~r/\.md$/i, "")
  end

  defp issue_session_default_title(slug, identifier) do
    issue_title =
      case Context.get_issue(slug, identifier) do
        {:ok, issue} -> issue.title
        _ -> nil
      end

    SessionTitles.default_title("issue_session", identifier: identifier, issue_title: issue_title)
  end

  defp safe_workspace_segment(value) when is_binary(value) do
    case String.replace(value, ~r/[^a-zA-Z0-9_-]/, "_") do
      "" -> "project"
      sanitized -> sanitized
    end
  end

  defp active_issue_thread(slug, identifier) do
    Repo.get_by(Thread,
      project_slug: slug,
      issue_identifier: identifier,
      scope: "issue",
      status: "active"
    )
  end

  defp create_issue_thread(slug, identifier, attrs) do
    attrs
    |> Map.put(:scope, "issue")
    |> Map.put(:project_slug, slug)
    |> Map.put(:issue_identifier, identifier)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
    |> notify_recents()
  end

  defp promote_active_project_thread(slug, identifier, attrs) do
    case {active_issue_thread(slug, identifier), active_thread(slug)} do
      {%Thread{} = issue_thread, %Thread{} = project_thread} ->
        fold_project_thread_into_issue(issue_thread, project_thread)

      {%Thread{} = issue_thread, nil} ->
        {:ok, issue_thread}

      {nil, %Thread{} = project_thread} ->
        upgrade_thread_to_issue(project_thread, identifier, attrs)

      {nil, nil} ->
        create_issue_thread(slug, identifier, attrs)
    end
  end

  defp fold_project_thread_into_issue(%Thread{} = issue_thread, %Thread{} = project_thread) do
    project_messages = list_messages_for_thread(project_thread.id)

    with {:ok, _filled} <- copy_messages_to_empty_thread(issue_thread, project_messages),
         {:ok, _closed} <- close_thread(project_thread) do
      {:ok, issue_thread}
    end
  end

  defp upgrade_thread_to_issue(%Thread{} = project_thread, identifier, attrs) do
    workspace_path = Map.get(attrs, :workspace_path) || project_thread.workspace_path

    project_thread
    |> Thread.changeset(%{
      scope: "issue",
      issue_identifier: identifier,
      workspace_path: workspace_path
    })
    |> Repo.update()
    |> notify_recents()
  end

  defp close_thread(%Thread{} = thread) do
    thread
    |> Thread.changeset(%{status: "closed"})
    |> Repo.update()
    |> notify_recents()
  end

  defp draft_identifier_from_thread(thread_id) when is_integer(thread_id) do
    Message
    |> where([m], m.thread_id == ^thread_id)
    |> order_by([m], desc: m.sequence)
    |> Repo.all()
    |> Enum.find_value(&draft_identifier_from_message/1)
  end

  defp draft_identifier_from_message(%Message{} = message) do
    message
    |> tool_calls()
    |> Enum.find_value(fn call ->
      if draft_tool_call?(call) and tool_call_succeeded?(call) do
        draft_identifier_from_call(call)
      end
    end)
  end

  @issue_authoring_tools ~w(create_draft_issue create_issue)

  defp draft_tool_call?(call) when is_map(call) do
    nested_tool = call |> field_any("result") |> field_any("tool")

    field_any(call, "name") in @issue_authoring_tools or
      field_any(call, "tool") in @issue_authoring_tools or
      nested_tool in @issue_authoring_tools
  end

  defp draft_tool_call?(_call), do: false

  defp tool_call_succeeded?(call) when is_map(call) do
    field_any(call, "status") in [nil, "complete", "completed", "ok"]
  end

  defp tool_call_succeeded?(_call), do: false

  defp draft_identifier_from_call(call), do: identifier_from(call)

  # Walks the assorted shapes Codex app-server / runner emit for a tool result:
  # `data.identifier`, `result.toolResult.data.identifier`, or a JSON blob inside
  # `contentItems[].text`.
  defp identifier_from(value) when is_map(value) do
    direct =
      field_any(value, "identifier") || field_any(value, "issue_identifier") ||
        field_any(value, "issueIdentifier")

    case normalize_identifier(direct) do
      {:ok, identifier} ->
        identifier

      :error ->
        identifier_from(field_any(value, "data")) ||
          identifier_from(field_any(value, "result")) ||
          identifier_from(field_any(value, "toolResult")) ||
          identifier_from(field_any(value, "issue")) ||
          identifier_from_content(field_any(value, "contentItems"))
    end
  end

  defp identifier_from(_value), do: nil

  defp identifier_from_content(items) when is_list(items) do
    Enum.find_value(items, fn item ->
      item |> field_any("text") |> decode_identifier_text()
    end)
  end

  defp identifier_from_content(_items), do: nil

  defp decode_identifier_text(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, decoded} -> identifier_from(decoded)
      _ -> nil
    end
  end

  defp decode_identifier_text(_text), do: nil

  defp normalize_identifier(value) when is_binary(value) do
    case String.trim(value) do
      "" -> :error
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_identifier(_value), do: :error

  defp field_any(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, safe_existing_atom(key))
  end

  defp field_any(_map, _key), do: nil

  defp safe_existing_atom(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> nil
  end

  defp filter_scope(query, nil), do: query
  defp filter_scope(query, scope) when is_binary(scope), do: where(query, [t], t.scope == ^scope)

  defp filter_scopes(query, nil), do: query
  defp filter_scopes(query, []), do: query

  defp filter_scopes(query, scopes) when is_list(scopes) do
    where(query, [t], t.scope in ^scopes)
  end

  defp filter_project(query, nil), do: query
  defp filter_project(query, slug) when is_binary(slug), do: where(query, [t], t.project_slug == ^slug)

  defp filter_issue_identifier(query, nil), do: query

  defp filter_issue_identifier(query, identifier) when is_binary(identifier) do
    where(query, [t], t.issue_identifier == ^identifier)
  end

  defp filter_archived(query, true), do: query
  defp filter_archived(query, _), do: where(query, [t], t.status != "archived")

  defp normalize_sidebar_title(attrs) do
    case fetch_sidebar_attr(attrs, :title) do
      :missing ->
        {:ok, %{}}

      {:ok, title} when is_binary(title) ->
        normalized_title = String.trim(title)

        if normalized_title != "" and String.length(normalized_title) <= @sidebar_title_max_graphemes,
          do: {:ok, %{title: normalized_title}},
          else: {:error, :invalid_title}

      {:ok, _title} ->
        {:error, :invalid_title}
    end
  end

  defp maybe_put_title_user_set(patch, %{title: _}, true), do: Map.put(patch, "title_user_set", true)
  defp maybe_put_title_user_set(patch, _title_attrs, _mark_user_title), do: patch

  defp normalize_sidebar_metadata_patch(attrs) do
    with {:ok, patch} <- put_sidebar_labels(%{}, attrs),
         {:ok, patch} <- put_sidebar_needs_review(patch, attrs) do
      {:ok, patch}
    end
  end

  defp persist_sidebar_update(id, %{title: title}, metadata_patch_json) do
    updated_at = DateTime.utc_now()

    query =
      from(thread in Thread,
        where: thread.id == ^id,
        update: [
          set: [
            title: ^title,
            metadata:
              fragment(
                "json_patch(COALESCE(?, '{}'), json(?))",
                thread.metadata,
                ^metadata_patch_json
              ),
            updated_at: ^updated_at
          ]
        ]
      )

    execute_sidebar_update(query, id)
  end

  defp persist_sidebar_update(id, %{}, metadata_patch_json) do
    updated_at = DateTime.utc_now()

    query =
      from(thread in Thread,
        where: thread.id == ^id,
        update: [
          set: [
            metadata:
              fragment(
                "json_patch(COALESCE(?, '{}'), json(?))",
                thread.metadata,
                ^metadata_patch_json
              ),
            updated_at: ^updated_at
          ]
        ]
      )

    execute_sidebar_update(query, id)
  end

  defp execute_sidebar_update(query, id) do
    case Repo.update_all(query, []) do
      {1, _rows} -> get_thread(id) |> notify_recents()
      {0, _rows} -> {:error, :not_found}
    end
  end

  defp put_sidebar_labels(metadata, attrs) do
    case fetch_sidebar_attr(attrs, :labels) do
      :missing ->
        {:ok, metadata}

      {:ok, labels} when is_list(labels) ->
        normalize_sidebar_labels(labels)
        |> case do
          {:ok, normalized_labels} -> {:ok, Map.put(metadata, "sidebar_labels", normalized_labels)}
          {:error, :invalid_labels} = error -> error
        end

      {:ok, _labels} ->
        {:error, :invalid_labels}
    end
  end

  defp normalize_sidebar_labels(labels) do
    if Enum.all?(labels, &is_binary/1) do
      normalized_labels =
        labels
        |> Enum.map(&String.trim/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.uniq()

      valid? =
        length(normalized_labels) <= @sidebar_label_count_max and
          Enum.all?(normalized_labels, &(String.length(&1) <= @sidebar_label_max_graphemes))

      if valid?, do: {:ok, normalized_labels}, else: {:error, :invalid_labels}
    else
      {:error, :invalid_labels}
    end
  end

  defp put_sidebar_needs_review(metadata, attrs) do
    case fetch_sidebar_attr(attrs, :needs_review) do
      :missing -> {:ok, metadata}
      {:ok, needs_review} when is_boolean(needs_review) -> {:ok, Map.put(metadata, "sidebar_needs_review", needs_review)}
      {:ok, _needs_review} -> {:error, :invalid_needs_review}
    end
  end

  defp fetch_sidebar_attr(attrs, key) do
    cond do
      Map.has_key?(attrs, key) -> {:ok, Map.get(attrs, key)}
      Map.has_key?(attrs, Atom.to_string(key)) -> {:ok, Map.get(attrs, Atom.to_string(key))}
      true -> :missing
    end
  end

  defp validate_thread_deletion(%Thread{scope: scope}) when scope not in @deletable_scopes,
    do: {:error, :unsupported_scope}

  defp validate_thread_deletion(%Thread{}), do: :ok

  defp append_message_with_retry(thread, attrs, attempts_left) do
    case catch_append_message_once(thread, attrs) do
      {:error, reason} when attempts_left > 1 ->
        if append_message_retryable?(reason) do
          Process.sleep(append_message_retry_backoff(attempts_left))
          append_message_with_retry(thread, attrs, attempts_left - 1)
        else
          {:error, reason}
        end

      result ->
        result
    end
  end

  defp catch_append_message_once(thread, attrs) do
    try do
      append_message_once(thread, attrs)
    catch
      :error, %Exqlite.Error{} = reason ->
        {:error, reason}
    end
  end

  defp append_message_once(%Thread{id: thread_id} = thread, attrs) do
    Repo.transaction(
      fn ->
        next_sequence = next_sequence(thread)

        attrs
        |> normalize_message_attrs()
        |> Map.merge(%{thread_id: thread_id, sequence: next_sequence})
        |> insert_message()
        |> case do
          {:ok, message} -> message
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end,
      mode: :immediate
    )
  end

  defp create_thread(project_slug, attrs) do
    attrs
    |> Map.put(:project_slug, project_slug)
    |> Map.put_new(:status, "active")
    |> then(&Thread.changeset(%Thread{}, &1))
    |> Repo.insert()
    |> notify_recents()
  end

  defp messages_for_thread(thread_id) do
    Message
    |> where([message], message.thread_id == ^thread_id)
    |> order_by([message], asc: message.sequence)
    |> Repo.all()
    |> Enum.map(&public_message/1)
  end

  defp next_sequence(%Thread{id: thread_id}) do
    Message
    |> where([message], message.thread_id == ^thread_id)
    |> select([message], max(message.sequence))
    |> Repo.one()
    |> case do
      nil -> 1
      sequence -> sequence + 1
    end
  end

  defp insert_message(attrs) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, message} -> {:ok, public_message(message)} |> notify_recents()
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp notify_recents({:ok, _result} = result) do
    :ok = RecentsBroadcaster.notify()
    result
  end

  defp notify_recents(result), do: result

  defp public_message(%Message{} = message), do: %{message | tool_calls: tool_calls(message)}

  defp copy_messages(target_thread, messages) do
    Enum.reduce_while(messages, {:ok, target_thread}, fn message, {:ok, thread} ->
      case append_message(thread, copy_message_attrs(message)) do
        {:ok, _message} -> {:cont, {:ok, thread}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp copy_message_attrs(%Message{} = message) do
    %{
      role: message.role,
      content: message.content,
      metadata: message.metadata || %{},
      tool_calls: tool_calls(message),
      run_id: message.run_id
    }
  end

  defp copy_message_attrs(message) when is_map(message) do
    %{
      role: Map.get(message, :role) || Map.get(message, "role"),
      content: Map.get(message, :content) || Map.get(message, "content"),
      metadata: Map.get(message, :metadata) || Map.get(message, "metadata") || %{},
      tool_calls: Map.get(message, :tool_calls) || Map.get(message, "tool_calls") || [],
      run_id: Map.get(message, :run_id) || Map.get(message, "run_id")
    }
  end

  defp explore_workspace_opts(attrs) when is_map(attrs) do
    attrs
    |> Map.take([:git])
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
  end

  defp append_message_retryable?(%Ecto.Changeset{} = changeset), do: unique_sequence_error?(changeset)
  defp append_message_retryable?(%Exqlite.Error{message: "Database busy"}), do: true
  defp append_message_retryable?(_reason), do: false

  defp append_message_retry_backoff(attempts_left) do
    base = 25 * (@append_message_retry_attempts - attempts_left + 1)
    base + :rand.uniform(50)
  end

  defp unique_sequence_error?(%Ecto.Changeset{errors: errors}) do
    Enum.any?(errors, fn
      {:sequence, {_message, opts}} -> opts[:constraint] == :unique
      _ -> false
    end)
  end

  defp normalize_message_attrs(attrs) do
    tool_calls = Map.get(attrs, :tool_calls, Map.get(attrs, "tool_calls", []))
    metadata = Map.get(attrs, :metadata, Map.get(attrs, "metadata", %{}))

    client_message_id =
      Map.get(metadata, "client_message_id", Map.get(metadata, :client_message_id))

    attrs
    |> Map.delete(:tool_calls)
    |> Map.delete("tool_calls")
    |> Map.put(:tool_calls, normalize_tool_calls(tool_calls))
    |> maybe_put_client_message_id(client_message_id)
  end

  defp maybe_put_client_message_id(attrs, value) when is_binary(value) and value != "",
    do: Map.put(attrs, :client_message_id, value)

  defp maybe_put_client_message_id(attrs, _value), do: attrs

  defp normalize_tool_calls(tool_calls) when is_list(tool_calls), do: %{"calls" => tool_calls}
  defp normalize_tool_calls(%{"calls" => calls}) when is_list(calls), do: %{"calls" => calls}
  defp normalize_tool_calls(%{calls: calls}) when is_list(calls), do: %{"calls" => calls}
  defp normalize_tool_calls(_tool_calls), do: %{"calls" => []}

  defp tool_calls(%Message{tool_calls: %{"calls" => calls}}) when is_list(calls), do: calls
  defp tool_calls(%Message{tool_calls: %{calls: calls}}) when is_list(calls), do: calls
  defp tool_calls(%Message{tool_calls: calls}) when is_list(calls), do: calls
  defp tool_calls(_message), do: []

  defp normalize_required_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_required_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_required_string(_value, field), do: {:error, {:missing_required_field, field}}

  defp normalize_execution_mode(mode), do: ExecutionMode.normalize(mode)

  defp explicit_workspace_kind(attrs) do
    case Map.get(attrs, :workspace_kind, Map.get(attrs, "workspace_kind")) do
      kind when kind in ["shared", "isolated"] -> {:ok, kind}
      _kind -> {:error, {:invalid_field, :workspace_kind}}
    end
  end

  # Default: the session shares the issue's canonical working tree
  # (`…/<issue>`). Options:
  # - `isolated_workspace: true` → sibling `…/<issue>__p<N>` (parallel, no collision)
  # - `use_parent_workspace: true` → parent's canonical tree (subtasks only)
  defp issue_session_workspace(slug, identifier, attrs) do
    issue_ref = %{identifier: identifier, project_slug: slug}

    cond do
      isolated_workspace?(attrs) ->
        {:ok, Workspace.next_parallel_path(issue_ref), %{"workspace_kind" => "isolated"}}

      use_parent_workspace?(attrs) ->
        parent_issue_workspace_path(slug, identifier)

      true ->
        {:ok, Workspace.path_for_issue(issue_ref), %{"workspace_kind" => "shared"}}
    end
  end

  defp parent_issue_workspace_path(slug, identifier) do
    with {:ok, issue} <- Context.get_issue(slug, identifier),
         dto <- IssueAdapter.to_dto(issue),
         parent when is_binary(parent) and parent != "" <- dto.parent_identifier do
      parent_ref = %{identifier: parent, project_slug: slug}
      parent_path = Workspace.path_for_issue(parent_ref)
      {:ok, parent_path, %{"workspace_kind" => "parent", "parent_workspace_issue" => parent}}
    else
      nil -> {:error, :no_parent_issue}
      {:error, :issue_not_found} -> {:error, :issue_not_found}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :no_parent_issue}
    end
  end

  defp isolated_workspace?(attrs) do
    Map.get(attrs, :isolated_workspace, Map.get(attrs, "isolated_workspace")) == true
  end

  defp use_parent_workspace?(attrs) do
    Map.get(attrs, :use_parent_workspace, Map.get(attrs, "use_parent_workspace")) == true
  end

  defp maybe_put_clone_branches(metadata, attrs) do
    case normalize_clone_branches(attrs) do
      branches when map_size(branches) > 0 -> Map.put(metadata, "clone_branches", branches)
      _ -> metadata
    end
  end

  defp normalize_clone_branches(attrs) when is_map(attrs) do
    case Map.get(attrs, :clone_branches, Map.get(attrs, "clone_branches")) do
      branches when is_map(branches) ->
        branches
        |> Enum.reduce(%{}, fn
          {key, value}, acc when is_binary(key) and is_binary(value) ->
            case String.trim(value) do
              "" -> acc
              branch -> Map.put(acc, String.trim(key), branch)
            end

          _, acc ->
            acc
        end)

      _ ->
        case Map.get(attrs, :clone_branch, Map.get(attrs, "clone_branch")) do
          branch when is_binary(branch) ->
            case String.trim(branch) do
              "" -> %{}
              trimmed -> %{"__default__" => trimmed}
            end

          _ ->
            %{}
        end
    end
  end
end
