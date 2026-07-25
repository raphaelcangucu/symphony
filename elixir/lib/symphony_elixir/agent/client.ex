defmodule SymphonyElixir.Agent.Client do
  @moduledoc """
  Standalone, provider-neutral client for executing one coding-agent turn.

  The client owns the Symphony execution identity, while provider conversation
  and run identifiers are normalized through the shared agent contracts.
  """

  alias SymphonyElixir.Agent.{BackendCapabilities, ConversationRef, Error, RunResult}
  alias SymphonyElixir.Assistant.AgentSession

  @providers SymphonyElixir.Settings.Agents.agent_kinds() -- ["opencode"]
  @operations [:run, :steer, :goal]
  @goal_prompt """
  Work continuously toward the following persistent objective. Inspect the workspace, make the necessary changes, validate the result, and stop only when the objective is complete or an explicit blocker prevents further progress.

  Persistent objective:
  """

  @type run_option ::
          {:provider, String.t()}
          | {:workspace, Path.t()}
          | {:prompt, String.t()}
          | {:conversation_id, String.t()}
          | {:model, String.t()}
          | {:effort, String.t()}
          | {:execution_mode, String.t()}
          | {:runner, (Path.t(), String.t(), keyword() -> {:ok, map()} | {:error, term()})}
          | {:execution_id_factory, (-> String.t())}

  @spec providers() :: [String.t()]
  def providers, do: @providers

  @spec capabilities(String.t()) :: BackendCapabilities.t()
  def capabilities(provider), do: BackendCapabilities.for(provider)

  @type operation :: :run | :steer | :goal

  @spec execute(operation(), [run_option()]) :: {:ok, map()} | {:error, map()}
  def execute(operation, opts) when operation in @operations and is_list(opts) do
    provider = opts |> Keyword.get(:provider, "codex") |> normalize_string()
    workspace = opts |> Keyword.get(:workspace, File.cwd!()) |> Path.expand()
    prompt = opts |> Keyword.get(:prompt) |> normalize_string()
    conversation_id = Keyword.get(opts, :conversation_id)

    with :ok <- validate_provider(provider),
         :ok <- validate_prompt(prompt),
         :ok <- validate_operation(operation, conversation_id),
         {:ok, conversation_ref} <- conversation_ref(provider, conversation_id),
         runner_opts <- runner_opts(opts, provider, conversation_ref),
         runner <- Keyword.get(opts, :runner, &AgentSession.run_standalone/3),
         {:ok, native_result} <- runner.(workspace, operation_prompt(operation, prompt), runner_opts),
         {:ok, result} <- RunResult.normalize(provider, native_result) do
      execution_id =
        opts
        |> Keyword.get(:execution_id_factory, &execution_id/0)
        |> then(& &1.())

      {:ok,
       result
       |> RunResult.to_map()
       |> Map.put(:execution_id, execution_id)}
    else
      {:error, reason} -> {:error, Error.to_map(reason)}
    end
  end

  def execute(_operation, _opts), do: {:error, Error.to_map({:unsupported_capability, :operation})}

  defp runner_opts(opts, provider, conversation_ref) do
    [
      agent_kind: provider,
      conversation_ref: conversation_ref,
      model: normalized_option(opts, :model),
      effort: normalized_option(opts, :effort),
      execution_mode: normalized_option(opts, :execution_mode)
    ]
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
  end

  defp conversation_ref(_provider, nil), do: {:ok, nil}

  defp conversation_ref(provider, conversation_id),
    do: ConversationRef.new(provider, conversation_id)

  defp validate_provider(provider) when provider in @providers, do: :ok
  defp validate_provider(provider), do: {:error, {:unsupported_provider, provider || "unknown"}}

  defp validate_prompt(prompt) when is_binary(prompt) and prompt != "", do: :ok
  defp validate_prompt(_prompt), do: {:error, :prompt_required}

  defp validate_operation(:steer, conversation_id) do
    case normalize_string(conversation_id) do
      nil -> {:error, :conversation_id_required}
      _conversation_id -> :ok
    end
  end

  defp validate_operation(_operation, _conversation_id), do: :ok

  defp operation_prompt(:goal, prompt), do: @goal_prompt <> prompt
  defp operation_prompt(_operation, prompt), do: prompt

  defp normalized_option(opts, key), do: opts |> Keyword.get(key) |> normalize_string()

  defp normalize_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_string(nil), do: nil
  defp normalize_string(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_string(_value), do: nil

  defp execution_id do
    "exec-" <> Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)
  end
end
