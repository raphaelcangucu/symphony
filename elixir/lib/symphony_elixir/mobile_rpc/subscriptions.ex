defmodule SymphonyElixir.MobileRpc.Subscriptions do
  @moduledoc "Connection-scoped subscription cleanup registry."

  defstruct entries: %{}

  @type entry :: %{cleanup: (-> any()), sequence: non_neg_integer()}
  @type t :: %__MODULE__{entries: %{optional(String.t()) => entry()}}

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec put(t(), String.t(), (-> any())) :: t()
  def put(%__MODULE__{} = subscriptions, id, cleanup)
      when is_binary(id) and is_function(cleanup, 0) do
    entry = %{cleanup: cleanup, sequence: 0}
    %{subscriptions | entries: Map.put_new(subscriptions.entries, id, entry)}
  end

  @spec next_event(t(), String.t()) ::
          {:ok, pos_integer(), t()} | {:error, :not_found}
  def next_event(%__MODULE__{} = subscriptions, id) do
    case Map.fetch(subscriptions.entries, id) do
      {:ok, entry} ->
        sequence = entry.sequence + 1
        entries = Map.put(subscriptions.entries, id, %{entry | sequence: sequence})
        {:ok, sequence, %{subscriptions | entries: entries}}

      :error ->
        {:error, :not_found}
    end
  end

  @spec remove(t(), String.t()) :: {:ok, t()} | {:error, :not_found}
  def remove(%__MODULE__{} = subscriptions, id) do
    case Map.pop(subscriptions.entries, id) do
      {nil, _entries} ->
        {:error, :not_found}

      {entry, entries} ->
        safe_cleanup(entry.cleanup)
        {:ok, %{subscriptions | entries: entries}}
    end
  end

  @spec cleanup(t()) :: :ok
  def cleanup(%__MODULE__{} = subscriptions) do
    Enum.each(subscriptions.entries, fn {_id, entry} -> safe_cleanup(entry.cleanup) end)
    :ok
  end

  defp safe_cleanup(cleanup) do
    cleanup.()
  rescue
    _error -> :ok
  catch
    _kind, _reason -> :ok
  end
end
