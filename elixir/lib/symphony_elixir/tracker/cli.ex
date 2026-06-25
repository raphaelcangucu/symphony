defmodule SymphonyElixir.Tracker.Cli do
  @moduledoc """
  In-daemon dispatcher for the `mix symphony.tracker` CLI. Runs inside the live
  Symphony daemon (invoked over `:erpc`) so the tracker SQLite database keeps a
  single owner. Maps a tool name + project slug + argument map onto the same
  `SymphonyElixir.Assistant.ToolExecutor` surface the chat assistant uses, and
  returns the structured `{:ok, %{tool, message, data}}` result unchanged.
  """

  alias SymphonyElixir.Assistant.{DiscoveryTools, RunningAgentsTools, ToolExecutor}

  @discovery_tools DiscoveryTools.tools()
  @running_agents_tool RunningAgentsTools.tool_name()

  @spec call(String.t(), String.t() | nil, map()) :: {:ok, map()} | {:error, term()}
  def call(tool, project_slug, arguments)
      when is_binary(tool) and (is_nil(project_slug) or is_binary(project_slug)) and is_map(arguments) do
    cond do
      tool in @discovery_tools -> DiscoveryTools.execute(tool, arguments, [])
      tool == @running_agents_tool and is_nil(project_slug) -> RunningAgentsTools.execute(nil, arguments)
      is_binary(project_slug) -> ToolExecutor.execute(project_slug, tool, arguments)
      true -> {:error, :project_slug_required}
    end
  end
end
