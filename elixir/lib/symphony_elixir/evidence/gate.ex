defmodule SymphonyElixir.Evidence.Gate do
  @moduledoc """
  The VALIDATE gate decision. Pure over injected dependencies; the
  orchestrator/runner supply real implementations
  (`Manifest.read/1`, `GitDiff.changed_files/1`, `SessionAudit.verify_commands/2`).
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
    ui_change = GitDiff.ui_change?(changed, config[:ui_paths] || [])

    violations =
      unit_violations(manifest, changed) ++
        e2e_violations(manifest, ui_change) ++
        audit_violations(manifest, workspace, deps)

    case violations do
      [] -> :satisfied
      violations -> {:violations, violations}
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
    |> Enum.map(
      &%{kind: :unit_not_green, repo: &1, detail: "no passing unit run for changed repo #{&1}"}
    )
  end

  defp e2e_violations(_manifest, false), do: []

  defp e2e_violations(manifest, true) do
    case Enum.find(manifest.runs, &(&1.kind == "e2e" and &1.status == "passed")) do
      nil ->
        [%{kind: :e2e_missing, repo: nil, detail: "UI paths changed but no passing e2e run"}]

      run ->
        if run.screenshots != [] and run.videos != [] do
          []
        else
          [
            %{
              kind: :visual_capture_missing,
              repo: run.repo,
              detail: "e2e run must include at least 1 screenshot and 1 video"
            }
          ]
        end
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
