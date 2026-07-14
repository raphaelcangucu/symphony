defmodule SymphonyElixir.Assistant.FileActivityPresenter do
  @moduledoc """
  Pure translation of Codex native command/file-change item events into the
  assistant chat's tool-call shape, so file activity renders as cards.

  Reads are intentionally NOT handled here: they already reach the chat as MCP
  `read_workspace_file` tool calls. This module only surfaces Codex's native
  command execution and file changes, which are otherwise invisible in the chat.
  """

  @type tool_call :: %{
          required(:id) => String.t() | nil,
          required(:name) => String.t(),
          required(:status) => String.t(),
          required(:result) => map(),
          optional(:arguments) => map(),
          optional(:output) => String.t()
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
    command = command_text(item)

    %{
      id: get(item, ["id", :id]),
      name: "shell",
      status: phase_status(phase, item),
      result: command_result(item, phase)
    }
    |> put_if_present(:arguments, if(present_string?(command), do: %{"command" => command}))
    |> put_if_present(:output, if(phase == :completed, do: command_output(item)))
  end

  defp file_change_call(item, phase) do
    paths = change_paths(item)
    native_files = native_file_entries(item)
    {diff, additions, deletions} = native_aggregate(item, native_files)

    %{
      id: get(item, ["id", :id]),
      name: "apply_patch",
      status: phase_status(phase, item),
      result: file_change_result(paths, diff, additions, deletions, native_files, phase)
    }
    |> put_if_present(:arguments, file_change_arguments(paths))
  end

  # Native per-file patches arrive from Codex in one of two shapes: an aggregate
  # top-level `unifiedDiff`/`diff` covering every changed file, or a per-change
  # `unifiedDiff`/`diff`/`patch` attached to each entry in `changes[]`. Callers
  # (AgentSession) rely on an empty list here to know no native patch reached us
  # at all, so they can capture the reported paths themselves via targeted git.
  defp native_file_entries(item) do
    case per_change_entries(item) do
      [] -> diff_split_entries(diff_of(item))
      entries -> entries
    end
  end

  defp per_change_entries(item) do
    case get(item, ["changes", :changes]) do
      list when is_list(list) and list != [] ->
        entries = Enum.map(list, &change_entry/1)
        if Enum.any?(entries, &is_nil/1), do: [], else: entries

      _ ->
        []
    end
  end

  defp change_entry(change) when is_map(change) do
    path = get(change, ["path", :path])
    patch = get(change, ["unifiedDiff", :unifiedDiff, "diff", :diff, "patch", :patch])

    case {path, patch} do
      {path, patch} when is_binary(path) and is_binary(patch) and patch != "" ->
        {additions, deletions} = diff_counts(patch)

        %{
          "path" => path,
          "status" => change_status(change) || status_from_patch(patch),
          "patch" => patch,
          "additions" => additions,
          "deletions" => deletions
        }

      _ ->
        nil
    end
  end

  defp change_entry(_change), do: nil

  defp change_status(change) do
    case get(change, ["status", :status, "kind", :kind, "type", :type]) do
      status when is_binary(status) -> status
      _ -> nil
    end
  end

  defp diff_split_entries(diff) when is_binary(diff) and diff != "" do
    diff
    |> String.split(~r/(?=^--- )/m)
    |> Enum.map(&String.trim_trailing/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.map(&diff_block_entry/1)
    |> Enum.reject(&is_nil/1)
  end

  defp diff_split_entries(_diff), do: []

  defp diff_block_entry(block) do
    case paths_from_diff(block) do
      [path | _] ->
        {additions, deletions} = diff_counts(block)
        %{"path" => path, "status" => status_from_patch(block), "patch" => block, "additions" => additions, "deletions" => deletions}

      [] ->
        nil
    end
  end

  defp status_from_patch(patch) do
    cond do
      String.contains?(patch, "--- /dev/null") -> "added"
      String.contains?(patch, "+++ /dev/null") -> "deleted"
      true -> "modified"
    end
  end

  # No per-file patches were recovered, but Codex may still have reported a
  # top-level diff we can't split into per-file entries (e.g. missing +++/---
  # markers). Fall back to that raw diff/counts instead of reporting nothing.
  defp native_aggregate(item, []) do
    case diff_of(item) do
      top when is_binary(top) and top != "" ->
        {additions, deletions} = diff_counts(top)
        {top, additions, deletions}

      _ ->
        {nil, 0, 0}
    end
  end

  defp native_aggregate(item, native_files) do
    diff =
      case diff_of(item) do
        top when is_binary(top) and top != "" -> top
        _ -> native_files |> Enum.map(&Map.get(&1, "patch")) |> Enum.join("\n")
      end

    additions = Enum.sum(Enum.map(native_files, &Map.get(&1, "additions", 0)))
    deletions = Enum.sum(Enum.map(native_files, &Map.get(&1, "deletions", 0)))
    {diff, additions, deletions}
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

  defp file_change_arguments([]), do: nil
  defp file_change_arguments(paths), do: %{"paths" => paths, "file_count" => length(paths)}

  defp file_change_result(paths, _diff, _additions, _deletions, _native_files, :started),
    do: put_paths_if_present(%{}, paths)

  # No native per-file entries: keep the legacy aggregate-only shape (no "files" key)
  # so sparse start/complete merges against pre-existing timelines stay unchanged.
  defp file_change_result(paths, diff, additions, deletions, [], :completed)
       when is_binary(diff) and diff != "" do
    %{"diff" => diff, "additions" => additions, "deletions" => deletions}
    |> put_paths_if_present(paths)
  end

  defp file_change_result(paths, _diff, _additions, _deletions, [], :completed) do
    %{"diff" => nil, "additions" => 0, "deletions" => 0, "files" => []}
    |> put_paths_if_present(paths)
  end

  defp file_change_result(paths, diff, additions, deletions, native_files, :completed) do
    %{"diff" => diff, "additions" => additions, "deletions" => deletions, "files" => native_files}
    |> put_paths_if_present(paths)
  end

  defp put_paths_if_present(result, []), do: result
  defp put_paths_if_present(result, paths), do: Map.put(result, "paths", paths)

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

  defp put_if_present(map, _key, nil), do: map
  defp put_if_present(map, _key, ""), do: map
  defp put_if_present(map, _key, []), do: map
  defp put_if_present(map, key, value), do: Map.put(map, key, value)

  defp present_string?(value), do: is_binary(value) and value != ""

  defp get(map, keys) when is_map(map), do: Enum.find_value(keys, fn key -> Map.get(map, key) end)
  defp get(_map, _keys), do: nil
end
