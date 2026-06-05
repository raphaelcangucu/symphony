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
  daemon runs. Tests and the standalone escript call `register_session/2` directly;
  if no supervised instance is running yet, `ensure_started/0` starts one on demand
  and stores the pid in `:persistent_term` (tolerates `:already_started`).

  ### Token binding

  `register_session/2` stores `{token, specs, executor}` in an ETS table (public,
  named `__MODULE__`). The token IS the session key — embedded in the URL path
  `/mcp/:token`. Anyone who can reach 127.0.0.1 with a valid token can invoke
  tools, which is intentional: only Claude CLI processes running on the same host
  will know the token.

  ### NO tracker/Phoenix imports

  Per component rule: only Plug, Bandit, Jason, and Elixir stdlib.
  """

  use Plug.Router

  require Logger

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

      [{^token, specs, executor}] ->
        handle_rpc(conn, specs, executor)
    end
  end

  match _ do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{"error" => "not found"}))
  end

  # ── Public API ───────────────────────────────────────────────────────────────

  @doc """
  Start the Bandit loopback listener. Used as a supervised child spec and also
  called lazily from `register_session/2` when running outside the supervision
  tree (tests, escript).
  """
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(_opts \\ []) do
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
  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :supervisor,
      restart: :permanent
    }
  end

  @doc """
  Register a session: stores `{specs, executor}` in ETS under a fresh random
  token and returns `{:ok, token, url}`. The URL encodes the token as the last
  path segment — giving the caller and the CLI a single opaque credential.

  Starts the Bandit listener lazily if not already running.
  """
  @spec register_session([map()], function()) :: {:ok, String.t(), String.t()}
  def register_session(specs, executor) when is_list(specs) and is_function(executor, 2) do
    ensure_table()
    ensure_started()

    {_pid, port} = :persistent_term.get(@pt_key)
    token = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
    :ets.insert(@table, {token, specs, executor})
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

  defp ensure_table do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, {:read_concurrency, true}])
    end

    :ok
  end

  defp ensure_started do
    case :persistent_term.get(@pt_key, nil) do
      nil ->
        # Not started yet — start lazily
        start_link([])

      {pid, _port} ->
        # Verify the stored pid is still alive; restart if it died
        if Process.alive?(pid) do
          :ok
        else
          :persistent_term.erase(@pt_key)
          start_link([])
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
        items
        |> Enum.map(fn
          %{"text" => t} -> t
          _ -> ""
        end)
        |> Enum.join("\n")

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
