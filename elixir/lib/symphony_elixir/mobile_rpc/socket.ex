defmodule SymphonyElixir.MobileRpc.Socket do
  @moduledoc "WebSock boundary for the encrypted mobile RPC handshake."

  @behaviour WebSock

  alias SymphonyElixir.MobileRpc.{AuthLimiter, Dispatcher, Handshake, HostIdentity}

  @registry SymphonyElixir.MobileRpc.ConnectionRegistry
  @handshake_timeout_ms 10_000

  @impl WebSock
  def init(opts) do
    host_name = Map.get(opts, :host_name, default_host_name())
    auth_key = Map.get(opts, :auth_key, :unknown)

    with true <- AuthLimiter.allowed?(auth_key),
         {:ok, identity} <- HostIdentity.get_or_create(host_name),
         {:ok, handshake} <- Handshake.new(identity) do
      timeout_ref = Process.send_after(self(), :handshake_timeout, @handshake_timeout_ms)
      {:ok, %{handshake | auth_key: auth_key, timeout_ref: timeout_ref}}
    else
      false -> {:stop, :rate_limited, %{}}
      {:error, reason} -> {:stop, reason, %{}}
    end
  end

  @impl WebSock
  def handle_in({raw, opcode: :text}, %{phase: :awaiting_hello} = state) do
    case Handshake.receive_text(raw, state) do
      {:push, response, next_state} ->
        {:push, {:text, response}, next_state}

      {:error, reason, next_state} ->
        AuthLimiter.record_failure(next_state.auth_key)
        close_with_hello_error(reason, next_state)
    end
  end

  def handle_in({_raw, opcode: :text}, %{phase: :awaiting_auth} = state) do
    {:stop, :plaintext_auth_forbidden, {1008, "authentication must be encrypted"}, state}
  end

  def handle_in({frame, opcode: :binary}, %{phase: :awaiting_auth} = state) do
    case Handshake.receive_binary(frame, state) do
      {:push, response, next_state} ->
        cancel_timeout(next_state.timeout_ref)
        AuthLimiter.reset(next_state.auth_key)
        register_device(next_state.device_id)

        dispatcher =
          Dispatcher.new(%{
            host_id: next_state.identity.host_id,
            host_name: next_state.identity.name,
            protocol: 1,
            device_id: next_state.device_id
          })

        {:push, {:binary, response}, %{next_state | dispatcher: dispatcher}}

      {:error, reason, encrypted_error, next_state} ->
        AuthLimiter.record_failure(next_state.auth_key)
        {:stop, reason, {1008, "mobile authentication failed"}, {:binary, encrypted_error}, next_state}

      {:error, reason, next_state} ->
        AuthLimiter.record_failure(next_state.auth_key)
        {:stop, reason, {1008, "invalid encrypted handshake"}, next_state}
    end
  end

  def handle_in({_frame, opcode: :text}, state) do
    {:stop, :plaintext_frame_forbidden, {1008, "RPC frames must be encrypted"}, state}
  end

  def handle_in({frame, opcode: :binary}, %{phase: :ready} = state) do
    with {:ok, plaintext, decrypted} <- Handshake.decrypt_rpc(frame, state) do
      case Dispatcher.handle_frame(plaintext, decrypted.dispatcher) do
        {:noreply, dispatcher} ->
          {:ok, %{decrypted | dispatcher: dispatcher}}

        {_kind, response, dispatcher} ->
          push_rpc_response(response, %{decrypted | dispatcher: dispatcher})
      end
    else
      {:error, reason, next_state} ->
        {:stop, reason, {1008, "invalid encrypted RPC frame"}, next_state}
    end
  end

  def handle_in({_frame, opcode: :binary}, state), do: {:ok, state}

  @impl WebSock
  def handle_info(:handshake_timeout, %{phase: phase} = state)
      when phase in [:awaiting_hello, :awaiting_auth] do
    AuthLimiter.record_failure(Map.get(state, :auth_key, :unknown))
    {:stop, :handshake_timeout, {1008, "mobile handshake timed out"}, state}
  end

  def handle_info(:device_revoked, state) do
    {:stop, :device_revoked, {4003, "mobile device revoked"}, state}
  end

  def handle_info(message, %{phase: :ready, dispatcher: dispatcher} = state)
      when not is_nil(dispatcher) do
    case Dispatcher.handle_info(message, dispatcher) do
      {:reply, response, next_dispatcher} ->
        push_rpc_response(response, %{state | dispatcher: next_dispatcher})

      {:noreply, next_dispatcher} ->
        {:ok, %{state | dispatcher: next_dispatcher}}
    end
  end

  def handle_info(_message, state), do: {:ok, state}

  @impl WebSock
  def terminate(_reason, %{dispatcher: %Dispatcher{} = dispatcher, timeout_ref: timeout_ref}) do
    cancel_timeout(timeout_ref)
    Dispatcher.close(dispatcher)
  end

  def terminate(_reason, %{timeout_ref: timeout_ref}) do
    cancel_timeout(timeout_ref)
    :ok
  end

  def terminate(_reason, _state), do: :ok

  @spec disconnect_device(String.t()) :: :ok
  def disconnect_device(device_id) when is_binary(device_id) do
    if Process.whereis(@registry) do
      @registry
      |> Registry.lookup(device_id)
      |> Enum.each(fn {pid, _value} -> send(pid, :device_revoked) end)
    end

    :ok
  end

  defp close_with_hello_error(reason, state) do
    payload = Jason.encode!(%{"type" => "hello_error", "code" => hello_error_code(reason)})
    {:stop, reason, {1002, "mobile handshake rejected"}, {:text, payload}, state}
  end

  defp hello_error_code(:protocol_incompatible), do: "protocol_incompatible"
  defp hello_error_code(:host_mismatch), do: "host_mismatch"
  defp hello_error_code(_reason), do: "invalid_hello"

  defp register_device(device_id) do
    if Process.whereis(@registry) do
      Registry.register(@registry, device_id, nil)
    end
  end

  defp cancel_timeout(nil), do: :ok

  defp cancel_timeout(timeout_ref) do
    Process.cancel_timer(timeout_ref)
    :ok
  end

  defp push_rpc_response(response, state) do
    case Handshake.encrypt_rpc(response, state) do
      {:ok, frame, next_state} -> {:push, {:binary, frame}, next_state}
      {:error, reason, next_state} -> {:stop, reason, next_state}
    end
  end

  defp default_host_name do
    case :inet.gethostname() do
      {:ok, hostname} -> to_string(hostname)
      _error -> "Symphony Host"
    end
  end
end
