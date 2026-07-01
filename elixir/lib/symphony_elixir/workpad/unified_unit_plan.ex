defmodule SymphonyElixir.Workpad.UnifiedUnitPlan do
  @moduledoc """
  Joins a parent execution bundle with gated board sub-issues for unified parent runs.

  When `lab.bundle_child_orchestration` is off, the orchestrator dispatches only the
  parent and injects this plan into `run_opts` so the parent agent can sequence
  native subagents per unit.
  """

  alias SymphonyElixir.{AgentRouting, Issue}
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixir.Settings.Orchestration, as: OrchestrationSettings
  alias SymphonyElixir.Workpad.ExecutionBundle

  defstruct [:units, :warnings]

  @type unit_entry :: %{
          id: String.t() | nil,
          issue: String.t(),
          type: atom() | nil,
          repo: String.t() | nil,
          depends_on: [String.t()],
          consumes: [String.t()],
          produces: [String.t()],
          deliverable: String.t() | nil,
          board_status: String.t() | nil,
          eligible: boolean(),
          skip_reason: String.t() | nil,
          ad_hoc: boolean()
        }

  @type t :: %__MODULE__{
          units: [unit_entry()],
          warnings: [String.t()]
        }

  @doc """
  Builds an ordered unit plan from a bundle and board sub-issues.

  Options (all injectable for tests):

    * `:require_symphony_label` — defaults to `OrchestrationSettings.require_symphony_label?/0`
    * `:require_assignee_match` — defaults to `OrchestrationSettings.require_assignee_match?/0`
    * `:viewer_login` — when assignee match is on, sub-issues must match this login
  """
  @spec build(ExecutionBundle.t(), [Issue.t()], keyword()) :: {:ok, t()}
  def build(%ExecutionBundle{} = bundle, sub_issues, opts \\ []) when is_list(sub_issues) do
    require_label? = Keyword.get(opts, :require_symphony_label, OrchestrationSettings.require_symphony_label?())
    require_assignee? = Keyword.get(opts, :require_assignee_match, OrchestrationSettings.require_assignee_match?())
    viewer_login = Keyword.get(opts, :viewer_login, viewer_login())

    gated =
      sub_issues
      |> Enum.filter(&sub_issue_admitted?(&1, require_label?, require_assignee?, viewer_login))
      |> Map.new(&{&1.identifier, &1})

    {units, warnings} = join_units(bundle, gated)
    ordered = topo_sort_units(units, bundle)

    {:ok, %__MODULE__{units: ordered, warnings: warnings}}
  end

  defp join_units(%ExecutionBundle{units: bundle_units} = bundle, gated_by_issue) do
    bundle_entries =
      Enum.map(bundle_units, fn unit ->
        issue_id = unit.issue

        cond do
          not is_binary(issue_id) or issue_id == "" ->
            {nil, ["Bundle unit #{unit.id} has no issue identifier — skipped"]}

          Map.has_key?(gated_by_issue, issue_id) ->
            issue = Map.fetch!(gated_by_issue, issue_id)
            {entry_from_unit(unit, issue, ad_hoc: false, eligible: true, skip_reason: nil), []}

          true ->
            {entry_from_unit(unit, nil, ad_hoc: false, eligible: false, skip_reason: "not on board or failed gates"),
             ["Bundle unit #{unit.id} (#{issue_id}) has no matching gated board sub-issue"]}
        end
      end)

    bundle_units_list = Enum.flat_map(bundle_entries, fn {entry, _} -> if entry, do: [entry], else: [] end)
    bundle_warnings = Enum.flat_map(bundle_entries, fn {_, warnings} -> warnings end)

    ad_hoc_entries =
      gated_by_issue
      |> Map.keys()
      |> Enum.reject(&MapSet.member?(bundle_issue_ids(bundle), &1))
      |> Enum.map(fn issue_id ->
        issue = Map.fetch!(gated_by_issue, issue_id)

        {
          entry_from_unit(
            %{
              id: issue_id,
              type: :child_run,
              issue: issue_id,
              repo: issue.repository_full_name,
              depends_on: [],
              consumes: [],
              produces: [],
              deliverable: "subagent"
            },
            issue,
            ad_hoc: true,
            eligible: true,
            skip_reason: nil
          ),
          ["Board sub-issue #{issue_id} has no bundle unit — included as ad-hoc (parent decides order)"]
        }
      end)

    ad_hoc_units = Enum.flat_map(ad_hoc_entries, fn {entry, _} -> [entry] end)
    ad_hoc_warnings = Enum.flat_map(ad_hoc_entries, fn {_, warnings} -> warnings end)

    {bundle_units_list ++ ad_hoc_units, bundle_warnings ++ ad_hoc_warnings}
  end

  defp bundle_issue_ids(%ExecutionBundle{units: units}) do
    units
    |> Enum.map(& &1.issue)
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> MapSet.new()
  end

  defp entry_from_unit(unit, issue, meta) when is_list(meta) do
    ad_hoc = Keyword.fetch!(meta, :ad_hoc)
    eligible = Keyword.fetch!(meta, :eligible)
    skip_reason = Keyword.fetch!(meta, :skip_reason)

    %{
      id: Map.get(unit, :id),
      issue: unit.issue || (issue && issue.identifier),
      type: Map.get(unit, :type),
      repo: Map.get(unit, :repo) || (issue && issue.repository_full_name),
      depends_on: List.wrap(Map.get(unit, :depends_on)),
      consumes: List.wrap(Map.get(unit, :consumes)),
      produces: List.wrap(Map.get(unit, :produces)),
      deliverable: Map.get(unit, :deliverable),
      board_status: issue && issue.state,
      eligible: eligible,
      skip_reason: skip_reason,
      ad_hoc: ad_hoc
    }
  end

  defp topo_sort_units(units, %ExecutionBundle{units: bundle_units}) do
    order_index =
      bundle_units
      |> Enum.with_index()
      |> Enum.reduce(%{}, fn {unit, idx}, acc ->
        key = unit.id || unit.issue
        if is_binary(key), do: Map.put(acc, key, idx), else: acc
      end)

    Enum.sort_by(units, fn unit ->
      idx = Map.get(order_index, unit.id) || Map.get(order_index, unit.issue) || 999
      {idx, unit.issue}
    end)
  end

  defp sub_issue_admitted?(%Issue{} = issue, require_label?, require_assignee?, viewer_login) do
    label_ok = not require_label? or AgentRouting.routable?(issue.labels || [])
    assignee_ok = not require_assignee? or assignee_matches?(issue, viewer_login)
    label_ok and assignee_ok
  end

  defp assignee_matches?(%Issue{assignee_id: assignee_id}, viewer_login)
       when is_binary(assignee_id) and is_binary(viewer_login) do
    String.downcase(String.trim(assignee_id)) == String.downcase(String.trim(viewer_login))
  end

  defp assignee_matches?(_issue, _viewer_login), do: false

  defp viewer_login do
    case Viewer.current() do
      {:ok, %{login: login}} when is_binary(login) -> login
      _ -> nil
    end
  end
end
