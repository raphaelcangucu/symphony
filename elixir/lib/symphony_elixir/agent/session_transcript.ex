defmodule SymphonyElixir.Agent.SessionTranscript do
  @moduledoc """
  Best-effort Symphony-owned JSONL transcript + sidecar for headless CLI agents.

  Writes under `<workspace>/.symphony/<agent>-session.jsonl` so Autonomous
  `SessionLog` polling does not depend on external Cursor/Claude project logs.
  """

  require Logger

  @agents %{
    cursor: "cursor-session",
    claude: "claude-session"
  }

  @spec path(atom() | String.t(), Path.t()) :: Path.t()
  def path(agent_kind, workspace) when is_binary(workspace) do
    base = Map.fetch!(@agents, normalize_agent(agent_kind))
    Path.join(Path.expand(workspace), ".symphony/#{base}.jsonl")
  end

  @spec sidecar_path(atom() | String.t(), Path.t()) :: Path.t()
  def sidecar_path(agent_kind, workspace) when is_binary(workspace) do
    base = Map.fetch!(@agents, normalize_agent(agent_kind))
    Path.join(Path.expand(workspace), ".symphony/#{base}.json")
  end

  @spec append(atom() | String.t(), Path.t(), map() | String.t()) :: :ok
  def append(agent_kind, workspace, entry) when is_binary(workspace) do
    with {:ok, line} <- encode_line(entry),
         path <- path(agent_kind, workspace),
         :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(path, line <> "\n", [:append]) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionTranscript.append failed: #{inspect(reason)}")
        :ok

      :error ->
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionTranscript.append crashed: #{Exception.message(error)}")
      :ok
  end

  @spec write_sidecar(atom() | String.t(), Path.t(), map()) :: :ok
  def write_sidecar(agent_kind, workspace, meta) when is_binary(workspace) and is_map(meta) do
    path = sidecar_path(agent_kind, workspace)

    payload =
      meta
      |> stringify_keys()
      |> Map.put_new("started_at", DateTime.utc_now() |> DateTime.to_iso8601())

    with :ok <- File.mkdir_p(Path.dirname(path)),
         {:ok, json} <- Jason.encode(payload),
         :ok <- File.write(path, json) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("SessionTranscript.write_sidecar failed: #{inspect(reason)}")
        :ok
    end
  rescue
    error ->
      Logger.warning("SessionTranscript.write_sidecar crashed: #{Exception.message(error)}")
      :ok
  end

  @spec read_sidecar(atom() | String.t(), Path.t()) :: {:ok, map()} | :error
  def read_sidecar(agent_kind, workspace) when is_binary(workspace) do
    with {:ok, contents} <- File.read(sidecar_path(agent_kind, workspace)),
         {:ok, %{} = decoded} <- Jason.decode(contents) do
      {:ok, decoded}
    else
      _ -> :error
    end
  end

  @doc """
  Builds a Claude-style JSONL line from a bridge `item/created` item map.
  Returns `nil` for item types that should not be persisted (e.g. thinking).
  """
  @spec line_from_bridge_item(map()) :: map() | nil
  def line_from_bridge_item(%{"type" => "text", "text" => text})
      when is_binary(text) and text != "" do
    %{
      "type" => "assistant",
      "message" => %{"content" => [%{"type" => "text", "text" => text}]}
    }
  end

  def line_from_bridge_item(%{"type" => "tool_call", "tool_use_id" => id, "name" => name} = item)
      when is_binary(id) and is_binary(name) do
    %{
      "type" => "assistant",
      "message" => %{
        "content" => [
          %{
            "type" => "tool_use",
            "id" => id,
            "name" => name,
            "input" => Map.get(item, "input") || %{}
          }
        ]
      }
    }
  end

  def line_from_bridge_item(%{"type" => "tool_result", "tool_use_id" => id} = item)
      when is_binary(id) do
    %{
      "type" => "user",
      "message" => %{
        "content" => [
          %{
            "type" => "tool_result",
            "tool_use_id" => id,
            "content" => Map.get(item, "content"),
            "is_error" => Map.get(item, "is_error", false)
          }
        ]
      }
    }
  end

  def line_from_bridge_item(_item), do: nil

  @doc false
  @spec maybe_append_bridge_item(atom() | String.t(), Path.t(), map()) :: :ok
  def maybe_append_bridge_item(agent_kind, workspace, %{
        "method" => "item/created",
        "params" => %{"item" => item}
      }) do
    case line_from_bridge_item(item) do
      nil -> :ok
      line -> append(agent_kind, workspace, line)
    end
  end

  def maybe_append_bridge_item(_agent_kind, _workspace, _notification), do: :ok

  defp encode_line(line) when is_binary(line), do: {:ok, String.trim_trailing(line)}
  defp encode_line(%{} = entry), do: Jason.encode(entry)
  defp encode_line(_), do: :error

  defp normalize_agent(:cursor), do: :cursor
  defp normalize_agent("cursor"), do: :cursor
  defp normalize_agent(:claude), do: :claude
  defp normalize_agent("claude"), do: :claude

  defp normalize_agent(other),
    do: raise(ArgumentError, "unsupported agent_kind: #{inspect(other)}")

  defp stringify_keys(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} when is_binary(k) -> {k, v}
    end)
  end
end
