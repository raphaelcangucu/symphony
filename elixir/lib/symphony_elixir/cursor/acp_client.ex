defmodule SymphonyElixir.Cursor.AcpClient do
  @moduledoc """
  Minimal JSON-RPC 2.0 NDJSON client for Cursor `agent acp` over stdio.

  Supports request/response correlation, server-initiated requests (via
  `on_server_request`), and notifications. Tests inject lines with
  `inject_line/2` and capture outbound frames via an optional `:writer`.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Agent.CliRunner.Base

  @port_line_bytes 1_048_576

  @type on_server_request :: (String.t(), term(), map() -> :ok)

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @spec request(pid(), String.t(), map(), timeout()) :: {:ok, map()} | {:error, term()}
  def request(pid, method, params, timeout \\ 30_000)
      when is_pid(pid) and is_binary(method) and is_map(params) do
    GenServer.call(pid, {:request, method, params}, timeout)
  end

  @spec notify(pid(), String.t(), map()) :: :ok
  def notify(pid, method, params) when is_pid(pid) and is_binary(method) and is_map(params) do
    GenServer.cast(pid, {:notify, method, params})
  end

  @spec respond(pid(), term(), map()) :: :ok
  def respond(pid, id, result) when is_pid(pid) and is_map(result) do
    GenServer.cast(pid, {:respond, id, result})
  end

  @doc "Test/helper: feed one NDJSON line as if read from the ACP server stdout."
  @spec inject_line(pid(), String.t()) :: :ok
  def inject_line(pid, line) when is_pid(pid) and is_binary(line) do
    send(pid, {:inbound_line, line})
    :ok
  end

  @doc false
  @spec command_args(String.t() | nil) :: [String.t()]
  def command_args(model) when is_binary(model) do
    case String.trim(model) do
      "" -> ["acp"]
      value -> ["--model", value, "acp"]
    end
  end

  def command_args(_model), do: ["acp"]

  @impl true
  def init(opts) do
    on_server_request = Keyword.get(opts, :on_server_request, fn _m, _id, _p -> :ok end)
    writer = Keyword.get(opts, :writer)

    unless is_function(on_server_request, 3) do
      raise ArgumentError, "on_server_request must be an arity-3 function"
    end

    {port, writer} =
      case writer do
        fun when is_function(fun, 1) ->
          {nil, fun}

        nil ->
          port = open_acp_port!(opts)
          {port, nil}

        _ ->
          raise ArgumentError, "writer must be an arity-1 function when provided"
      end

    {:ok,
     %{
       next_id: 1,
       pending: %{},
       on_server_request: on_server_request,
       writer: writer,
       port: port,
       pending_line: ""
     }}
  end

  @impl true
  def terminate(_reason, %{port: port}) when is_port(port) do
    Base.kill_port(port)
  rescue
    _ -> :ok
  end

  def terminate(_reason, _state), do: :ok

  @impl true
  def handle_call({:request, method, params}, from, state) do
    id = state.next_id
    frame = %{"jsonrpc" => "2.0", "id" => id, "method" => method, "params" => params}
    :ok = write_frame(state, frame)
    {:noreply, %{state | next_id: id + 1, pending: Map.put(state.pending, id, from)}}
  end

  @impl true
  def handle_cast({:notify, method, params}, state) do
    frame = %{"jsonrpc" => "2.0", "method" => method, "params" => params}
    :ok = write_frame(state, frame)
    {:noreply, state}
  end

  def handle_cast({:respond, id, result}, state) do
    frame = %{"jsonrpc" => "2.0", "id" => id, "result" => result}
    :ok = write_frame(state, frame)
    {:noreply, state}
  end

  @impl true
  def handle_info({:inbound_line, line}, state) when is_binary(line) do
    {:noreply, handle_inbound(String.trim(line), state)}
  end

  def handle_info({port, {:data, {:eol, chunk}}}, %{port: port} = state) do
    line = state.pending_line <> to_string(chunk)
    {:noreply, %{handle_inbound(String.trim(line), state) | pending_line: ""}}
  end

  def handle_info({port, {:data, {:noeol, chunk}}}, %{port: port} = state) do
    {:noreply, %{state | pending_line: state.pending_line <> to_string(chunk)}}
  end

  def handle_info({port, {:exit_status, status}}, %{port: port} = state) do
    Logger.warning("Cursor ACP process exited with status #{status}")
    fail_all_pending(state, {:error, {:acp_exit, status}})
    {:noreply, %{state | port: nil, pending: %{}}}
  end

  def handle_info(_other, state), do: {:noreply, state}

  defp open_acp_port!(opts) do
    command = Keyword.fetch!(opts, :command)
    workspace = opts |> Keyword.fetch!(:workspace) |> Path.expand()

    executable =
      case System.find_executable(command) do
        nil ->
          if File.exists?(command), do: command, else: raise("Cursor ACP command not found: #{command}")

        path ->
          path
      end

    cursor_args =
      opts
      |> Keyword.get(:model)
      |> command_args()

    {port_executable, port_args} =
      case System.find_executable("setsid") do
        nil ->
          {executable, cursor_args}

        setsid ->
          {setsid, ["--wait", executable | cursor_args]}
      end

    Port.open(
      {:spawn_executable, String.to_charlist(port_executable)},
      [
        :binary,
        :exit_status,
        :use_stdio,
        args: Enum.map(port_args, &String.to_charlist/1),
        cd: String.to_charlist(workspace),
        line: @port_line_bytes
      ]
    )
  end

  defp handle_inbound("", state), do: state

  defp handle_inbound(line, state) do
    case Jason.decode(line) do
      {:ok, %{"id" => id, "result" => result} = msg} when not is_map_key(msg, "method") ->
        reply_pending(state, id, {:ok, result})

      {:ok, %{"id" => id, "error" => error} = msg} when not is_map_key(msg, "method") ->
        reply_pending(state, id, {:error, error})

      {:ok, %{"id" => id, "method" => method} = msg} ->
        params = Map.get(msg, "params", %{})
        state.on_server_request.(method, id, params)
        state

      {:ok, %{"method" => method} = msg} ->
        params = Map.get(msg, "params", %{})
        state.on_server_request.(method, nil, params)
        state

      _ ->
        state
    end
  end

  defp reply_pending(state, id, reply) do
    case Map.pop(state.pending, id) do
      {nil, pending} ->
        %{state | pending: pending}

      {from, pending} ->
        GenServer.reply(from, reply)
        %{state | pending: pending}
    end
  end

  defp fail_all_pending(state, reply) do
    Enum.each(state.pending, fn {_id, from} -> GenServer.reply(from, reply) end)
  end

  defp write_frame(%{writer: writer}, frame) when is_function(writer, 1) do
    writer.(Jason.encode!(frame) <> "\n")
    :ok
  end

  defp write_frame(%{port: port}, frame) when is_port(port) do
    true = Port.command(port, Jason.encode!(frame) <> "\n")
    :ok
  end

  defp write_frame(_state, _frame) do
    {:error, :no_transport}
  end
end
