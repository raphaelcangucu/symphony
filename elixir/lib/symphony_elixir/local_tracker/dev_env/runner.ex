defmodule SymphonyElixir.LocalTracker.DevEnv.Runner do
  @moduledoc """
  Executes a dev-env step inside the project tmux session and records a StepRun.

  tmux does not surface exit codes directly; this records the captured output and
  marks the step `running`/`succeeded`. Exit-code wrapping is a documented follow-up.
  """

  alias SymphonyElixir.LocalTracker.DevEnv
  alias SymphonyElixir.LocalTracker.DevEnv.{Run, Step}
  alias SymphonyElixir.Terminal.Registry

  @spec run_step(String.t(), Run.t(), Step.t(), keyword()) :: {:ok, DevEnv.StepRun.t()} | {:error, term()}
  def run_step(project_slug, %Run{} = run, %Step{} = step, opts \\ []) do
    started_at = DateTime.utc_now()

    with {:ok, _session} <- Registry.open_project_session(project_slug, opts),
         :ok <- Registry.send_input_project(project_slug, command_line(step), opts),
         {:ok, output} <- Registry.capture_project(project_slug, opts) do
      DevEnv.record_step_result(run, step, %{
        status: "succeeded",
        output: output,
        started_at: started_at,
        completed_at: DateTime.utc_now()
      })
    else
      {:error, reason} ->
        DevEnv.record_step_result(run, step, %{
          status: "failed",
          output: error_text(reason),
          started_at: started_at,
          completed_at: DateTime.utc_now()
        })
    end
  end

  defp command_line(%Step{command: command, working_dir: nil}), do: command <> "\n"

  defp command_line(%Step{command: command, working_dir: working_dir}) do
    "cd #{working_dir} && #{command}\n"
  end

  defp error_text(reason) when is_binary(reason), do: reason
  defp error_text(reason), do: inspect(reason)
end
