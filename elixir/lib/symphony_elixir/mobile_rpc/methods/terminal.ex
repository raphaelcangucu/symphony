defmodule SymphonyElixir.MobileRpc.Methods.Terminal do
  @moduledoc "Interactive terminal stream and commands over encrypted mobile RPC."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.Subscribe,
      __MODULE__.Command,
      __MODULE__.List,
      __MODULE__.Send,
      __MODULE__.UpdateViewport,
      __MODULE__.Focus,
      __MODULE__.Rename,
      __MODULE__.Close,
      __MODULE__.ClearBuffer,
      __MODULE__.SetDisplayMode,
      __MODULE__.GetAutoRestoreFit,
      __MODULE__.SetAutoRestoreFit
    ]
  end

  defmodule Subscribe do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.{SessionBridge, TerminalBridge}

    @impl true
    def name, do: "terminal.subscribe"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 10_000

    @impl true
    def validate(%{"terminal" => terminal} = params)
        when is_binary(terminal) and terminal != "" do
      SymphonyElixir.MobileRpc.MobileMethod.validate_params(
        params,
        ["terminal", "client", "viewport", "capabilities"],
        ["terminal"]
      )
    end

    def validate(%{"thread_id" => thread_id, "project_slug" => project_slug} = params)
        when is_integer(thread_id) and thread_id > 0 and is_binary(project_slug) and
               project_slug != "" and map_size(params) == 2,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{"terminal" => _terminal} = params, context) do
      service =
        Map.get(
          context,
          :orca_session_service,
          SymphonyElixir.MobileRpc.MobileSessionService
        )

      service.subscribe("terminal.subscribe", params, context)
    end

    def call(%{"thread_id" => thread_id, "project_slug" => project_slug}, context) do
      subscription_id =
        "terminal:" <>
          Integer.to_string(thread_id) <>
          ":" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <-
             TerminalBridge.subscribe(
               connection_pid,
               thread_id,
               project_slug,
               subscription_id
             ) do
        cleanup = fn ->
          if Process.alive?(bridge), do: GenServer.stop(bridge, :normal)
        end

        {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, fn -> SessionBridge.activate(bridge) end}}
      else
        _reason -> {:error, :terminal_subscription_failed}
      end
    end
  end

  defmodule List do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.list",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["worktree", "limit", "requireFreshPtyLiveness"],
      required_keys: ["worktree"]
  end

  defmodule Send do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.send",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal", "text", "enter", "interrupt", "client", "requireAgentStatus"],
      required_keys: ["terminal"]
  end

  defmodule UpdateViewport do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.updateViewport",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal", "client", "viewport"],
      required_keys: ["terminal", "client", "viewport"]
  end

  defmodule Focus do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.focus",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal"],
      required_keys: ["terminal"]
  end

  defmodule Rename do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.rename",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal", "title"],
      required_keys: ["terminal"]
  end

  defmodule Close do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.close",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal"],
      required_keys: ["terminal"]
  end

  defmodule ClearBuffer do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.clearBuffer",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal"],
      required_keys: ["terminal"]
  end

  defmodule SetDisplayMode do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.setDisplayMode",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["terminal", "mode", "client", "viewport"],
      required_keys: ["terminal", "mode"]
  end

  defmodule GetAutoRestoreFit do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.getAutoRestoreFit",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service
  end

  defmodule SetAutoRestoreFit do
    use SymphonyElixir.MobileRpc.MobileMethod,
      name: "terminal.setAutoRestoreFit",
      service: SymphonyElixir.MobileRpc.MobileSessionService,
      service_key: :orca_session_service,
      allowed_keys: ["ms"],
      required_keys: ["ms"],
      nullable_required_keys: ["ms"]
  end

  defmodule Command do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.{SessionBridge, TerminalBridge}

    @events ~w(input resize)

    @impl true
    def name, do: "terminal.command"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 10_000

    @impl true
    def validate(%{"thread_id" => thread_id, "event" => event, "payload" => payload} = params)
        when is_integer(thread_id) and thread_id > 0 and event in @events and
               is_map(payload) and map_size(params) == 3,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{"thread_id" => thread_id, "event" => event, "payload" => payload}, context) do
      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <- TerminalBridge.lookup(connection_pid, thread_id),
           result <- SessionBridge.command(bridge, event, payload) do
        case result do
          :ok -> {:ok, %{"accepted" => true}}
          {:ok, response} -> {:ok, %{"accepted" => true, "response" => response}}
          {:error, reason} -> {:error, reason}
        end
      else
        _reason -> {:error, :terminal_command_failed}
      end
    end
  end
end
