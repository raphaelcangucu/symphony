defmodule SymphonyElixir.Assistant.TitleGenerator do
  @moduledoc """
  One-shot, no-tools session title generation from early chat context.

  Builds a prompt from the first user/assistant exchange, runs a single Codex
  turn with no tools, and returns a normalized short title. Persistence and
  eligibility checks live in companion functions used by auto-title and magic
  rename.
  """

  require Logger

  alias SymphonyElixir.Assistant.{History, Thread}
  alias SymphonyElixir.Codex.CodingAgent

  @sidebar_title_max_graphemes 160
  @history_limit 12

  @generic_titles MapSet.new([
                    "Project session",
                    "Issue session",
                    "Workspace session",
                    "Telegram freeform chat",
                    "Session fork"
                  ])

  @system """
  Write a short session title (3–8 words) that captures the topic of this chat.
  Match the language of the conversation (Portuguese or English).
  Prefer subject + action (e.g. "Cleanup goapi GAM-19"), not meta labels
  like "Chat with assistant" or "Conversation".
  You have NO tools — do not read files, run commands, or promise actions.
  Return only the title text: no quotes, no "Title:" prefix, no markdown.
  """

  @type message :: %{optional(atom()) => term(), optional(String.t()) => term()}
  @type thread_like :: %{optional(:title) => term(), optional(:metadata) => term(), optional(atom()) => term()}

  @spec normalize_title(term()) :: String.t()
  def normalize_title(nil), do: ""

  def normalize_title(raw) when is_binary(raw) do
    raw
    |> strip_markdown_fences()
    |> String.trim()
    |> strip_title_prefix()
    |> strip_wrapping_quotes()
    |> String.trim()
    |> truncate_graphemes(@sidebar_title_max_graphemes)
  end

  def normalize_title(_other), do: ""

  @spec generic_title?(term()) :: boolean()
  def generic_title?(nil), do: true

  def generic_title?(title) when is_binary(title) do
    trimmed = String.trim(title)
    trimmed == "" or MapSet.member?(@generic_titles, trimmed)
  end

  def generic_title?(_other), do: true

  @spec enough_context?([message()]) :: boolean()
  def enough_context?(messages) when is_list(messages) do
    roles =
      messages
      |> Enum.map(&message_role/1)
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()

    MapSet.member?(roles, "user") and MapSet.member?(roles, "assistant")
  end

  def enough_context?(_other), do: false

  @spec auto_eligible?(thread_like()) :: boolean()
  def auto_eligible?(%{metadata: metadata} = thread) when is_map(metadata) do
    Map.get(metadata, "title_auto_eligible") == true and
      is_nil(Map.get(metadata, "title_auto_generated_at")) and
      generic_title?(Map.get(thread, :title))
  end

  def auto_eligible?(_thread), do: false

  @spec build_prompt([message()]) :: String.t()
  def build_prompt(messages) when is_list(messages) do
    """
    #{@system}

    Conversation:
    #{format_history(messages)}

    Return only the title.
    """
    |> String.trim()
  end

  @spec generate([message()], keyword()) :: {:ok, String.t()} | {:error, term()}
  def generate(messages, opts \\ []) when is_list(messages) and is_list(opts) do
    cond do
      not enough_context?(messages) ->
        {:error, :not_enough_context}

      true ->
        workspace = Keyword.get(opts, :workspace) || System.tmp_dir!()
        runner = resolve_runner(opts)
        prompt = build_prompt(Enum.take(messages, @history_limit))

        case runner.(workspace, prompt, title_issue(), runner_opts(opts)) do
          {:ok, %{assistant_message: message}} when is_binary(message) ->
            case normalize_title(message) do
              "" -> {:error, :no_answer}
              title -> {:ok, title}
            end

          {:ok, _other} ->
            {:error, :no_answer}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  @doc """
  Generates a title from the thread history and persists it.

  Options:
    * `:mode` — `:magic` (default) always overwrites; `:auto` only when eligible
      and stamps `title_auto_generated_at`.
    * `:runner` — injectable LLM runner for tests.
  """
  @spec generate_and_persist(integer(), keyword()) :: {:ok, Thread.t()} | {:error, term()}
  def generate_and_persist(thread_id, opts \\ [])
      when is_integer(thread_id) and thread_id > 0 and is_list(opts) do
    mode = Keyword.get(opts, :mode, :magic)

    with {:ok, thread} <- History.get_thread(thread_id),
         :ok <- check_mode(thread, mode),
         messages <- history_payloads(thread_id),
         {:ok, title} <-
           generate(messages,
             Keyword.take(opts, [:runner]) ++
               [workspace: thread.workspace_path || System.tmp_dir!()]
           ),
         {:ok, updated} <- History.update_thread_sidebar_metadata(thread_id, %{title: title}),
         {:ok, stamped} <- maybe_stamp_auto(updated, mode) do
      {:ok, stamped}
    end
  end

  @doc "Fire-and-forget auto-title when the thread is eligible; swallows errors."
  @spec maybe_auto_generate(integer(), keyword()) :: :ok
  def maybe_auto_generate(thread_id, opts \\ []) when is_integer(thread_id) and thread_id > 0 do
    case generate_and_persist(thread_id, Keyword.put(opts, :mode, :auto)) do
      {:ok, _thread} ->
        :ok

      {:error, :not_eligible} ->
        :ok

      {:error, reason} ->
        Logger.info("assistant title auto-generate skipped thread=#{thread_id} reason=#{inspect(reason)}")
        :ok
    end
  end

  @spec put_auto_eligible(map()) :: map()
  def put_auto_eligible(metadata) when is_map(metadata),
    do: Map.put(metadata, "title_auto_eligible", true)

  def put_auto_eligible(_metadata), do: %{"title_auto_eligible" => true}

  defp check_mode(thread, :auto) do
    if auto_eligible?(thread), do: :ok, else: {:error, :not_eligible}
  end

  defp check_mode(_thread, :magic), do: :ok
  defp check_mode(_thread, _mode), do: {:error, :invalid_mode}

  defp maybe_stamp_auto(thread, :auto) do
    next =
      (thread.metadata || %{})
      |> Map.put("title_auto_generated_at", DateTime.utc_now() |> DateTime.to_iso8601())

    History.update_thread(thread, %{metadata: next})
  end

  defp maybe_stamp_auto(thread, _mode), do: {:ok, thread}

  defp history_payloads(thread_id) do
    thread_id
    |> History.list_messages_for_thread(limit: @history_limit)
    |> Enum.map(&History.message_payload/1)
  end

  defp format_history(messages) do
    messages
    |> Enum.map(fn message ->
      role = message_role(message) || "unknown"
      content = message_content(message) || ""
      "#{role}: #{content}"
    end)
    |> case do
      [] -> "(no messages)"
      lines -> Enum.join(lines, "\n")
    end
  end

  defp message_role(message) when is_map(message) do
    case Map.get(message, :role) || Map.get(message, "role") do
      role when is_binary(role) -> role
      _ -> nil
    end
  end

  defp message_content(message) when is_map(message) do
    Map.get(message, :content) || Map.get(message, "content")
  end

  defp strip_title_prefix(text) do
    case Regex.run(~r/\ATitle:\s*/i, text) do
      [prefix] -> String.replace_prefix(text, prefix, "")
      _ -> text
    end
  end

  defp strip_wrapping_quotes(text) do
    case Regex.run(~r/\A(["'“”‘’])(.*)\1\z/u, text) do
      [_, _quote, inner] -> inner
      _ -> text
    end
  end

  defp strip_markdown_fences(text) do
    trimmed = String.trim(text)

    case Regex.run(~r/^```(?:\w*)\n?(.*?)\n?```$/s, trimmed) do
      [_, inner] -> String.trim(inner)
      _ -> trimmed
    end
  end

  defp truncate_graphemes(text, max) when is_binary(text) and is_integer(max) and max > 0 do
    graphemes = String.graphemes(text)

    if length(graphemes) <= max do
      text
    else
      graphemes |> Enum.take(max) |> Enum.join()
    end
  end

  defp title_issue,
    do: %{id: "assistant:title", identifier: "title", title: "Session title"}

  defp resolve_runner(opts) do
    Keyword.get(opts, :runner) ||
      Application.get_env(:symphony_elixir, :title_generator_runner) ||
      &default_runner/4
  end

  defp runner_opts(_opts) do
    [
      dynamic_tools: [],
      tool_executor: fn _tool, _arguments -> {:error, :no_tools} end
    ]
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
