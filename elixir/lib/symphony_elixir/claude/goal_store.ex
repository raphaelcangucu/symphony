defmodule SymphonyElixir.Claude.GoalStore do
  @moduledoc false

  @execution_file ".symphony/claude-goal.json"
  @max_objective_bytes 4000
  @active_statuses ["starting", "running", "paused", "blocked", "failed"]
  @terminal_statuses ["completed", "budgetLimited", "usageLimited"]
  @stored_statuses @active_statuses ++ @terminal_statuses

  @type role :: :execution | :authoring

  @doc "Returns whether a status belongs to the durable Claude goal lifecycle."
  @spec canonical_status?(term()) :: boolean()
  def canonical_status?(status), do: status in @stored_statuses

  @doc "Returns whether a canonical status represents a persisted native goal."
  @spec native_goal_exists?(term()) :: boolean()
  def native_goal_exists?(status), do: canonical_status?(status)

  @doc "Returns whether a native goal can continue or be retried."
  @spec active_status?(term()) :: boolean()
  def active_status?(status), do: status in @active_statuses

  @doc "Returns whether a native goal reached a terminal lifecycle state."
  @spec terminal_status?(term()) :: boolean()
  def terminal_status?(status), do: status in @terminal_statuses

  @spec path(Path.t(), role()) :: Path.t()
  def path(workspace, :execution) when is_binary(workspace), do: Path.join(workspace, @execution_file)

  def path(workspace, :authoring) when is_binary(workspace) do
    raise ArgumentError, "assistant_thread_id is required for Claude authoring goal storage"
  end

  @spec path(Path.t(), role(), integer() | nil) :: Path.t()
  def path(workspace, :execution, _assistant_thread_id) when is_binary(workspace),
    do: path(workspace, :execution)

  def path(workspace, :authoring, assistant_thread_id)
      when is_binary(workspace) and is_integer(assistant_thread_id) and assistant_thread_id > 0 do
    Path.join(workspace, ".symphony/assistant-threads/#{assistant_thread_id}/claude-goal-authoring.json")
  end

  @spec read(Path.t(), role()) :: {:ok, map()} | :error | {:error, term()}
  def read(workspace, :execution) when is_binary(workspace), do: read(workspace, :execution, nil)

  def read(workspace, :authoring) when is_binary(workspace) do
    raise ArgumentError, "assistant_thread_id is required for Claude authoring goal storage"
  end

  @spec read(Path.t(), role(), integer() | nil) :: {:ok, map()} | :error | {:error, term()}
  def read(workspace, role, assistant_thread_id)
      when is_binary(workspace) and
             (role == :execution or
                (role == :authoring and is_integer(assistant_thread_id) and assistant_thread_id > 0)) do
    locked(workspace, role, assistant_thread_id, fn ->
      read_unlocked(workspace, role, assistant_thread_id)
    end)
  end

  defp read_unlocked(workspace, role, assistant_thread_id) do
    case File.read(path(workspace, role, assistant_thread_id)) do
      {:ok, contents} ->
        with {:ok, %{"goal" => goal}} <- Jason.decode(contents),
             true <- is_map(goal),
             normalized <- normalize(goal),
             :ok <- validate_stored_goal(normalized) do
          {:ok, normalized}
        else
          _invalid -> {:error, :invalid_goal_store}
        end

      {:error, :enoent} ->
        :error

      {:error, reason} ->
        {:error, {:goal_store_read_failed, reason}}
    end
  end

  @spec put(Path.t(), role(), map()) :: :ok | {:error, term()}
  def put(workspace, :execution, attrs) when is_binary(workspace) and is_map(attrs),
    do: put(workspace, :execution, attrs, nil)

  def put(workspace, :authoring, attrs) when is_binary(workspace) and is_map(attrs),
    do: {:error, :assistant_thread_id_required}

  @spec put(Path.t(), role(), map(), integer() | nil) :: :ok | {:error, term()}
  def put(workspace, role, attrs, assistant_thread_id)
      when is_binary(workspace) and is_map(attrs) and
             (role == :execution or
                (role == :authoring and is_integer(assistant_thread_id) and assistant_thread_id > 0)) do
    with {:ok, goal} <- validate_attrs(attrs) do
      locked(workspace, role, assistant_thread_id, fn ->
        write_goal(workspace, role, stamp(goal), assistant_thread_id)
      end)
    end
  end

  @spec acknowledge_pending(Path.t(), role(), :set | :clear, String.t(), integer() | nil) ::
          :ok | :stale | {:error, term()}
  def acknowledge_pending(workspace, role, expected_command, expected_revision, assistant_thread_id)
      when is_binary(workspace) and expected_command in [:set, :clear] and is_binary(expected_revision) do
    expected = Atom.to_string(expected_command)

    locked(workspace, role, assistant_thread_id, fn ->
      case read_unlocked(workspace, role, assistant_thread_id) do
        {:ok, %{"pending_command" => ^expected, "revision" => ^expected_revision}} ->
          acknowledge_matching(workspace, role, expected_command, assistant_thread_id)

        {:ok, _newer_goal} ->
          :stale

        :error ->
          :stale

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  @doc "Acknowledges a clear while serializing its external mirror mutation."
  @spec acknowledge_clear_with_mirror(
          Path.t(),
          role(),
          String.t(),
          integer() | nil,
          (-> :ok | {:error, term()}),
          (map() -> :ok | {:error, term()})
        ) :: :ok | :stale | {:error, term()}
  def acknowledge_clear_with_mirror(
        workspace,
        role,
        expected_revision,
        assistant_thread_id,
        clear_mirror,
        restore_mirror
      )
      when is_binary(workspace) and role in [:execution, :authoring] and
             is_binary(expected_revision) and expected_revision != "" and
             is_function(clear_mirror, 0) and is_function(restore_mirror, 1) do
    locked(workspace, role, assistant_thread_id, fn ->
      case read_unlocked(workspace, role, assistant_thread_id) do
        {:ok, %{"pending_command" => "clear", "revision" => ^expected_revision} = clear_goal} ->
          with :ok <- clear_mirror.() do
            finalize_locked_clear(
              workspace,
              role,
              expected_revision,
              assistant_thread_id,
              clear_goal,
              restore_mirror
            )
          end

        {:ok, _newer_goal} ->
          :stale

        :error ->
          :stale

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  @spec delete(Path.t(), role()) :: :ok | {:error, term()}
  def delete(workspace, :execution) when is_binary(workspace), do: delete(workspace, :execution, nil)
  def delete(workspace, :authoring) when is_binary(workspace), do: {:error, :assistant_thread_id_required}

  @spec delete(Path.t(), role(), integer() | nil) :: :ok | {:error, term()}
  def delete(workspace, role, assistant_thread_id)
      when is_binary(workspace) and
             (role == :execution or
                (role == :authoring and is_integer(assistant_thread_id) and assistant_thread_id > 0)) do
    locked(workspace, role, assistant_thread_id, fn ->
      case File.rm(path(workspace, role, assistant_thread_id)) do
        :ok -> :ok
        {:error, :enoent} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end)
  end

  @spec requeue_set_if_active(Path.t(), role(), integer() | nil) :: :ok | {:error, term()}
  def requeue_set_if_active(workspace, role, assistant_thread_id) when is_binary(workspace) do
    locked(workspace, role, assistant_thread_id, fn ->
      case read_unlocked(workspace, role, assistant_thread_id) do
        {:ok, %{"status" => status, "objective" => objective, "pending_command" => pending} = goal} ->
          if active_status?(status) and pending != "clear" and is_binary(objective) and objective != "" do
            write_goal(workspace, role, stamp(Map.put(goal, "pending_command", "set")), assistant_thread_id)
          else
            :ok
          end

        :error ->
          :ok

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  @spec queue_clear(Path.t(), role(), integer() | nil) :: :ok | {:error, term()}
  def queue_clear(workspace, role, assistant_thread_id) when is_binary(workspace) do
    case read_unlocked(workspace, role, assistant_thread_id) do
      {:ok, %{"objective" => objective, "revision" => revision}} when is_binary(objective) and objective != "" ->
        queue_clear_if_current(workspace, role, assistant_thread_id, revision)

      {:ok, _goal} ->
        :ok

      :error ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp queue_clear_if_current(workspace, role, assistant_thread_id, expected_revision) do
    locked(workspace, role, assistant_thread_id, fn ->
      case read_unlocked(workspace, role, assistant_thread_id) do
        {:ok, %{"revision" => ^expected_revision, "objective" => objective} = goal}
        when is_binary(objective) and objective != "" ->
          write_goal(workspace, role, stamp(Map.put(goal, "pending_command", "clear")), assistant_thread_id)

        {:ok, _goal} ->
          :ok

        :error ->
          :ok

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  @doc "Persists the provider-owned result of one native Claude Goal invocation."
  @spec transition_native_run(Path.t(), role(), :completed | :interrupted | :failed, integer() | nil) ::
          {:error, :goal_revision_required}
  def transition_native_run(_workspace, _role, _outcome, _assistant_thread_id),
    do: {:error, :goal_revision_required}

  @spec transition_native_run(
          Path.t(),
          role(),
          :completed | :interrupted | :failed,
          integer() | nil,
          String.t()
        ) :: :ok | :stale | {:error, term()}
  def transition_native_run(workspace, role, outcome, assistant_thread_id, expected_revision)
      when is_binary(workspace) and role in [:execution, :authoring] and
             outcome in [:completed, :interrupted, :failed] and
             is_binary(expected_revision) and expected_revision != "" do
    locked(workspace, role, assistant_thread_id, fn ->
      case read_unlocked(workspace, role, assistant_thread_id) do
        {:ok, %{"revision" => revision}} when revision != expected_revision ->
          :stale

        {:ok, %{"objective" => objective} = goal} when is_binary(objective) and objective != "" ->
          next =
            goal
            |> Map.put("status", lifecycle_status(outcome))
            |> Map.put("pending_command", lifecycle_pending(outcome))
            |> stamp()

          write_goal(workspace, role, next, assistant_thread_id)

        {:ok, _goal} ->
          :stale

        :error ->
          :stale

        {:error, reason} ->
          {:error, reason}
      end
    end)
  end

  defp write_goal(workspace, role, goal, assistant_thread_id) do
    file = path(workspace, role, assistant_thread_id)
    File.mkdir_p!(Path.dirname(file))

    temp = file <> ".tmp-#{System.unique_integer([:positive, :monotonic])}"
    canonical_goal = canonicalize_goal_status(goal)

    with :ok <- File.write(temp, Jason.encode!(%{"goal" => canonical_goal}), [:binary]),
         :ok <- File.rename(temp, file) do
      :ok
    else
      {:error, reason} ->
        _ = File.rm(temp)
        {:error, reason}
    end
  end

  defp acknowledge_matching(workspace, role, :set, assistant_thread_id) do
    case read_unlocked(workspace, role, assistant_thread_id) do
      {:ok, goal} ->
        write_goal(workspace, role, stamp(Map.put(goal, "pending_command", nil)), assistant_thread_id)

      :error ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp acknowledge_matching(workspace, role, :clear, assistant_thread_id) do
    write_goal(
      workspace,
      role,
      stamp(%{
        "status" => "completed",
        "objective" => nil,
        "pending_command" => nil,
        "cli_session_id" => nil
      }),
      assistant_thread_id
    )
  end

  defp finalize_locked_clear(
         workspace,
         role,
         expected_revision,
         assistant_thread_id,
         clear_goal,
         restore_mirror
       ) do
    case read_unlocked(workspace, role, assistant_thread_id) do
      {:ok, %{"pending_command" => "clear", "revision" => ^expected_revision}} ->
        acknowledge_matching(workspace, role, :clear, assistant_thread_id)

      {:ok, newer_goal} ->
        restore_mirror_after_clear(restore_mirror, newer_goal, :stale)

      :error ->
        :stale

      {:error, reason} ->
        restore_mirror_after_clear(restore_mirror, clear_goal, {:error, reason})
    end
  end

  defp restore_mirror_after_clear(restore_mirror, goal, result) do
    case restore_mirror.(goal) do
      :ok -> result
      {:error, reason} -> {:error, {:goal_mirror_restore_failed, reason}}
    end
  end

  defp locked(workspace, role, assistant_thread_id, operation) when is_function(operation, 0) do
    :global.trans({__MODULE__, path(workspace, role, assistant_thread_id)}, operation)
  end

  defp stamp(goal) when is_map(goal) do
    goal
    |> Map.put("updated_at", DateTime.utc_now() |> DateTime.to_iso8601())
    |> Map.put("revision", System.unique_integer([:positive, :monotonic]) |> Integer.to_string())
  end

  defp validate_attrs(attrs) when is_map(attrs) do
    objective = attr(attrs, "objective")
    status = attrs |> attr("status") |> canonical_status()
    status = status || "running"
    pending = attr(attrs, "pending_command")
    cli_session_id = attr(attrs, "cli_session_id")

    cond do
      not is_binary(objective) ->
        {:error, :empty_objective}

      String.trim(objective) == "" ->
        {:error, :empty_objective}

      byte_size(String.trim(objective)) > @max_objective_bytes ->
        {:error, :objective_too_long}

      not canonical_status?(status) ->
        {:error, :invalid_status}

      pending not in [nil, "set", "clear"] ->
        {:error, :invalid_pending_command}

      true ->
        {:ok,
         %{
           "status" => status,
           "objective" => String.trim(objective),
           "pending_command" => pending,
           "cli_session_id" => cli_session_id
         }}
    end
  end

  defp attr(map, "objective"), do: Map.get(map, "objective") || Map.get(map, :objective)
  defp attr(map, "status"), do: Map.get(map, "status") || Map.get(map, :status)
  defp attr(map, "pending_command"), do: Map.get(map, "pending_command") || Map.get(map, :pending_command)
  defp attr(map, "cli_session_id"), do: Map.get(map, "cli_session_id") || Map.get(map, :cli_session_id)

  defp normalize(goal) when is_map(goal) do
    %{
      "status" => goal |> Map.get("status") |> canonical_status(),
      "objective" => Map.get(goal, "objective"),
      "pending_command" => Map.get(goal, "pending_command"),
      "updated_at" => Map.get(goal, "updated_at"),
      "revision" => Map.get(goal, "revision"),
      "cli_session_id" => Map.get(goal, "cli_session_id")
    }
  end

  defp validate_stored_goal(%{
         "status" => status,
         "objective" => objective,
         "pending_command" => pending,
         "revision" => revision
       }) do
    cond do
      not canonical_status?(status) ->
        {:error, :invalid_goal_store}

      pending not in [nil, "set", "clear"] ->
        {:error, :invalid_goal_store}

      not is_binary(revision) or revision == "" ->
        {:error, :invalid_goal_store}

      pending in ["set", "clear"] and (not is_binary(objective) or objective == "") ->
        {:error, :invalid_goal_store}

      active_status?(status) and pending == nil and (not is_binary(objective) or objective == "") ->
        {:error, :invalid_goal_store}

      true ->
        :ok
    end
  end

  defp lifecycle_status(:completed), do: "completed"
  defp lifecycle_status(:interrupted), do: "paused"
  defp lifecycle_status(:failed), do: "failed"

  defp lifecycle_pending(:completed), do: nil
  defp lifecycle_pending(outcome) when outcome in [:interrupted, :failed], do: "set"

  defp canonicalize_goal_status(goal) when is_map(goal) do
    Map.update(goal, "status", nil, &canonical_status/1)
  end

  defp canonical_status("active"), do: "running"
  defp canonical_status("achieved"), do: "completed"
  defp canonical_status("cleared"), do: "completed"
  defp canonical_status(status), do: status
end
