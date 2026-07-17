defmodule SymphonyElixir.Tracker.Cli do
  @moduledoc """
  In-daemon dispatcher for `mix symphony.tracker` and `mix symphony.tool`.
  Runs inside the live Symphony daemon (invoked over `:erpc`) so the tracker
  SQLite database keeps a single owner. Maps a tool name + project slug +
  argument map onto the same assistant surfaces chat uses
  (`ToolExecutor`, discovery, GraphQL dynamic tools).
  """

  alias SymphonyElixir.Assistant.{DiscoveryTools, RunningAgentsTools, ToolExecutor}
  alias SymphonyElixir.Codex.DynamicTool

  @discovery_tools DiscoveryTools.tools()
  @running_agents_tool RunningAgentsTools.tool_name()
  @dynamic_tools Enum.map(DynamicTool.tool_specs(), & &1["name"])

  @spec call(String.t(), String.t() | nil, map()) :: {:ok, map()} | {:error, term()}
  def call(tool, project_slug, arguments)
      when is_binary(tool) and (is_nil(project_slug) or is_binary(project_slug)) and is_map(arguments) do
    arguments = stringify_keys(arguments)

    cond do
      tool in @discovery_tools ->
        DiscoveryTools.execute(tool, arguments, [])

      tool in @dynamic_tools ->
        wrap_dynamic(DynamicTool.execute(tool, arguments, []))

      tool == @running_agents_tool and is_nil(project_slug) ->
        RunningAgentsTools.execute(nil, arguments)

      is_binary(project_slug) ->
        ToolExecutor.execute(project_slug, tool, arguments)

      true ->
        {:error, :project_slug_required}
    end
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} when is_binary(key) -> {key, value}
      {key, value} -> {to_string(key), value}
    end)
  end

  defp wrap_dynamic(%{"success" => true, "toolResult" => result}) when is_map(result) do
    {:ok,
     %{
       tool: result["tool"] || result[:tool],
       message: result["message"] || result[:message] || "ok",
       data: result["data"] || result[:data] || result
     }}
  end

  defp wrap_dynamic(%{"success" => true, "contentItems" => items} = response) do
    text =
      items
      |> List.wrap()
      |> Enum.map_join("\n", fn
        %{"text" => t} when is_binary(t) -> t
        %{"type" => "inputText", "text" => t} when is_binary(t) -> t
        _ -> ""
      end)

    data =
      case Jason.decode(text) do
        {:ok, decoded} -> decoded
        _ -> %{"raw" => text}
      end

    {:ok, %{tool: response["tool"] || "dynamic", message: "ok", data: data}}
  end

  defp wrap_dynamic(%{"success" => false} = response) do
    {:error, response["error"] || response}
  end

  defp wrap_dynamic(other), do: {:error, {:unexpected_dynamic_result, other}}
end
