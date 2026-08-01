defmodule SymphonyElixir.AgentUsage.Refresh do
  @moduledoc """
  Generation-safe, per-account usage refresh with failure-specific backoff.
  """

  alias SymphonyElixir.AgentUsage

  @default_base_backoff_ms 60_000
  @default_auth_backoff_ms 300_000
  @max_backoff_ms 3_600_000

  @spec run(String.t(), String.t(), (-> term()), keyword()) ::
          :ok | :skip | {:error, atom()}
  def run(agent_kind, account_id, fetcher, options \\ [])
      when is_function(fetcher, 0) do
    now_ms = Keyword.get(options, :now_ms, System.monotonic_time(:millisecond))

    case AgentUsage.begin_refresh(agent_kind, account_id,
           now_ms: now_ms,
           force: Keyword.get(options, :force, false)
         ) do
      {:ok, generation} ->
        result = safe_fetch(fetcher)
        backoff_ms = backoff(result, AgentUsage.entry(agent_kind, account_id), options)

        case AgentUsage.complete_refresh(
               agent_kind,
               account_id,
               generation,
               result,
               now_ms: now_ms,
               backoff_ms: backoff_ms
             ) do
          :ignored -> :skip
          :ok -> public_result(result)
        end

      {:error, reason} when reason in [:already_refreshing, :backoff] ->
        :skip
    end
  end

  defp safe_fetch(fetcher) do
    fetcher.()
  rescue
    _error -> {:error, :provider_error}
  catch
    :exit, {:timeout, _detail} -> {:error, :timeout}
    _kind, _reason -> {:error, :provider_error}
  end

  defp backoff({:ok, _snapshot}, _entry, _options), do: 0
  defp backoff({:error, {:rate_limited, retry_after_ms}}, _entry, _options), do: retry_after_ms

  defp backoff({:error, reason}, _entry, options)
       when reason in [:authentication, :token_expired, :session_expired] do
    Keyword.get(options, :auth_backoff_ms, @default_auth_backoff_ms)
  end

  defp backoff({:error, _reason}, entry, options) do
    base = Keyword.get(options, :base_backoff_ms, @default_base_backoff_ms)
    failures = Map.get(entry, :failure_count, 0)
    min(round(base * :math.pow(2, failures)), @max_backoff_ms)
  end

  defp backoff(_result, _entry, options),
    do: Keyword.get(options, :base_backoff_ms, @default_base_backoff_ms)

  defp public_result({:ok, _snapshot}), do: :ok
  defp public_result({:error, {:rate_limited, _retry_after_ms}}), do: {:error, :rate_limited}
  defp public_result({:error, :token_expired}), do: {:error, :authentication}
  defp public_result({:error, :session_expired}), do: {:error, :authentication}
  defp public_result({:error, reason}) when is_atom(reason), do: {:error, reason}
  defp public_result({:error, _reason}), do: {:error, :provider_error}
  defp public_result(_other), do: {:error, :provider_error}
end
