defmodule SymphonyElixir.Claude.GoalStore do
  @moduledoc false

  @execution_file ".symphony/claude-goal.json"
  @authoring_file ".symphony/claude-goal-authoring.json"
  @max_objective_bytes 4000

  @type role :: :execution | :authoring

  @spec path(Path.t(), role()) :: Path.t()
  def path(workspace, :execution) when is_binary(workspace), do: Path.join(workspace, @execution_file)
  def path(workspace, :authoring) when is_binary(workspace), do: Path.join(workspace, @authoring_file)

  @spec read(Path.t(), role()) :: {:ok, map()} | :error
  def read(workspace, role) when is_binary(workspace) and role in [:execution, :authoring] do
    with {:ok, contents} <- File.read(path(workspace, role)),
         {:ok, %{"goal" => goal}} <- Jason.decode(contents),
         true <- is_map(goal) do
      {:ok, normalize(goal)}
    else
      _absent -> :error
    end
  end

  @spec put(Path.t(), role(), map()) :: :ok | {:error, term()}
  def put(workspace, role, attrs)
      when is_binary(workspace) and role in [:execution, :authoring] and is_map(attrs) do
    with {:ok, goal} <- validate_attrs(attrs) do
      write_goal(workspace, role, stamp(goal))
    end
  end

  @spec clear_pending(Path.t(), role()) :: :ok | {:error, term()}
  def clear_pending(workspace, role) when is_binary(workspace) and role in [:execution, :authoring] do
    case read(workspace, role) do
      :error ->
        :ok

      {:ok, goal} ->
        write_goal(workspace, role, stamp(Map.put(goal, "pending_command", nil)))
    end
  end

  @spec mark_cleared(Path.t(), role()) :: :ok | {:error, term()}
  def mark_cleared(workspace, role) when is_binary(workspace) and role in [:execution, :authoring] do
    write_goal(
      workspace,
      role,
      stamp(%{
        "status" => "cleared",
        "objective" => nil,
        "pending_command" => nil,
        "cli_session_id" => nil
      })
    )
  end

  @spec delete(Path.t(), role()) :: :ok | {:error, term()}
  def delete(workspace, role) when is_binary(workspace) and role in [:execution, :authoring] do
    case File.rm(path(workspace, role)) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp write_goal(workspace, role, goal) do
    file = path(workspace, role)
    File.mkdir_p!(Path.dirname(file))

    case File.write(file, Jason.encode!(%{"goal" => goal})) do
      :ok -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp stamp(goal) when is_map(goal) do
    Map.put(goal, "updated_at", DateTime.utc_now() |> DateTime.to_iso8601())
  end

  defp validate_attrs(attrs) when is_map(attrs) do
    objective = attr(attrs, "objective")
    status = attr(attrs, "status") || "active"
    pending = attr(attrs, "pending_command")
    cli_session_id = attr(attrs, "cli_session_id")

    cond do
      not is_binary(objective) ->
        {:error, :empty_objective}

      String.trim(objective) == "" ->
        {:error, :empty_objective}

      byte_size(String.trim(objective)) > @max_objective_bytes ->
        {:error, :objective_too_long}

      status not in ["active", "cleared", "achieved"] ->
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
      "status" => Map.get(goal, "status"),
      "objective" => Map.get(goal, "objective"),
      "pending_command" => Map.get(goal, "pending_command"),
      "updated_at" => Map.get(goal, "updated_at"),
      "cli_session_id" => Map.get(goal, "cli_session_id")
    }
  end
end
