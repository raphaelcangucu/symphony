defmodule SymphonyElixir.Evidence.Gate do
  @moduledoc """
  The VALIDATE gate decision, evaluated per repo. Pure over injected
  dependencies; the orchestrator/runner supply real implementations
  (`Manifest.read/1`, `GitDiff.changed_files/1`, `SessionAudit.verify_commands/2`).

  Unit tests are required for every changed repo. e2e is required for a UI repo
  via three layers: a deterministic floor (the UI repo's own `ui_paths`
  changed), a deterministic contract backstop (a source repo changed inside its
  `contract_paths` and declares it `impacts` the UI repo - the agent cannot
  waive this), and an agent decision for cross-repo changes outside the contract
  surface (recorded and justified in the manifest `impact` list; a missing
  decision is itself a violation).
  """

  alias SymphonyElixir.Evidence.GitDiff
  alias SymphonyElixir.Evidence.Manifest
  alias SymphonyElixir.Evidence.SessionAudit

  @type violation :: %{kind: atom(), repo: String.t() | nil, detail: String.t()}

  @spec evaluate(Path.t(), map(), map()) :: :satisfied | {:violations, [violation()]}
  def evaluate(workspace, config, deps \\ default_deps()) do
    changed = deps.changed_files.(workspace)

    cond do
      config[:required] != true -> :satisfied
      changed == %{} -> :satisfied
      true -> evaluate_manifest(workspace, config, changed, deps)
    end
  end

  @spec default_deps() :: map()
  def default_deps do
    %{
      read_manifest: &Manifest.read/1,
      changed_files: &GitDiff.changed_files/1,
      audit: fn commands, opts -> SessionAudit.verify_commands(commands, opts) end
    }
  end

  defp evaluate_manifest(workspace, config, changed, deps) do
    case deps.read_manifest.(workspace) do
      {:ok, manifest} ->
        decide(manifest, workspace, config, changed, deps)

      {:error, :manifest_missing} ->
        {:violations,
         [
           %{
             kind: :manifest_missing,
             repo: nil,
             detail: "no .symphony/evidence/manifest.json in workspace"
           }
         ]}

      {:error, reason} ->
        {:violations, [%{kind: :manifest_invalid, repo: nil, detail: inspect(reason)}]}
    end
  end

  defp decide(manifest, workspace, config, changed, deps) do
    repos = repos_config(config)
    {required_ui, impact_violations} = e2e_requirements(repos, changed, manifest)

    violations =
      unit_violations(manifest, changed) ++
        impact_violations ++
        e2e_violations(manifest, required_ui) ++
        audit_violations(manifest, workspace, deps)

    case violations do
      [] -> :satisfied
      violations -> {:violations, violations}
    end
  end

  defp repos_config(config) do
    case config[:repos] do
      repos when is_map(repos) -> repos
      _ -> %{}
    end
  end

  defp unit_violations(manifest, changed) do
    changed
    |> Map.keys()
    |> Enum.reject(fn repo ->
      Enum.any?(
        manifest.runs,
        &(&1.kind == "unit" and &1.repo == repo and &1.status == "passed")
      )
    end)
    |> Enum.map(&%{kind: :unit_not_green, repo: &1, detail: "no passing unit run for changed repo #{&1}"})
  end

  # Decides which UI repos must have an e2e run, in three layers:
  #
  #   1. direct      - the UI repo's own `ui_paths` changed (deterministic floor)
  #   2. backstop    - a source repo S changed inside its `contract_paths` and
  #                    declares it `impacts` U (deterministic; the agent cannot
  #                    waive this by claiming "no impact")
  #   3. agent call  - a source repo S changed OUTSIDE its contract surface but
  #                    declares it `impacts` U; the agent decides via the
  #                    manifest `impact` entry (impacts_ui=true -> required;
  #                    false+rationale -> allowed; missing -> violation)
  defp e2e_requirements(repos, changed, manifest) do
    ui_repos = ui_repos(repos)
    changed_names = Map.keys(changed)

    direct = Enum.filter(ui_repos, &direct_ui_change?(repos, changed, &1))

    impact_pairs =
      for source <- changed_names,
          target <- impacts(repos, source),
          target in ui_repos,
          target != source,
          do: {source, target}

    {backstop_pairs, gray_pairs} =
      Enum.split_with(impact_pairs, fn {source, _target} -> contract_match?(repos, changed, source) end)

    backstop_required = backstop_pairs |> Enum.map(&elem(&1, 1)) |> Enum.uniq()

    agent_required =
      gray_pairs
      |> Enum.filter(fn {source, target} -> impact_decision(manifest, source, target) == {:ok, true} end)
      |> Enum.map(&elem(&1, 1))
      |> Enum.uniq()

    required = Enum.uniq(direct ++ backstop_required ++ agent_required)

    impact_violations =
      gray_pairs
      |> Enum.reject(fn {_source, target} -> target in required end)
      |> Enum.filter(fn {source, target} -> impact_decision(manifest, source, target) == :missing end)
      |> Enum.map(fn {source, target} ->
        %{
          kind: :impact_assessment_missing,
          repo: target,
          detail:
            "changed repo #{source} may impact #{target}; run #{target} e2e or declare an `impact` " <>
              "entry {from: #{source}, to: #{target}, impacts_ui: false, rationale: ...}"
        }
      end)

    {required, impact_violations}
  end

  defp e2e_violations(manifest, required_ui) do
    Enum.flat_map(required_ui, &e2e_violation_for(manifest, &1))
  end

  defp e2e_violation_for(manifest, repo) do
    case Enum.find(manifest.runs, &(&1.kind == "e2e" and &1.repo == repo and &1.status == "passed")) do
      nil ->
        [%{kind: :e2e_missing, repo: repo, detail: "e2e required for #{repo} but no passing e2e run"}]

      run ->
        if run.screenshots != [] and run.videos != [] do
          []
        else
          [
            %{
              kind: :visual_capture_missing,
              repo: repo,
              detail: "e2e run for #{repo} must include at least 1 screenshot and 1 video"
            }
          ]
        end
    end
  end

  defp ui_repos(repos) do
    for {name, cfg} <- repos, e2e_command(cfg) != nil, do: name
  end

  defp e2e_command(%{e2e: %{command: command}}) when is_binary(command) and command != "", do: command
  defp e2e_command(_cfg), do: nil

  defp direct_ui_change?(repos, changed, repo) do
    GitDiff.paths_match?(Map.get(changed, repo, []), repo_globs(repos, repo, :ui_paths))
  end

  defp contract_match?(repos, changed, repo) do
    GitDiff.paths_match?(Map.get(changed, repo, []), repo_globs(repos, repo, :contract_paths))
  end

  defp impacts(repos, repo), do: repo_globs(repos, repo, :impacts)

  defp repo_globs(repos, repo, key) do
    case get_in(repos, [repo, key]) do
      values when is_list(values) -> values
      _ -> []
    end
  end

  defp impact_decision(manifest, from, to) do
    case Enum.find(manifest.impact, &(&1.from == from and &1.to == to)) do
      nil -> :missing
      %{impacts_ui: impacts_ui} -> {:ok, impacts_ui}
    end
  end

  defp audit_violations(manifest, workspace, deps) do
    commands = manifest.runs |> Enum.map(& &1.command) |> Enum.uniq()

    case deps.audit.(commands, workspace: workspace) do
      :ok ->
        []

      {:error, {:commands_not_executed, missing}} ->
        [
          %{
            kind: :commands_not_executed,
            repo: nil,
            detail: "declared but never executed in session: #{Enum.join(missing, ", ")}"
          }
        ]

      {:error, :session_log_unavailable} ->
        [
          %{
            kind: :session_log_unavailable,
            repo: nil,
            detail: "could not read Codex session log to audit evidence"
          }
        ]
    end
  end
end
