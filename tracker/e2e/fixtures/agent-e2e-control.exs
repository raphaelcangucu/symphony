defmodule SymphonyElixir.AgentLifecycle.E2EControl do
  @moduledoc false

  use Plug.Router

  alias SymphonyElixir.AgentLaunch
  alias SymphonyElixir.AgentLifecycle.RuntimeRegistry
  alias SymphonyElixir.AgentUsage
  alias SymphonyElixir.AgentUsage.Window
  alias SymphonyElixir.CodingAgent

  @table __MODULE__

  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason)
  plug(:authorize)
  plug(:match)
  plug(:dispatch)

  get "/health" do
    json(conn, 200, %{ok: true})
  end

  post "/launch/resolve" do
    with {:ok, launch} <- resolve_launch(conn.body_params) do
      json(conn, 200, %{data: present_launch(launch)})
    else
      {:error, reason} -> json(conn, 422, %{error: present_error(reason)})
    end
  end

  post "/launch/acquire" do
    agent = conn.body_params["agent"]

    with {:ok, launch} <- resolve_launch(conn.body_params),
         {:ok, lease, pinned_resolution} <-
           RuntimeRegistry.acquire(agent, launch.resolution) do
      pinned_launch = AgentLaunch.with_resolution(launch, pinned_resolution)
      session = %{runtime_lease: lease, agent_launch: pinned_launch}
      :ets.insert(@table, {{:session, agent}, session})
      json(conn, 200, %{data: present_launch(pinned_launch)})
    else
      {:error, reason} -> json(conn, 422, %{error: present_error(reason)})
    end
  end

  post "/launch/status" do
    agent = conn.body_params["agent"]

    case :ets.lookup(@table, {:session, agent}) do
      [{{:session, ^agent}, %{agent_launch: launch}}] ->
        json(conn, 200, %{data: present_launch(launch)})

      [] ->
        json(conn, 404, %{error: "session_not_found"})
    end
  end

  post "/launch/release" do
    agent = conn.body_params["agent"]

    case :ets.take(@table, {:session, agent}) do
      [{{:session, ^agent}, session}] ->
        :ok = CodingAgent.stop_session(session, agent)
        json(conn, 200, %{data: %{released: true}})

      [] ->
        json(conn, 404, %{error: "session_not_found"})
    end
  end

  post "/usage/begin" do
    params = conn.body_params

    result =
      AgentUsage.begin_refresh(params["agent"], params["account_id"],
        now_ms: params["now_ms"],
        force: params["force"] == true
      )

    case result do
      {:ok, generation} -> json(conn, 200, %{data: %{generation: generation}})
      {:error, reason} -> json(conn, 422, %{error: Atom.to_string(reason)})
    end
  end

  post "/usage/complete" do
    params = conn.body_params
    result = refresh_result(params)

    completion =
      AgentUsage.complete_refresh(
        params["agent"],
        params["account_id"],
        params["generation"],
        result,
        now_ms: params["now_ms"],
        backoff_ms: params["backoff_ms"] || 0
      )

    json(conn, 200, %{data: %{result: completion}})
  end

  match _ do
    json(conn, 404, %{error: "not_found"})
  end

  @spec start_link(non_neg_integer()) :: Supervisor.on_start()
  def start_link(port) when is_integer(port) and port > 0 do
    ensure_table()
    Bandit.start_link(plug: __MODULE__, ip: {127, 0, 0, 1}, port: port, startup_log: false)
  end

  defp authorize(conn, _options) do
    expected = System.fetch_env!("SYMPHONY_TRACKER_TOKEN")

    case {conn.request_path, get_req_header(conn, "x-e2e-token")} do
      {"/health", _headers} -> conn
      {_path, [^expected]} -> conn
      {_path, _headers} -> conn |> json(401, %{error: "unauthorized"}) |> halt()
    end
  end

  defp resolve_launch(params) do
    AgentLaunch.resolve(
      params["agent"],
      params["project_account_id"],
      params["request_account_id"]
    )
  end

  defp present_launch(launch) do
    %{
      agent: launch.agent_kind,
      account_id: launch.account_id,
      account_home: launch.account_home,
      environment: launch.environment,
      observed_account_home: observed_account_home(launch),
      preferred_source: launch.preferred_source,
      effective_source: launch.effective_source,
      executable_path: launch.executable_path,
      executable_version: launch.executable_version,
      fallback_reason: launch.fallback_reason,
      failover: launch.failover
    }
  end

  defp observed_account_home(launch) do
    case System.cmd(
           launch.executable_path,
           ["account-home"],
           env: Map.to_list(launch.environment),
           stderr_to_stdout: true
         ) do
      {output, 0} -> String.trim(output)
      {_output, _status} -> nil
    end
  end

  defp refresh_result(%{"result" => "success"} = params) do
    {:ok, Window.normalize(params["agent"], params["usage"], params["now_seconds"] || 0)}
  end

  defp refresh_result(%{"result" => "error", "reason" => reason}) do
    {:error, error_reason(reason)}
  end

  defp error_reason("rate_limited"), do: {:rate_limited, 30_000}
  defp error_reason("authentication"), do: :authentication
  defp error_reason("timeout"), do: :timeout
  defp error_reason(_reason), do: :provider_failure

  defp present_error({:all_accounts_ineligible, reasons}) do
    %{code: "all_accounts_ineligible", reasons: reasons}
  end

  defp present_error(reason), do: %{code: "launch_failed", reason: inspect(reason)}

  defp json(conn, status, payload) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(payload))
  end

  defp ensure_table do
    case :ets.whereis(@table) do
      :undefined -> :ets.new(@table, [:named_table, :public, :set])
      table -> table
    end
  end
end
