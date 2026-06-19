defmodule SymphonyElixir.Assistant.EvidenceTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.Evidence.{Gate, Judge, Store}
  alias SymphonyElixir.ProjectConfig

  @tool "get_evidence_status"

  @description """
  Read persisted evidence runs and the current validate gate state for an issue workspace.
  Call after writing .symphony/evidence/manifest.json and before handoff.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier"],
      "properties" => %{
        "identifier" => %{
          "type" => "string",
          "description" => "Issue identifier, for example MAC-1."
        }
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => [],
      "properties" => %{}
    })
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    list_runs = Keyword.get(opts, :list_runs, &Store.list/2)

    with {:ok, issue} <- HandoffTools.resolve_issue(project_slug, arguments, opts),
         {:ok, config} <- HandoffTools.load_config(project_slug, opts),
         workspace = HandoffTools.workspace_for(issue, opts),
         {:ok, records} <- list_runs.(project_slug, issue.identifier) do
      gate =
        Gate.evaluate(
          workspace,
          evidence_config(config),
          Map.put(Gate.default_deps(), :judge_verdict, &Judge.read_verdict/1)
        )

      {:ok,
       %{
         tool: @tool,
         message: evidence_message(issue.identifier, gate),
         data: %{
           required: evidence_required?(config),
           gate: gate_payload(gate),
           runs: Enum.map(records, &present_run/1),
           manifest_path: ".symphony/evidence/manifest.json",
           workspace_path: workspace
         }
       }}
    end
  end

  defp evidence_message(identifier, :satisfied), do: "Evidence gate satisfied for #{identifier}."
  defp evidence_message(identifier, {:violations, _}), do: "Evidence gate not satisfied for #{identifier}."

  defp gate_payload(:satisfied), do: %{satisfied: true, violations: []}

  defp gate_payload({:violations, violations}) do
    %{satisfied: false, violations: Enum.map(violations, &present_violation/1)}
  end

  defp present_violation(%{kind: kind, repo: repo, detail: detail}) do
    %{
      "kind" => atom_to_string(kind),
      "repo" => repo,
      "detail" => detail
    }
  end

  defp present_run(record) do
    %{
      id: record.id,
      run_id: record.run_id,
      session_id: record.session_id,
      status: record.status,
      ui_change: record.ui_change,
      manifest: record.manifest,
      recorded_at: record.inserted_at
    }
  end

  defp evidence_config(%ProjectConfig{evidence: evidence}) when is_map(evidence), do: evidence
  defp evidence_config(_config), do: %{required: false, repos: %{}}

  defp evidence_required?(%ProjectConfig{evidence: %{required: true}}), do: true
  defp evidence_required?(_config), do: false

  defp atom_to_string(value) when is_atom(value), do: Atom.to_string(value)

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
