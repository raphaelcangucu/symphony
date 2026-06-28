defmodule SymphonyElixir.Assistant.FileActivityPresenter do
  @moduledoc """
  Pure translation of Codex native command/file-change item events into the
  assistant chat's tool-call shape, so file activity renders as cards.

  Reads are intentionally NOT handled here: they already reach the chat as MCP
  `read_workspace_file` tool calls. This module only surfaces Codex's native
  command execution and file changes, which are otherwise invisible in the chat.
  """

  @type tool_call :: %{
          id: String.t() | nil,
          name: String.t(),
          status: String.t(),
          arguments: map() | nil,
          output: String.t() | nil,
          result: map()
        }

  @spec from_event(term()) :: {:started, tool_call()} | {:completed, tool_call()} | :ignore
  def from_event(message) when is_map(message) do
    payload =
      case Map.get(message, :payload) || Map.get(message, "payload") do
        payload when is_map(payload) -> payload
        _ -> %{}
      end

    method = Map.get(payload, "method") || Map.get(payload, :method)
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}

    case method do
      "item/started" -> from_item(params, :started)
      "item/completed" -> from_item(params, :completed)
      _ -> :ignore
    end
  end

  def from_event(_message), do: :ignore

  defp from_item(params, phase) when is_map(params) do
    item = Map.get(params, "item") || Map.get(params, :item) || %{}

    case classify(get(item, ["type", :type])) do
      :command -> {phase_tag(phase), command_call(item, phase)}
      :file_change -> {phase_tag(phase), file_change_call(item, phase)}
      :other -> :ignore
    end
  end

  defp from_item(_params, _phase), do: :ignore

  defp command_call(item, phase) do
    %{
      id: get(item, ["id", :id]),
      name: "shell",
      status: phase_status(phase, item),
      arguments: %{"command" => command_text(item)},
      output: if(phase == :completed, do: command_output(item), else: nil),
      result: command_result(item, phase)
    }
  end

  defp file_change_call(item, phase) do
    paths = change_paths(item)
    diff = diff_of(item)
    {additions, deletions} = diff_counts(diff)

    result =
      if phase == :completed do
        %{"diff" => diff, "additions" => additions, "deletions" => deletions, "paths" => paths}
      else
        %{"paths" => paths}
      end

    %{
      id: get(item, ["id", :id]),
      name: "apply_patch",
      status: phase_status(phase, item),
      arguments: %{"paths" => paths, "file_count" => length(paths)},
      output: nil,
      result: result
    }
  end

  defp classify(type) when is_binary(type) do
    normalized = type |> String.downcase() |> String.replace(~r/[^a-z]/, "")

    cond do
      String.contains?(normalized, "command") -> :command
      String.contains?(normalized, "filechange") -> :file_change
      String.contains?(normalized, "patch") -> :file_change
      true -> :other
    end
  end

  defp classify(_type), do: :other

  defp phase_tag(:started), do: :started
  defp phase_tag(:completed), do: :completed

  defp phase_status(:started, _item), do: "running"

  defp phase_status(:completed, item) do
    case get(item, ["status", :status]) do
      "failed" -> "error"
      "error" -> "error"
      _ -> "complete"
    end
  end

  defp command_text(item) do
    case get(item, ["command", :command, "parsedCmd", :parsedCmd, "cmd", :cmd]) do
      cmd when is_binary(cmd) -> cmd
      list when is_list(list) -> list |> Enum.filter(&is_binary/1) |> Enum.join(" ")
      _ -> nil
    end
  end

  defp command_output(item) do
    case get(item, ["aggregatedOutput", :aggregatedOutput, "output", :output]) do
      output when is_binary(output) -> output
      _ -> nil
    end
  end

  defp command_result(item, :completed) do
    case get(item, ["exitCode", :exitCode, "exit_code", :exit_code]) do
      code when is_integer(code) -> %{"exit_code" => code}
      _ -> %{}
    end
  end

  defp command_result(_item, :started), do: %{}

  defp change_paths(item) do
    from_changes =
      case get(item, ["changes", :changes]) do
        list when is_list(list) -> list |> Enum.map(&get(&1, ["path", :path])) |> Enum.reject(&is_nil/1)
        _ -> []
      end

    if from_changes == [], do: paths_from_diff(diff_of(item)), else: from_changes
  end

  defp diff_of(item), do: get(item, ["unifiedDiff", :unifiedDiff, "diff", :diff])

  defp paths_from_diff(diff) when is_binary(diff) do
    diff
    |> String.split("\n")
    |> Enum.filter(&String.starts_with?(&1, "+++ "))
    |> Enum.map(fn line ->
      line
      |> String.replace_prefix("+++ ", "")
      |> String.replace_prefix("b/", "")
      |> String.replace_prefix("a/", "")
      |> String.trim()
    end)
    |> Enum.reject(&(&1 == "" or &1 == "/dev/null"))
  end

  defp paths_from_diff(_diff), do: []

  defp diff_counts(diff) when is_binary(diff) do
    lines = String.split(diff, "\n")
    additions = Enum.count(lines, &(String.starts_with?(&1, "+") and not String.starts_with?(&1, "+++")))
    deletions = Enum.count(lines, &(String.starts_with?(&1, "-") and not String.starts_with?(&1, "---")))
    {additions, deletions}
  end

  defp diff_counts(_diff), do: {0, 0}

  defp get(map, keys) when is_map(map), do: Enum.find_value(keys, fn key -> Map.get(map, key) end)
  defp get(_map, _keys), do: nil
end
