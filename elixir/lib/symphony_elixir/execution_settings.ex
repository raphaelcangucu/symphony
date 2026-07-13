defmodule SymphonyElixir.ExecutionSettings do
  @moduledoc """
  Pure precedence for per-task execution pins vs project/user defaults.
  """

  alias SymphonyElixir.AgentPreference

  @spec resolve_agent(map()) :: String.t()
  def resolve_agent(layers) when is_map(layers) do
    [
      layers[:settings_agent] || layers["settings_agent"],
      layers[:label_agent] || layers["label_agent"],
      layers[:project_agent] || layers["project_agent"],
      layers[:user_agent] || layers["user_agent"],
      "codex"
    ]
    |> Enum.find_value(&AgentPreference.normalize/1)
  end

  @spec resolve_model(map()) :: String.t() | nil
  def resolve_model(layers) when is_map(layers) do
    first_present([
      layers[:settings_model] || layers["settings_model"],
      layers[:project_model] || layers["project_model"],
      layers[:user_model] || layers["user_model"]
    ])
  end

  @spec resolve_effort(map()) :: String.t() | nil
  def resolve_effort(layers) when is_map(layers) do
    first_present([
      layers[:settings_effort] || layers["settings_effort"],
      layers[:project_effort] || layers["project_effort"],
      layers[:user_effort] || layers["user_effort"]
    ])
  end

  defp first_present(values) do
    Enum.find(values, fn
      nil -> false
      "" -> false
      _ -> true
    end)
  end
end
