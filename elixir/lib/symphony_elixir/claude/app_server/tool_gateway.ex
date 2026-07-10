defmodule SymphonyElixir.Claude.AppServer.ToolGateway.TableOwner do
  @moduledoc """
  Tiny GenServer that owns the public ETS table for the ToolGateway.
  Because ETS tables are destroyed when their owner process exits, we need a
  long-lived owner that is NOT the per-request caller.  This GenServer lives
  as long as the supervision tree (or until explicitly stopped in the lazy
  path) and also runs a periodic TTL sweep to remove stale session rows.
  """

  use GenServer

  require Logger

  @table SymphonyElixir.Claude.AppServer.ToolGateway
  @sweep_interval_ms 600_000
  @max_session_age_ms 4 * 60 * 60 * 1_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl GenServer
  def init(_opts) do
    :ets.new(@table, [:named_table, :public, :set, {:read_concurrency, true}])
    schedule_sweep()
    {:ok, %{}}
  end

  @impl GenServer
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)
    cutoff = now - @max_session_age_ms

    expired =
      :ets.select(@table, [
        {
          {:"$1", :_, :_, :"$2"},
          [{:<, :"$2", cutoff}],
          [:"$1"]
        }
      ])

    Enum.each(expired, fn token ->
      :ets.delete(@table, token)
      Logger.debug("[ToolGateway] TTL sweep removed stale session #{String.slice(token, 0, 8)}…")
    end)

    schedule_sweep()
    {:noreply, state}
  end

  defp schedule_sweep do
    Process.send_after(self(), :sweep, @sweep_interval_ms)
  end
end

defmodule SymphonyElixir.Claude.AppServer.ToolGateway do
  @moduledoc """
  Loopback MCP server (JSON-RPC over HTTP POST) exposing per-session dynamic
  tools to the Claude Code CLI. `register_session/2` mints a URL-embedded token
  bound to {tool specs, executor closure}; the CLI calls back with it.

  ## Architecture

  Component-owned HTTP listener (Bandit on 127.0.0.1, port 0 / ephemeral), NOT
  Phoenix. The gateway works even if the web subtree is down.

  ### Port discovery

  Bandit's `start_link/1` delegates to `ThousandIsland.start_link/1` and returns
  `{:ok, supervisor_pid}`. `ThousandIsland.listener_info/1` accepts that pid and
  returns `{:ok, {address, port}}` — the bound port of the ephemeral socket.

  The resolved `{supervisor_pid, port}` is stored in `:persistent_term` under the
  key `{__MODULE__, :server}` so `register_session/2` can build the correct URL
  without a GenServer round-trip.

  ### Supervision + lazy start

  The gateway is started as a supervised child of `SharedSupervisor` for normal
  daemon runs.  `child_spec/1` returns a Supervisor spec whose `start_link/1`
  starts a one-for-one `Supervisor` with two children: `TableOwner` (holds the
  ETS table) and the Bandit listener.

  Tests and the standalone escript call `register_session/2` directly;
  if no supervised instance is running yet, `ensure_started/0` starts both
  children on demand.

  ### Token binding

  `register_session/2` stores `{token, specs, executor, inserted_at_ms}` in an
  ETS table (public, named `__MODULE__`). The token IS the session key — embedded
  in the URL path `/mcp/:token`. Anyone who can reach 127.0.0.1 with a valid
  token can invoke tools, which is intentional: only Claude CLI processes running
  on the same host will know the token.

  A background sweep in `TableOwner` removes rows older than 4 hours.

  ### NO tracker/Phoenix imports

  Per component rule: only Plug, Bandit, Jason, and Elixir stdlib. The
  `/user-input/:session_token` façade is an intentional exception: it
  delegates to `SymphonyElixir.Assistant.UserInputHttp` so PreToolUse hooks
  share this loopback listener without putting Assistant logic here.
  """

  use Plug.Router

  require Logger

  alias SymphonyElixir.Assistant.UserInputHttp

  @table __MODULE__
  @pt_key {__MODULE__, :server}
  @protocol_version "2025-06-18"

  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason, length: 1_000_000)
  plug(:match)
  plug(:dispatch)

  # ── HTTP routes ─────────────────────────────────────────────────────────────

  post "/mcp/:token" do
    case :ets.lookup(@table, token) do
      [] ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(401, Jason.encode!(%{"error" => "unknown token"}))

      [{^token, specs, executor, _inserted_at}] ->
        handle_rpc(conn, specs, executor)
    end
  end

  post "/user-input/:session_token" do
    UserInputHttp.handle_conn(conn, session_token)
  end

  match _ do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{"error" => "not found"}))
  end

  # ── Public API ───────────────────────────────────────────────────────────────

  @doc """
  Start the supervised subtree: `TableOwner` (ETS owner) + Bandit listener.
  Used as the entry point of `child_spec/1` and also called lazily from
  `ensure_started/0` when running outside the supervision tree.
  """
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts \\ []) do
    bandit_child = %{
      id: :bandit,
      start: {__MODULE__, :start_bandit, [opts]},
      type: :supervisor,
      restart: :permanent
    }

    children = [
      SymphonyElixir.Claude.AppServer.ToolGateway.TableOwner,
      bandit_child
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end

  @doc false
  @spec start_bandit(keyword()) :: Supervisor.on_start()
  def start_bandit(_opts) do
    case Bandit.start_link(plug: __MODULE__, ip: {127, 0, 0, 1}, port: 0, startup_log: false) do
      {:ok, pid} = ok ->
        {:ok, {_addr, port}} = ThousandIsland.listener_info(pid)
        :persistent_term.put(@pt_key, {pid, port})
        ok

      {:error, {:already_started, pid}} ->
        {:ok, {_addr, port}} = ThousandIsland.listener_info(pid)
        :persistent_term.put(@pt_key, {pid, port})
        {:ok, pid}

      error ->
        error
    end
  end

  @doc false
  @spec child_spec(keyword()) :: Supervisor.child_spec()
  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :supervisor,
      restart: :permanent
    }
  end

  @doc """
  Register a session: stores `{specs, executor, inserted_at_ms}` in ETS under
  a fresh random token and returns `{:ok, token, url}`. The URL encodes the
  token as the last path segment — giving the caller and the CLI a single
  opaque credential.

  Starts the TableOwner and Bandit listener lazily if not already running.
  """
  @spec register_session([map()], function()) :: {:ok, String.t(), String.t()}
  def register_session(specs, executor) when is_list(specs) and is_function(executor, 2) do
    ensure_started()

    {_pid, port} = :persistent_term.get(@pt_key)
    token = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
    now_ms = System.monotonic_time(:millisecond)
    :ets.insert(@table, {token, specs, executor, now_ms})
    {:ok, token, "http://127.0.0.1:#{port}/mcp/#{token}"}
  end

  @doc """
  Unregister a session token. Idempotent.
  """
  @spec unregister_session(String.t()) :: :ok
  def unregister_session(token) when is_binary(token) do
    if :ets.whereis(@table) != :undefined do
      :ets.delete(@table, token)
    end

    :ok
  end

  @doc """
  Write an MCP config file pointing at the given session URL into
  `workspace/.symphony/`. Returns the path of the written file.

  The file name includes a unique integer so multiple sessions can coexist in
  the same workspace directory.
  """
  @spec write_mcp_config!(Path.t(), String.t()) :: Path.t()
  def write_mcp_config!(workspace, url) when is_binary(workspace) and is_binary(url) do
    dir = Path.join(workspace, ".symphony")
    File.mkdir_p!(dir)
    path = Path.join(dir, "claude-mcp-#{System.unique_integer([:positive])}.json")

    config = %{
      "mcpServers" => %{
        "symphony" => %{
          "type" => "http",
          "url" => url
        }
      }
    }

    File.write!(path, Jason.encode!(config))
    path
  end

  # ── Private helpers ──────────────────────────────────────────────────────────

  defp ensure_started do
    owner_running? = Process.whereis(SymphonyElixir.Claude.AppServer.ToolGateway.TableOwner) != nil
    table_exists? = :ets.whereis(@table) != :undefined

    if not owner_running? or not table_exists? do
      # Start TableOwner unlinked so a test process exit won't kill it
      case GenServer.start(SymphonyElixir.Claude.AppServer.ToolGateway.TableOwner, []) do
        {:ok, _pid} -> :ok
        {:error, {:already_started, _pid}} -> :ok
        _ -> :ok
      end
    end

    case :persistent_term.get(@pt_key, nil) do
      nil ->
        start_bandit([])

      {pid, _port} ->
        if Process.alive?(pid) do
          :ok
        else
          :persistent_term.erase(@pt_key)
          start_bandit([])
        end
    end
  end

  # ── RPC dispatch ─────────────────────────────────────────────────────────────

  defp handle_rpc(conn, specs, executor) do
    body = conn.body_params

    case Map.get(body, "id") do
      nil ->
        # Notification — acknowledge with 202, no body
        send_resp(conn, 202, "")

      id ->
        method = Map.get(body, "method", "")
        result = rpc_result(method, body, specs, executor)

        response = %{
          "jsonrpc" => "2.0",
          "id" => id,
          "result" => result
        }

        conn
        |> put_resp_content_type("application/json")
        |> send_resp(200, Jason.encode!(response))
    end
  end

  defp rpc_result("initialize", _body, _specs, _executor) do
    vsn = Application.spec(:symphony_elixir, :vsn) |> to_string()

    %{
      "protocolVersion" => @protocol_version,
      "capabilities" => %{"tools" => %{}},
      "serverInfo" => %{"name" => "symphony", "version" => vsn}
    }
  end

  defp rpc_result("ping", _body, _specs, _executor) do
    %{}
  end

  defp rpc_result("tools/list", _body, specs, _executor) do
    tools =
      Enum.map(specs, fn spec ->
        %{
          "name" => Map.get(spec, "name"),
          "description" => Map.get(spec, "description", ""),
          "inputSchema" => Map.get(spec, "inputSchema", %{"type" => "object"})
        }
      end)

    %{"tools" => tools}
  end

  defp rpc_result("tools/call", body, _specs, executor) do
    params = Map.get(body, "params", %{})
    name = Map.get(params, "name", "")
    arguments = Map.get(params, "arguments", %{}) || %{}

    try do
      result = executor.(name, arguments)
      success = Map.get(result, "success", false) == true
      items = Map.get(result, "contentItems", [])

      text =
        Enum.map_join(items, "\n", fn
          %{"text" => t} -> t
          _ -> ""
        end)

      %{
        "content" => [%{"type" => "text", "text" => text}],
        "isError" => not success
      }
    rescue
      e ->
        %{
          "content" => [%{"type" => "text", "text" => Exception.message(e)}],
          "isError" => true
        }
    end
  end

  defp rpc_result(_unknown, _body, _specs, _executor) do
    %{}
  end
end
