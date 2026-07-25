defmodule SymphonyElixir.MobileRpc.Handshake do
  @moduledoc """
  Version-one application-encrypted mobile handshake.

  Only the key-agreement hello is accepted as text. Device authentication is
  decrypted and transcript-bound before a socket becomes ready for RPC.
  """

  alias SymphonyElixir.MobileRpc.{Crypto, Devices, HostIdentity}

  @protocol_version 1
  @key_bytes 32
  @tag_bytes 16

  defstruct phase: :awaiting_hello,
            identity: nil,
            private_key: nil,
            random_bytes: nil,
            authenticate: nil,
            session: nil,
            transcript_hash: nil,
            client_nonce: nil,
            server_nonce: nil,
            device_id: nil,
            auth_key: nil,
            timeout_ref: nil

  @type t :: %__MODULE__{}

  @spec new(HostIdentity.t(), keyword()) :: {:ok, t()} | {:error, atom()}
  def new(%HostIdentity{} = identity, opts \\ []) do
    with {:ok, private_key} <- HostIdentity.private_key(identity) do
      {:ok,
       %__MODULE__{
         identity: identity,
         private_key: private_key,
         random_bytes: Keyword.get(opts, :random_bytes, &:crypto.strong_rand_bytes/1),
         authenticate: Keyword.get(opts, :authenticate, &Devices.activate/3)
       }}
    end
  end

  @spec receive_text(binary(), t()) ::
          {:push, binary(), t()} | {:error, atom(), t()}
  def receive_text(raw, %__MODULE__{phase: :awaiting_hello} = state) when is_binary(raw) do
    with {:ok, hello} <- decode_json(raw),
         :ok <- require_type(hello, "hello"),
         :ok <- negotiate_protocol(hello),
         :ok <- require_host(hello, state.identity.host_id),
         {:ok, client_public_key} <- decode_bytes(hello["client_public_key"], @key_bytes),
         {:ok, client_nonce} <- decode_bytes(hello["client_nonce"], @key_bytes),
         {:ok, shared_secret} <- Crypto.shared_secret(state.private_key, client_public_key),
         {:ok, server_nonce} <- random_nonce(state.random_bytes),
         server_hello_raw <- encode_server_hello(state.identity, server_nonce),
         transcript_hash <- transcript_hash(raw, server_hello_raw),
         salt <- :crypto.hash(:sha256, client_nonce <> server_nonce),
         {:ok, keys} <- Crypto.derive_session(shared_secret, transcript_hash, salt) do
      next = %{
        state
        | phase: :awaiting_auth,
          session: Crypto.new_session(keys),
          transcript_hash: transcript_hash,
          client_nonce: client_nonce,
          server_nonce: server_nonce
      }

      {:push, server_hello_raw, next}
    else
      {:error, reason} -> {:error, reason, state}
    end
  end

  def receive_text(_raw, %__MODULE__{} = state), do: {:error, :plaintext_auth_forbidden, state}

  @spec receive_binary(binary(), t()) ::
          {:push, binary(), t()}
          | {:error, atom(), t()}
          | {:error, atom(), binary(), t()}
  def receive_binary(frame, %__MODULE__{phase: :awaiting_auth} = state) do
    with {:ok, sequence, ciphertext} <- unpack_frame(frame),
         {:ok, plaintext, decrypted_session} <-
           Crypto.decrypt(state.session, :client_to_host, sequence, ciphertext),
         {:ok, auth} <- decode_json(plaintext),
         :ok <- require_type(auth, "auth"),
         :ok <- require_transcript(auth["transcript_hash"], state.transcript_hash),
         {:ok, device_id} <- required_string(auth["device_id"]),
         {:ok, device_token} <- required_string(auth["device_token"]),
         {:ok, _device} <- state.authenticate.(device_id, device_token, @protocol_version) do
      ready_payload =
        Jason.encode!(%{
          "type" => "authenticated",
          "protocol" => @protocol_version,
          "host_id" => state.identity.host_id
        })

      with {:ok, ready_frame, encrypted_session} <-
             encrypt_payload(decrypted_session, ready_payload) do
        {:push, ready_frame,
         %{
           state
           | phase: :ready,
             device_id: device_id,
             session: encrypted_session,
             private_key: nil,
             client_nonce: nil,
             server_nonce: nil
         }}
      end
    else
      {:error, reason} when reason in [:authentication_failed, :invalid_sequence] ->
        {:error, reason, state}

      {:error, :transcript_mismatch} ->
        encrypted_error(:transcript_mismatch, "bad_auth", state)

      {:error, :revoked} ->
        encrypted_error(:revoked, "revoked", state)

      {:error, _reason} ->
        encrypted_error(:unauthorized, "unauthorized", state)
    end
  end

  def receive_binary(frame, %__MODULE__{phase: :ready} = state) do
    with {:ok, sequence, ciphertext} <- unpack_frame(frame),
         {:ok, _plaintext, next_session} <-
           Crypto.decrypt(state.session, :client_to_host, sequence, ciphertext) do
      {:error, :unexpected_handshake_frame, %{state | session: next_session}}
    else
      {:error, reason} -> {:error, reason, state}
    end
  end

  def receive_binary(_frame, %__MODULE__{} = state), do: {:error, :unexpected_binary_frame, state}

  @spec transcript_hash(binary(), binary()) :: binary()
  def transcript_hash(client_hello_raw, server_hello_raw) do
    :crypto.hash(:sha256, client_hello_raw <> "\n" <> server_hello_raw)
  end

  defp encode_server_hello(identity, server_nonce) do
    Jason.encode!(%{
      "type" => "hello_ack",
      "protocol" => @protocol_version,
      "host_id" => identity.host_id,
      "host_public_key" => Base.url_encode64(identity.public_key, padding: false),
      "server_nonce" => Base.url_encode64(server_nonce, padding: false)
    })
  end

  defp encrypted_error(reason, code, state) do
    payload = Jason.encode!(%{"type" => "auth_error", "code" => code})

    case encrypt_payload(state.session, payload) do
      {:ok, frame, encrypted_session} ->
        {:error, reason, frame, %{state | session: encrypted_session}}

      {:error, _encryption_reason} ->
        {:error, reason, state}
    end
  end

  defp encrypt_payload(session, payload) do
    with {:ok, ciphertext, next_session} <-
           Crypto.encrypt(session, :host_to_client, 1, payload) do
      {:ok, <<1::unsigned-big-64, ciphertext::binary>>, next_session}
    end
  end

  defp unpack_frame(<<sequence::unsigned-big-64, ciphertext::binary>>)
       when byte_size(ciphertext) >= @tag_bytes do
    {:ok, sequence, ciphertext}
  end

  defp unpack_frame(_frame), do: {:error, :authentication_failed}

  defp decode_json(raw) do
    case Jason.decode(raw) do
      {:ok, %{} = decoded} -> {:ok, decoded}
      _reason -> {:error, :invalid_handshake_message}
    end
  end

  defp require_type(%{"type" => expected}, expected), do: :ok
  defp require_type(_message, _expected), do: {:error, :invalid_handshake_message}

  defp negotiate_protocol(%{"protocol_min" => minimum, "protocol_max" => maximum})
       when is_integer(minimum) and is_integer(maximum) and minimum <= maximum and
              minimum <= @protocol_version and maximum >= @protocol_version,
       do: :ok

  defp negotiate_protocol(_hello), do: {:error, :protocol_incompatible}

  defp require_host(%{"host_id" => host_id}, host_id), do: :ok
  defp require_host(_hello, _host_id), do: {:error, :host_mismatch}

  defp require_transcript(encoded, expected) do
    with {:ok, supplied} <- decode_bytes(encoded, byte_size(expected)),
         true <- Plug.Crypto.secure_compare(supplied, expected) do
      :ok
    else
      _reason -> {:error, :transcript_mismatch}
    end
  end

  defp required_string(value) when is_binary(value) do
    if String.trim(value) == "", do: {:error, :invalid_auth}, else: {:ok, value}
  end

  defp required_string(_value), do: {:error, :invalid_auth}

  defp decode_bytes(value, size) when is_binary(value) do
    case Base.url_decode64(value, padding: false) do
      {:ok, decoded} when byte_size(decoded) == size -> {:ok, decoded}
      _reason -> {:error, :invalid_client_key}
    end
  end

  defp decode_bytes(_value, _size), do: {:error, :invalid_client_key}

  defp random_nonce(random_bytes) do
    case random_bytes.(@key_bytes) do
      <<nonce::binary-size(@key_bytes)>> -> {:ok, nonce}
      _other -> {:error, :invalid_server_nonce}
    end
  end
end
