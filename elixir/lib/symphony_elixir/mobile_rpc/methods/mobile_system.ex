defmodule SymphonyElixir.MobileRpc.Methods.MobileSystem do
  @moduledoc "Orca-compatible system methods backed by the selected Symphony host."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.StatusGet,
      __MODULE__.SettingsGet,
      __MODULE__.SettingsUpdate,
      __MODULE__.PreflightCheck,
      __MODULE__.PreflightDetectAgents,
      __MODULE__.PreflightDetectRemoteAgents,
      __MODULE__.StatsSummary,
      __MODULE__.AccountsList,
      __MODULE__.AccountsSubscribe
    ]
  end

  defmodule StatusGet do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "status.get"
  end

  defmodule SettingsGet do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "settings.get"
  end

  defmodule SettingsUpdate do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "settings.update",
      allowed_keys: [
        "defaultTaskSource",
        "defaultRepoSelection",
        "defaultTaskViewPreset",
        "defaultLinearTeamSelection",
        "githubProjects",
        "visibleTaskProviders",
        "disabledTuiAgents",
        "agentCmdOverrides"
      ]
  end

  defmodule PreflightCheck do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "preflight.check"
  end

  defmodule PreflightDetectAgents do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "preflight.detectAgents"
  end

  defmodule PreflightDetectRemoteAgents do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "preflight.detectRemoteAgents",
      allowed_keys: ["connectionId"],
      required_keys: ["connectionId"]
  end

  defmodule StatsSummary do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "stats.summary"
  end

  defmodule AccountsList do
    use SymphonyElixir.MobileRpc.MobileMethod, name: "accounts.list"
  end

  defmodule AccountsSubscribe do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "accounts.subscribe"

    @impl true
    def scope, do: :mobile

    @impl true
    def timeout_ms, do: 1_000

    @impl true
    def validate(params) do
      SymphonyElixir.MobileRpc.MobileMethod.validate_params(params, [], [])
    end

    @impl true
    def call(_params, context) do
      subscription_id = "accounts-#{System.unique_integer([:positive])}"
      snapshot = SymphonyElixir.MobileRpc.MobilePresenter.accounts_snapshot(context)
      connection_pid = Map.get(context, :connection_pid)

      activate = fn ->
        if is_pid(connection_pid) do
          send(
            connection_pid,
            {:mobile_rpc_event, subscription_id, "accounts.updated", snapshot}
          )
        end
      end

      {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, fn -> :ok end, activate}}
    end
  end
end
