defmodule SymphonyElixir.Cursor.CreatePlanBroker do
  @moduledoc """
  Correlates a Cursor ACP `cursor/create_plan` wait with the operator's
  Aceitar/Rejeitar decision from the assistant channel.
  """

  require Logger

  @registry __MODULE__.Registry
  @default_timeout_ms 300_000

  @type decision :: :accept | :reject

  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :unique, name: @registry}

  @spec ensure_started() :: :ok
  def ensure_started do
    case Process.whereis(@registry) do
      nil ->
        case Registry.start_link(keys: :unique, name: @registry) do
          {:ok, _} -> :ok
          {:error, {:already_started, _}} -> :ok
          {:error, reason} ->
            Logger.warning("[Cursor.CreatePlanBroker] registry start failed: #{inspect(reason)}")
            :ok
        end

      _pid ->
        :ok
    end
  end

  @spec await(String.t(), non_neg_integer()) :: decision()
  def await(request_id, timeout_ms \\ @default_timeout_ms)
      when is_binary(request_id) and is_integer(timeout_ms) and timeout_ms >= 0 do
    ensure_started()

    case Registry.register(@registry, request_id, nil) do
      {:ok, _owner} ->
        receive do
          {:create_plan_decision, ^request_id, decision} when decision in [:accept, :reject] ->
            decision
        after
          timeout_ms ->
            Logger.warning("[Cursor.CreatePlanBroker] #{short(request_id)} timed out; rejecting")
            :reject
        end

      {:error, {:already_registered, _pid}} ->
        Logger.warning("[Cursor.CreatePlanBroker] duplicate #{short(request_id)}; rejecting")
        :reject
    end
  end

  @spec resolve(String.t(), decision()) :: :ok
  def resolve(request_id, decision)
      when is_binary(request_id) and decision in [:accept, :reject] do
    ensure_started()

    Registry.dispatch(@registry, request_id, fn entries ->
      Enum.each(entries, fn {pid, _value} ->
        send(pid, {:create_plan_decision, request_id, decision})
      end)
    end)

    :ok
  end

  defp short(id) when is_binary(id) do
    if byte_size(id) > 12, do: binary_part(id, 0, 12), else: id
  end
end
