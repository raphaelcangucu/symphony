defmodule SymphonyElixir.MobileRpc.Subscriptions do
  @moduledoc "Connection-scoped subscription cleanup registry."

  defstruct entries: %{}

  @type t :: %__MODULE__{entries: %{optional(String.t()) => (-> any())}}

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec put(t(), String.t(), (-> any())) :: t()
  def put(%__MODULE__{} = subscriptions, id, cleanup)
      when is_binary(id) and is_function(cleanup, 0) do
    %{subscriptions | entries: Map.put_new(subscriptions.entries, id, cleanup)}
  end

  @spec remove(t(), String.t()) :: {:ok, t()} | {:error, :not_found}
  def remove(%__MODULE__{} = subscriptions, id) do
    case Map.pop(subscriptions.entries, id) do
      {nil, _entries} ->
        {:error, :not_found}

      {cleanup, entries} ->
        safe_cleanup(cleanup)
        {:ok, %{subscriptions | entries: entries}}
    end
  end

  @spec cleanup(t()) :: :ok
  def cleanup(%__MODULE__{} = subscriptions) do
    Enum.each(subscriptions.entries, fn {_id, cleanup} -> safe_cleanup(cleanup) end)
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
