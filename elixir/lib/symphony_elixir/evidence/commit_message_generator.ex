defmodule SymphonyElixir.Evidence.CommitMessageGenerator do
  @moduledoc """
  One-shot, no-tools commit message generation from a diff summary.

  Builds a prompt from the issue context and staged/uncommitted diff text,
  runs a single Codex turn with no tools, and returns a trimmed conventional
  commit message. Nothing is persisted to the conversation history.
  """

  alias SymphonyElixir.Codex.CodingAgent

  @max_diff_bytes 24_000

  @system """
  Write a concise conventional commit message for the change shown below.
  Use imperative mood in the subject (e.g. "feat: add dock branches").
  Include a short body only when it adds clarity. You have NO tools — do not
  read files, run commands, or promise to take any action.

  Return only the final commit message and nothing else.
  """

  @spec generate(Path.t(), map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def generate(workspace, issue, opts \\ []) when is_binary(workspace) and is_map(issue) do
    with {:ok, diff_summary} <- normalize_diff_summary(Keyword.get(opts, :diff_summary)),
         prompt <- build_prompt(prompt_input(issue, diff_summary)),
         runner <- Keyword.get(opts, :runner, &default_runner/4),
         runner_opts <- runner_opts(opts) do
      case runner.(workspace, prompt, issue, runner_opts) do
        {:ok, %{assistant_message: message}} when is_binary(message) ->
          case normalize_message(message) do
            "" -> {:error, :no_answer}
            trimmed -> {:ok, trimmed}
          end

        {:ok, _other} ->
          {:error, :no_answer}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  @spec build_prompt(map()) :: String.t()
  def build_prompt(%{identifier: identifier, title: title, diff_summary: diff_summary}) do
    """
    #{@system}

    ## Issue
    #{identifier}: #{title}

    ## Change (git diff)
    #{diff_summary}

    Return only the final commit message.
    """
    |> String.trim()
  end

  defp prompt_input(issue, diff_summary) do
    %{
      identifier: Map.get(issue, :identifier, ""),
      title: Map.get(issue, :title, ""),
      diff_summary: truncate_diff(diff_summary)
    }
  end

  defp normalize_diff_summary(summary) when is_binary(summary) do
    case String.trim(summary) do
      "" -> {:error, :nothing_to_commit}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_diff_summary(_other), do: {:error, :nothing_to_commit}

  defp truncate_diff(diff) do
    if byte_size(diff) > @max_diff_bytes do
      String.slice(diff, 0, @max_diff_bytes)
    else
      diff
    end
  end

  defp normalize_message(message) do
    message
    |> strip_markdown_fences()
    |> String.trim()
  end

  defp strip_markdown_fences(text) do
    trimmed = String.trim(text)

    case Regex.run(~r/^```(?:\w*)\n?(.*?)\n?```$/s, trimmed) do
      [_, inner] -> String.trim(inner)
      _ -> trimmed
    end
  end

  defp runner_opts(opts) when is_list(opts) do
    base = [
      dynamic_tools: [],
      tool_executor: fn _tool, _arguments -> {:error, :no_tools} end
    ]

    case Keyword.get(opts, :workspace_root) do
      root when is_binary(root) and root != "" -> Keyword.put(base, :workspace_root, root)
      _ -> base
    end
  end

  defp default_runner(workspace, prompt, issue, opts) do
    {:ok, collector} = Agent.start_link(fn -> "" end)

    on_message = fn message ->
      delta = extract_delta(message)

      if is_binary(delta) and delta != "" do
        Agent.update(collector, fn acc -> acc <> delta end)
      end
    end

    try do
      case CodingAgent.run(workspace, prompt, issue, Keyword.put(opts, :on_message, on_message)) do
        {:ok, _result} ->
          {:ok, %{assistant_message: Agent.get(collector, & &1)}}

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
end
