defmodule SymphonyElixir.MobileRpc.Methods.Orchestrator do
  @moduledoc "Allowlisted orchestrator execution streams and steering over mobile RPC."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.ExecutionsList,
      __MODULE__.ExecutionsSubscribe,
      __MODULE__.SessionContext,
      __MODULE__.SessionSubscribe,
      __MODULE__.SessionCommand
    ]
  end

  defmodule SessionContext do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "orchestrator.session.context"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 5_000

    @impl true
    def validate(%{"execution_session_id" => id} = params)
        when is_integer(id) and id > 0 and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{"execution_session_id" => id}, context) do
      case service(context).session_context(id) do
        {:ok, session_context} -> {:ok, session_context}
        {:error, :not_found} -> {:error, :orchestrator_session_not_found}
      end
    end

    defp service(context) do
      Map.get(
        context,
        :orchestrator_mobile_service,
        SymphonyElixir.MobileRpc.OrchestratorService
      )
    end
  end

  defmodule ExecutionsList do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "orchestrator.executions.list"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 10_000

    @impl true
    def validate(params) when is_map(params) and map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{}, context) do
      service = service(context)
      {:ok, %{"executions" => service.list_executions()}}
    end

    defp service(context) do
      Map.get(
        context,
        :orchestrator_mobile_service,
        SymphonyElixir.MobileRpc.OrchestratorService
      )
    end
  end

  defmodule ExecutionsSubscribe do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "orchestrator.executions.subscribe"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 5_000

    @impl true
    def validate(params) when is_map(params) and map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{}, context) do
      subscription_id = unique_id("orchestrator:executions")
      bridge_module = bridge(context)
      channel_module = Map.get(context, :agent_execution_channel, SymphonyElixirWeb.AgentExecutionChannel)

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge_pid} <-
             bridge_module.subscribe_channel(
               connection_pid,
               {:orchestrator_executions, :all},
               subscription_id,
               channel_module: channel_module,
               topic: "agent_executions",
               event_prefix: "orchestrator.executions",
               event_mapper: execution_event_mapper(service(context))
             ) do
        {:ok, subscription(bridge_module, bridge_pid, subscription_id)}
      else
        _reason -> {:error, :orchestrator_subscription_failed}
      end
    end

    defp bridge(context),
      do: Map.get(context, :session_bridge, SymphonyElixir.MobileRpc.SessionBridge)

    defp service(context) do
      Map.get(
        context,
        :orchestrator_mobile_service,
        SymphonyElixir.MobileRpc.OrchestratorService
      )
    end

    defp execution_event_mapper(service) do
      fn
        "snapshot", _payload, state -> {"snapshot", %{"data" => service.list_executions()}, state}
        event, payload, state -> {event, payload, state}
      end
    end

    defp subscription(bridge_module, bridge_pid, subscription_id) do
      cleanup = fn ->
        if Process.alive?(bridge_pid), do: GenServer.stop(bridge_pid, :normal)
      end

      activate = fn -> bridge_module.activate(bridge_pid) end

      {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}
    end

    defp unique_id(prefix) do
      prefix <> ":" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))
    end
  end

  defmodule SessionSubscribe do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "orchestrator.session.subscribe"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 5_000

    @impl true
    def validate(%{"execution_session_id" => id} = params)
        when is_integer(id) and id > 0 and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{"execution_session_id" => id}, context) do
      subscription_id =
        "orchestrator:session:#{id}:" <>
          Integer.to_string(System.unique_integer([:positive, :monotonic]))

      bridge_module = bridge(context)
      service = service(context)
      channel_module = Map.get(context, :session_log_channel, SymphonyElixirWeb.SessionLogChannel)

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, %{project_slug: project_slug}} <- service.session_context(id),
           {:ok, bridge_pid} <-
             bridge_module.subscribe_channel(
               connection_pid,
               {:orchestrator_session, id},
               subscription_id,
               thread_id: id,
               channel_module: channel_module,
               topic: "session_log:#{id}",
               join_payload: %{"project_slug" => project_slug},
               emit_joined: true,
               event_prefix: "orchestrator.session"
             ) do
        cleanup = fn ->
          if Process.alive?(bridge_pid), do: GenServer.stop(bridge_pid, :normal)
        end

        activate = fn -> bridge_module.activate(bridge_pid) end

        {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}}
      else
        {:error, :not_found} -> {:error, :orchestrator_session_not_found}
        _reason -> {:error, :orchestrator_session_subscription_failed}
      end
    end

    defp bridge(context),
      do: Map.get(context, :session_bridge, SymphonyElixir.MobileRpc.SessionBridge)

    defp service(context) do
      Map.get(
        context,
        :orchestrator_mobile_service,
        SymphonyElixir.MobileRpc.OrchestratorService
      )
    end
  end

  defmodule SessionCommand do
    @behaviour SymphonyElixir.MobileRpc.Method

    @impl true
    def name, do: "orchestrator.session.command"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000

    @impl true
    def validate(
          %{
            "execution_session_id" => id,
            "event" => "steer",
            "payload" => payload
          } = params
        )
        when is_integer(id) and id > 0 and is_map(payload) and map_size(params) == 3,
        do: validate_payload(params, payload)

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(
          %{"execution_session_id" => id, "event" => "steer", "payload" => payload},
          context
        ) do
      bridge_module =
        Map.get(context, :session_bridge, SymphonyElixir.MobileRpc.SessionBridge)

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge_pid} <-
             bridge_module.lookup_channel(connection_pid, {:orchestrator_session, id}),
           :ok <- bridge_module.command(bridge_pid, "steer_turn", payload) do
        {:ok, %{"accepted" => true}}
      else
        {:error, reason} -> {:error, reason}
        _reason -> {:error, :orchestrator_session_command_failed}
      end
    end

    defp validate_payload(params, payload) do
      message = Map.get(payload, "message")
      attachments = Map.get(payload, "attachments", [])

      if (is_binary(message) and String.trim(message) != "") or
           (is_list(attachments) and attachments != []) do
        {:ok, params}
      else
        {:error, :invalid_params}
      end
    end
  end
end
