defmodule SymphonyElixirWeb.DevEnvPresenter do
  @moduledoc "JSON DTOs for dev-env steps, proposals, and runs."

  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Run, Step, StepRun}

  @spec step(Step.t()) :: map()
  def step(%Step{} = step) do
    %{
      id: step.id,
      description: step.description,
      command: step.command,
      stop_command: step.stop_command,
      working_dir: step.working_dir,
      position: step.position,
      source: step.source,
      optional: step.optional,
      role: step.role,
      port_env: step.port_env,
      url_path: step.url_path,
      ready_probe: step.ready_probe,
      ready_path: step.ready_path,
      primary: step.primary,
      run_spec: step.run_spec
    }
  end

  @spec proposed(ProposedStep.t()) :: map()
  def proposed(%ProposedStep{} = step) do
    %{
      description: step.description,
      command: step.command,
      stop_command: step.stop_command,
      working_dir: step.working_dir,
      source: step.source,
      optional: step.optional,
      role: step.role,
      port_env: step.port_env,
      url_path: step.url_path,
      ready_probe: step.ready_probe,
      ready_path: step.ready_path,
      primary: step.primary,
      run_spec: step.run_spec
    }
  end

  @spec run(Run.t()) :: map()
  def run(%Run{} = run) do
    %{
      id: run.id,
      status: run.status,
      started_at: iso8601(run.started_at),
      completed_at: iso8601(run.completed_at),
      step_runs: step_runs(run)
    }
  end

  @spec step_run(StepRun.t()) :: map()
  def step_run(%StepRun{} = sr) do
    %{
      id: sr.id,
      step_id: sr.step_id,
      description: sr.description,
      command: sr.command,
      status: sr.status,
      exit_code: sr.exit_code,
      output: sr.output,
      started_at: iso8601(sr.started_at),
      completed_at: iso8601(sr.completed_at)
    }
  end

  defp step_runs(%Run{step_runs: runs}) when is_list(runs), do: Enum.map(runs, &step_run/1)
  defp step_runs(_), do: []

  defp iso8601(%DateTime{} = dt), do: dt |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  defp iso8601(_), do: nil
end
