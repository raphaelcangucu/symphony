defmodule SymphonyElixir.IssueDispatchPrep do
  @moduledoc """
  Applies orchestrator admission gates before manual or assistant dispatch.

  When `require_symphony_label` and `require_assignee_match` are enabled, the
  orchestrator only picks up issues assigned to the local viewer and carrying a
  `symphony*` label. Dispatch paths call this module so assistant/UI dispatch
  does not rely on the operator setting assignee and labels by hand.
  """

  alias SymphonyElixir.AgentRouting
  alias SymphonyElixir.LocalTracker.{Context, Project, Viewer}
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Workpad
  alias SymphonyElixir.Workpad.ExecutionBundle

  require Logger

  @spec prepare_for_dispatch(Project.t() | map(), String.t(), String.t()) :: :ok | {:error, term()}
  def prepare_for_dispatch(project, identifier, agent_kind)
      when is_binary(identifier) and is_binary(agent_kind) do
    with :ok <- ensure_dispatch_gates(project, identifier, agent_kind),
         :ok <- ensure_bundle_child_gates(project, identifier, agent_kind) do
      :ok
    end
  end

  @spec ensure_dispatch_gates(Project.t() | map(), String.t(), String.t()) :: :ok | {:error, term()}
  def ensure_dispatch_gates(project, identifier, agent_kind)
      when is_binary(identifier) and is_binary(agent_kind) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         attrs <- missing_gate_attrs(issue, agent_kind),
         :ok <- maybe_update_issue(project, identifier, attrs) do
      :ok
    end
  end

  @spec ensure_bundle_child_gates(Project.t() | map(), String.t(), String.t()) :: :ok
  def ensure_bundle_child_gates(project, parent_identifier, agent_kind)
      when is_binary(parent_identifier) and is_binary(agent_kind) do
    project
    |> child_identifiers(parent_identifier)
    |> Enum.uniq()
    |> Enum.each(fn child_identifier ->
      case ensure_dispatch_gates(project, child_identifier, agent_kind) do
        :ok ->
          :ok

        {:error, reason} ->
          Logger.debug("IssueDispatchPrep child gate skip parent=#{parent_identifier} child=#{child_identifier} reason=#{inspect(reason)}")

          :ok
      end
    end)

    :ok
  end

  defp child_identifiers(project, parent_identifier) do
    slug = project_slug(project)

    bundle_children = bundle_child_identifiers(slug, parent_identifier)

    linked_children =
      case Context.list_subtask_children(slug, parent_identifier) do
        {:ok, ids} -> ids
        _ -> []
      end

    bundle_children ++ linked_children
  end

  defp bundle_child_identifiers(slug, parent_identifier) do
    with {:ok, comments} <- Context.list_comments(slug, parent_identifier),
         body when is_binary(body) <- workpad_body_from_comments(comments),
         {:ok, bundle} <- ExecutionBundle.parse(body) do
      bundle
      |> ExecutionBundle.dispatchable_units()
      |> Enum.map(& &1.issue)
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
    else
      _ -> []
    end
  end

  defp workpad_body_from_comments(comments) when is_list(comments) do
    Enum.find_value(comments, fn comment ->
      body = comment_body(comment)

      if is_binary(body) and Workpad.workpad?(body) do
        body
      end
    end)
  end

  defp workpad_body_from_comments(_comments), do: nil

  defp comment_body(%{body: body}), do: body
  defp comment_body(%{"body" => body}), do: body
  defp comment_body(_comment), do: nil

  defp missing_gate_attrs(%IssueDTO{} = issue, agent_kind) do
    %{}
    |> maybe_put_assignee(issue)
    |> maybe_put_agent(issue, agent_kind)
  end

  defp maybe_put_assignee(attrs, %IssueDTO{} = issue) do
    if issue_has_assignee?(issue) do
      attrs
    else
      case Viewer.current() do
        {:ok, %{login: login}} when is_binary(login) ->
          Map.put(attrs, "assignee_ids", [login])

        _ ->
          attrs
      end
    end
  end

  defp issue_has_assignee?(%IssueDTO{assignee: assignee, assignee_remote_id: remote_id}) do
    present?(assignee) or present?(remote_id)
  end

  defp maybe_put_agent(attrs, %IssueDTO{labels: labels}, agent_kind) do
    if AgentRouting.routable?(labels || []) do
      attrs
    else
      Map.put(attrs, "agent", agent_kind)
    end
  end

  defp maybe_update_issue(_project, _identifier, attrs) when attrs == %{}, do: :ok

  defp maybe_update_issue(project, identifier, attrs) do
    case IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
      {:ok, _issue} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(_value), do: false

  defp project_slug(%Project{slug: slug}) when is_binary(slug), do: slug
  defp project_slug(%{slug: slug}) when is_binary(slug), do: slug
end
