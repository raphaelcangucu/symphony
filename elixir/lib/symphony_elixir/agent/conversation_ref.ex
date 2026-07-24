defmodule SymphonyElixir.Agent.ConversationRef do
  @moduledoc """
  Stable identity for a resumable conversation owned by an external agent.

  The Symphony assistant thread id is deliberately not part of this value. One
  Symphony thread may hold one conversation reference per provider.
  """

  @providers SymphonyElixir.Settings.Agents.agent_kinds()

  @enforce_keys [:provider, :conversation_id]
  defstruct [:provider, :conversation_id]

  @type t :: %__MODULE__{
          provider: String.t(),
          conversation_id: String.t()
        }

  @spec new(term(), term()) :: {:ok, t()} | {:error, term()}
  def new(provider, conversation_id) do
    with {:ok, provider} <- normalize_required(provider, :provider_required),
         :ok <- validate_provider(provider),
         {:ok, conversation_id} <-
           normalize_required(conversation_id, :conversation_id_required) do
      {:ok, %__MODULE__{provider: provider, conversation_id: conversation_id}}
    end
  end

  @spec load(term()) :: {:ok, t()} | {:error, term()}
  def load(%__MODULE__{} = ref) do
    case new(ref.provider, ref.conversation_id) do
      {:ok, validated} -> {:ok, validated}
      {:error, _reason} -> {:error, :invalid_conversation_ref}
    end
  end

  def load(map) when is_map(map) do
    if canonical_keys?(map) do
      provider = Map.get(map, :provider) || Map.get(map, "provider")
      conversation_id = Map.get(map, :conversation_id) || Map.get(map, "conversation_id")

      case new(provider, conversation_id) do
        {:ok, ref} -> {:ok, ref}
        {:error, _reason} -> {:error, :invalid_conversation_ref}
      end
    else
      {:error, :invalid_conversation_ref}
    end
  end

  def load(_value), do: {:error, :invalid_conversation_ref}

  @spec dump(t()) :: map()
  def dump(%__MODULE__{} = ref) do
    %{"provider" => ref.provider, "conversation_id" => ref.conversation_id}
  end

  @spec providers() :: [String.t()]
  def providers, do: @providers

  defp canonical_keys?(map) do
    Enum.all?(Map.keys(map), &(&1 in [:provider, "provider", :conversation_id, "conversation_id"]))
  end

  defp normalize_required(value, error) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, error}
      normalized -> {:ok, normalized}
    end
  end

  defp normalize_required(_value, error), do: {:error, error}

  defp validate_provider(provider) when provider in @providers, do: :ok
  defp validate_provider(provider), do: {:error, {:unsupported_provider, provider}}
end
