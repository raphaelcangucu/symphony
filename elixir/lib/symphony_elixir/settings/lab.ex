defmodule SymphonyElixir.Settings.Lab do
  @moduledoc """
  Experimental Lab settings (group "lab").

  - `bundle_child_orchestration`: when true, parent tasks with coordinator bundles
    dispatch separate orchestrator runs per `child_run` unit (worktrees, integration
    branches). When false (default), one parent run uses native subagents and one PR
    per repo.
  """

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "lab"
  @bundle_child_orchestration "bundle_child_orchestration"

  @impl true
  def group, do: @group

  @impl true
  def defaults do
    %{
      @bundle_child_orchestration => false
    }
  end

  @impl true
  def cast(@bundle_child_orchestration, value), do: normalize_boolean(value)
  def cast(_name, _value), do: :error

  @doc "Whether orchestrator child_run units are dispatched as separate runs."
  @spec bundle_child_orchestration?() :: boolean()
  def bundle_child_orchestration?, do: boolean_setting(@bundle_child_orchestration)

  defp boolean_setting(name) do
    case Settings.get(@group, name) do
      value when is_boolean(value) -> value
      _ -> Map.fetch!(defaults(), name)
    end
  end

  defp normalize_boolean(value) when is_boolean(value), do: {:ok, value}
  defp normalize_boolean("true"), do: {:ok, true}
  defp normalize_boolean("false"), do: {:ok, false}
  defp normalize_boolean(_value), do: :error
end
