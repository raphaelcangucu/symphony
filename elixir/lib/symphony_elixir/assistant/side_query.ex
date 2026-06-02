defmodule SymphonyElixir.Assistant.SideQuery do
  @moduledoc """
  Ephemeral, read-only, no-tool one-shot side answers for the `/btw` command.

  Builds a prompt from the thread's recent history plus a side-question instruction,
  runs a single Codex turn with no tools, streams deltas, and returns the answer text.
  Nothing is persisted to the conversation history.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Codex.CodingAgent

  @history_limit 20

  @system_instruction """
  This is a side question from the user. Answer it directly in a single response.
  You are a separate, lightweight assistant; the main agent is NOT interrupted.
  You share the conversation context but have NO tools available: do not read files,
  run commands, or promise to take any action. Never say "Let me try" — just answer.
  """

  @spec run(map(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def run(%{id: thread_id, workspace_path: workspace_path} = _thread, question, opts \\ [])
      when is_binary(question) and is_list(opts) do
    with {:ok, trimmed} <- normalize(question),
         workspace <- resolve_workspace(workspace_path),
         :ok <- File.mkdir_p(workspace) do
      history =
        thread_id
        |> history_for()
        |> Enum.map(&History.message_payload/1)

      prompt = build_prompt(history, trimmed)
      runner = Keyword.get(opts, :runner, &default_runner/4)

      runner_opts = [
        dynamic_tools: [],
        tool_executor: fn _tool, _arguments -> {:error, :no_tools_in_side_query} end,
        on_assistant_delta: Keyword.get(opts, :on_delta, fn _delta -> :ok end)
      ]

      case runner.(workspace, prompt, side_issue(), runner_opts) do
        {:ok, %{assistant_message: answer}} when is_binary(answer) -> {:ok, answer}
        {:ok, _other} -> {:error, :no_answer}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp history_for(thread_id) when is_integer(thread_id) do
    History.list_messages_for_thread(thread_id)
  end

  defp history_for(_other), do: []

  defp normalize(question) do
    case String.trim(question) do
      "" -> {:error, :question_required}
      trimmed -> {:ok, trimmed}
    end
  end

  defp resolve_workspace(path) when is_binary(path) and path != "", do: path
  defp resolve_workspace(_path), do: System.tmp_dir!()

  defp side_issue, do: %{id: "assistant:btw", identifier: "btw", title: "Side question"}

  defp build_prompt(history, question) do
    """
    #{@system_instruction}

    Recent conversation:
    #{format_history(history)}

    Side question:
    #{question}
    """
    |> String.trim()
  end

  defp format_history(history) do
    history
    |> Enum.take(-@history_limit)
    |> Enum.map(fn message ->
      role = Map.get(message, :role) || Map.get(message, "role")
      content = Map.get(message, :content) || Map.get(message, "content")
      "#{role}: #{content}"
    end)
    |> case do
      [] -> "(no prior messages)"
      lines -> Enum.join(lines, "\n")
    end
  end

  defp default_runner(workspace, prompt, issue, opts) do
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)

      if is_binary(delta) and delta != "" do
        Agent.update(collector, fn acc -> acc <> delta end)
        Keyword.get(opts, :on_assistant_delta, fn _ -> :ok end).(delta)
      end
    end

    try do
      case CodingAgent.run(workspace, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
        {:ok, _result} ->
          {:ok, %{assistant_message: fallback(Agent.get(collector, & &1)), tool_calls: []}}

        {:error, reason} ->
          {:error, reason}
      end
    after
      Agent.stop(collector)
    end
  end

  defp extract_delta(message) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}

    get_in(payload, ["params", "delta"]) ||
      get_in(payload, ["params", "text"]) ||
      get_in(payload, ["params", "message", "content"])
  end

  defp extract_delta(_message), do: nil

  defp fallback(""), do: "(no answer returned)"
  defp fallback(text), do: text
end
