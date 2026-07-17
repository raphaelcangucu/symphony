defmodule SymphonyElixirWeb.Tracker.SubagentsController do
  @moduledoc """
  Lists SUBAGENT transcripts for a parent assistant thread's session log.

  Optional `match_prompt` ranks by a simple normalized prefix heuristic: trim,
  collapse whitespace, downcase, and keep the first 200 characters of both the
  query and each entry's label. Entries where either side is a prefix of the
  other are returned first (and exclusively when any match exists).
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.SessionLog

  @known_agent_kinds ["codex", "claude", "cursor", "opencode"]
  @match_prompt_max_chars 200

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => _project_slug, "thread_id" => thread_id} = params) do
    with {:ok, id} <- parse_thread_id(thread_id),
         {:ok, thread} <- History.get_thread(id),
         {:ok, log_agent_kind, parent_path} <- SessionLog.resolve_for_session(thread) do
      agent_kind = resolve_agent_kind(params["agent_kind"], log_agent_kind)

      subagents =
        agent_kind
        |> SessionLog.list_subagents(parent_path, [])
        |> maybe_filter_tool_use_id(params["tool_use_id"])
        |> maybe_rank_match_prompt(params["match_prompt"])
        |> Enum.map(&public_entry(&1, agent_kind))

      json(conn, %{"subagents" => subagents})
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{"error" => %{"message" => "session log unavailable"}})
    end
  end

  defp parse_thread_id(thread_id) when is_integer(thread_id) and thread_id > 0, do: {:ok, thread_id}

  defp parse_thread_id(thread_id) when is_binary(thread_id) do
    case Integer.parse(thread_id) do
      {id, ""} when id > 0 -> {:ok, id}
      _ -> :error
    end
  end

  defp parse_thread_id(_thread_id), do: :error

  defp resolve_agent_kind(kind, _fallback) when kind in @known_agent_kinds, do: kind
  defp resolve_agent_kind(_kind, fallback), do: fallback

  defp maybe_filter_tool_use_id(subagents, tool_use_id)
       when is_binary(tool_use_id) and tool_use_id != "" do
    Enum.filter(subagents, &(&1["tool_use_id"] == tool_use_id))
  end

  defp maybe_filter_tool_use_id(subagents, _tool_use_id), do: subagents

  defp maybe_rank_match_prompt(subagents, prompt) when is_binary(prompt) and prompt != "" do
    normalized_prompt = normalize_match_text(prompt)

    {matches, rest} =
      Enum.split_with(subagents, fn entry ->
        label = normalize_match_text(entry["label"] || "")
        label != "" and (String.starts_with?(normalized_prompt, label) or String.starts_with?(label, normalized_prompt))
      end)

    if matches == [], do: rest, else: matches
  end

  defp maybe_rank_match_prompt(subagents, _prompt), do: subagents

  defp normalize_match_text(text) when is_binary(text) do
    text
    |> String.trim()
    |> String.replace(~r/\s+/, " ")
    |> String.downcase()
    |> String.slice(0, @match_prompt_max_chars)
  end

  defp public_entry(entry, agent_kind) do
    %{
      "id" => entry["id"],
      "agent_kind" => agent_kind,
      "label" => entry["label"],
      "nickname" => entry["nickname"],
      "role" => entry["role"],
      "tool_use_id" => entry["tool_use_id"]
    }
  end
end
