defmodule SymphonyElixir.Agent.RunResult do
  @moduledoc """
  Canonical result of one agent run.

  Provider adapters must translate native response keys before constructing this
  value. Assistant lifecycle and persistence code accept only the canonical
  fields below.
  """

  alias SymphonyElixir.Agent.ConversationRef

  @legacy_identity_fields ~w(
    agent_thread_id
    agent_thread_ids
    cli_session_id
    codex_thread_id
    external_id
    provider_session_id
    session_id
    thread_id
    turn_id
  )

  @enforce_keys [:provider, :conversation_id, :run_id, :assistant_message]
  defstruct provider: nil,
            conversation_id: nil,
            run_id: nil,
            execution_id: nil,
            status: "completed",
            assistant_message: nil,
            tool_calls: [],
            content_blocks: nil,
            usage: nil,
            cost_usd: nil,
            resolved_model: nil,
            resolved_effort: nil

  @type t :: %__MODULE__{
          provider: String.t(),
          conversation_id: String.t(),
          run_id: String.t(),
          execution_id: String.t() | nil,
          status: String.t(),
          assistant_message: String.t(),
          tool_calls: list(),
          content_blocks: list() | nil,
          usage: map() | nil,
          cost_usd: number() | nil,
          resolved_model: String.t() | nil,
          resolved_effort: String.t() | nil
        }

  @spec normalize(String.t() | atom(), map()) :: {:ok, t()} | {:error, term()}
  def normalize(provider, result) when is_map(result) do
    provider = provider |> to_string() |> String.trim()
    assistant_message = get(result, :assistant_message)

    with :ok <- reject_legacy_identity_fields(result),
         :ok <- validate_result_provider(provider, get(result, :provider)),
         {:ok, conversation_ref} <-
           ConversationRef.new(provider, get(result, :conversation_id)),
         {:ok, run_id} <- required_string(get(result, :run_id), :run_id_required),
         {:ok, assistant_message} <-
           required_message(assistant_message) do
      {:ok,
       %__MODULE__{
         provider: provider,
         conversation_id: conversation_ref.conversation_id,
         run_id: run_id,
         execution_id: string_value(get(result, :execution_id)),
         status: string_value(get(result, :status)) || "completed",
         assistant_message: assistant_message,
         tool_calls: get(result, :tool_calls) || [],
         content_blocks: get(result, :content_blocks),
         usage: get(result, :usage),
         cost_usd: get(result, :cost_usd),
         resolved_model: string_value(get(result, :resolved_model)),
         resolved_effort: string_value(get(result, :resolved_effort))
       }}
    end
  end

  def normalize(_provider, _result), do: {:error, :invalid_runner_result}

  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = result) do
    %{
      provider: result.provider,
      conversation_id: result.conversation_id,
      run_id: result.run_id,
      execution_id: result.execution_id,
      status: result.status,
      assistant_message: result.assistant_message,
      tool_calls: result.tool_calls,
      content_blocks: result.content_blocks,
      usage: result.usage,
      cost_usd: result.cost_usd,
      resolved_model: result.resolved_model,
      resolved_effort: result.resolved_effort
    }
  end

  defp get(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp reject_legacy_identity_fields(result) do
    if Enum.any?(Map.keys(result), &legacy_identity_field?/1) do
      {:error, :legacy_identity_field}
    else
      :ok
    end
  end

  defp legacy_identity_field?(field) when is_atom(field),
    do: Atom.to_string(field) in @legacy_identity_fields

  defp legacy_identity_field?(field) when is_binary(field), do: field in @legacy_identity_fields
  defp legacy_identity_field?(_field), do: false

  defp validate_result_provider(_expected, nil), do: :ok

  defp validate_result_provider(expected, actual) when is_atom(actual),
    do: validate_result_provider(expected, Atom.to_string(actual))

  defp validate_result_provider(expected, actual) when is_binary(actual) do
    case String.trim(actual) do
      ^expected -> :ok
      normalized -> {:error, {:provider_mismatch, expected, normalized}}
    end
  end

  defp validate_result_provider(expected, actual),
    do: {:error, {:provider_mismatch, expected, inspect(actual)}}

  defp required_string(value, error) do
    case string_value(value) do
      nil -> {:error, error}
      normalized -> {:ok, normalized}
    end
  end

  defp required_message(value) when is_binary(value) and byte_size(value) > 0, do: {:ok, value}

  defp required_message(_value), do: {:error, :assistant_message_required}

  defp string_value(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      normalized -> normalized
    end
  end

  defp string_value(nil), do: nil
  defp string_value(value), do: to_string(value)
end
