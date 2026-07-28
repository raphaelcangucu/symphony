defmodule SymphonyElixir.AgentFailover do
  @moduledoc """
  Selects an eligible account once, at session admission.

  Failover is opt-in. Stale usage alone never excludes an account; only fresh
  exhaustion or a current rate-limit/auth/runtime failure does.
  """

  alias SymphonyElixir.AgentAccounts
  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.Settings.AgentCli

  @spec resolve(String.t(), String.t() | nil, String.t() | nil, keyword()) ::
          {:ok, map(), map()} | {:error, term()}
  def resolve(agent, project_override, request_override, options \\ []) do
    preferred = AgentAccounts.resolve(agent, project_override, request_override)

    if enabled?(agent, options) do
      resolve_enabled(agent, preferred, project_override, request_override, options)
    else
      case preferred do
        {:ok, account} ->
          {:ok, account, %{failed_over: false, preferred_account_id: account.id, reasons: []}}

        {:error, _reason} = error ->
          error
      end
    end
  end

  defp resolve_enabled(agent, preferred, project_override, request_override, options) do
    with {:ok, accounts} <- AgentAccounts.list(agent) do
      preferred_id = preferred_id(preferred, project_override, request_override)
      candidates = order_candidates(accounts, preferred_id)

      {selected, reasons} =
        Enum.reduce_while(candidates, {nil, []}, fn account, {_selected, reasons} ->
          case eligibility(agent, account, options) do
            :eligible -> {:halt, {account, reasons}}
            {:ineligible, reason} -> {:cont, {nil, reasons ++ [%{account_id: account.id, reason: reason}]}}
          end
        end)

      case selected do
        nil ->
          {:error, {:all_accounts_ineligible, reasons}}

        account ->
          {:ok, account,
           %{
             failed_over: not is_nil(preferred_id) and account.id != preferred_id,
             preferred_account_id: preferred_id || account.id,
             reasons: reasons
           }}
      end
    end
  end

  defp eligibility(agent, account, options) do
    runtime_ineligible = Keyword.get(options, :runtime_ineligible, %{})
    now_ms = Keyword.get(options, :now_ms, System.monotonic_time(:millisecond))
    now_seconds = Keyword.get(options, :now_seconds, System.system_time(:second))

    cond do
      account.authentication_status != "authenticated" ->
        {:ineligible, :authentication}

      reason = Map.get(runtime_ineligible, account.id) ->
        {:ineligible, sanitize_runtime_reason(reason)}

      true ->
        usage_eligibility(AgentUsage.entry(agent, account.id, now_ms), now_ms, now_seconds)
    end
  end

  defp usage_eligibility(entry, now_ms, now_seconds) do
    cond do
      entry.stale_reason == :authentication ->
        {:ineligible, :authentication}

      entry.stale_reason == :rate_limited and
        is_integer(entry.next_refresh_at) and now_ms < entry.next_refresh_at ->
        {:ineligible, :rate_limited}

      entry.state == :fresh and exhausted?(entry.snapshot, now_seconds) ->
        {:ineligible, :usage_exhausted}

      true ->
        :eligible
    end
  end

  defp exhausted?(nil, _now_seconds), do: false

  defp exhausted?(snapshot, now_seconds) do
    Enum.any?(snapshot.windows ++ snapshot.model_limits, fn window ->
      window.used_percent >= 100 and
        (is_nil(window.resets_at) or window.resets_at > now_seconds)
    end)
  end

  defp preferred_id({:ok, account}, _project, _request), do: account.id
  defp preferred_id(_error, _project, request) when is_binary(request), do: request
  defp preferred_id(_error, project, _request) when is_binary(project), do: project
  defp preferred_id(_error, _project, _request), do: nil

  defp order_candidates(accounts, nil), do: accounts

  defp order_candidates(accounts, preferred_id) do
    case Enum.split_with(accounts, &(&1.id == preferred_id)) do
      {[], rest} -> rest
      {[preferred], rest} -> [preferred | rest]
    end
  end

  defp enabled?(agent, options) do
    case Keyword.fetch(options, :enabled) do
      {:ok, value} -> value == true
      :error -> match?(%{"failover_enabled" => true}, AgentCli.for(agent))
    end
  end

  defp sanitize_runtime_reason(reason)
       when reason in [:runtime_unavailable, :not_executable, :launch_failed],
       do: reason

  defp sanitize_runtime_reason(_reason), do: :runtime_unavailable
end
