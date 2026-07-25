defmodule SymphonyElixir.MobileRpc.Crypto do
  @moduledoc """
  Version-one application encryption primitives for the mobile RPC transport.

  The module keeps frame sequencing separate for each direction and advances a
  receive counter only after authenticated decryption succeeds.
  """

  @key_bytes 32
  @tag_bytes 16
  @hash_bytes 32
  @max_sequence 0xFFFFFFFFFFFFFFFF
  @protocol_prefix "symphony-mobile-rpc-v1"

  @type direction :: :client_to_host | :host_to_client
  @type session_keys :: %{client_to_host: binary(), host_to_client: binary()}

  @opaque t :: %__MODULE__{
            client_to_host: binary(),
            host_to_client: binary(),
            sent: %{direction() => non_neg_integer()},
            received: %{direction() => non_neg_integer()}
          }

  defstruct client_to_host: nil,
            host_to_client: nil,
            sent: %{client_to_host: 0, host_to_client: 0},
            received: %{client_to_host: 0, host_to_client: 0}

  @spec public_key(binary()) :: {:ok, binary()} | {:error, :invalid_key}
  def public_key(secret_key) when is_binary(secret_key) and byte_size(secret_key) == @key_bytes do
    try do
      {public_key, _secret_key} = :crypto.generate_key(:ecdh, :x25519, secret_key)
      {:ok, public_key}
    rescue
      _error -> {:error, :invalid_key}
    end
  end

  def public_key(_secret_key), do: {:error, :invalid_key}

  @spec shared_secret(binary(), binary()) :: {:ok, binary()} | {:error, :invalid_key}
  def shared_secret(secret_key, peer_public_key)
      when is_binary(secret_key) and byte_size(secret_key) == @key_bytes and
             is_binary(peer_public_key) and byte_size(peer_public_key) == @key_bytes do
    try do
      shared = :crypto.compute_key(:ecdh, peer_public_key, secret_key, :x25519)

      if shared == :binary.copy(<<0>>, @key_bytes) do
        {:error, :invalid_key}
      else
        {:ok, shared}
      end
    rescue
      _error -> {:error, :invalid_key}
    end
  end

  def shared_secret(_secret_key, _peer_public_key), do: {:error, :invalid_key}

  @spec hkdf_sha256(binary(), binary(), binary(), non_neg_integer()) ::
          {:ok, %{prk: binary(), okm: binary()}} | {:error, :invalid_hkdf_input}
  def hkdf_sha256(input_key_material, salt, info, length)
      when is_binary(input_key_material) and is_binary(salt) and is_binary(info) and
             is_integer(length) and length >= 0 and length <= 255 * @hash_bytes do
    prk = :crypto.mac(:hmac, :sha256, salt, input_key_material)
    {:ok, %{prk: prk, okm: hkdf_expand(prk, info, length)}}
  end

  def hkdf_sha256(_input_key_material, _salt, _info, _length),
    do: {:error, :invalid_hkdf_input}

  @spec derive_session(binary(), binary(), binary()) ::
          {:ok, session_keys()} | {:error, :invalid_hkdf_input}
  def derive_session(shared_secret, transcript_hash, salt)
      when is_binary(shared_secret) and byte_size(shared_secret) == @key_bytes and
             is_binary(transcript_hash) and byte_size(transcript_hash) == @hash_bytes and
             is_binary(salt) do
    with {:ok, %{okm: client_to_host}} <-
           hkdf_sha256(
             shared_secret,
             salt,
             @protocol_prefix <> "/client-to-host/" <> transcript_hash,
             @key_bytes
           ),
         {:ok, %{okm: host_to_client}} <-
           hkdf_sha256(
             shared_secret,
             salt,
             @protocol_prefix <> "/host-to-client/" <> transcript_hash,
             @key_bytes
           ) do
      {:ok, %{client_to_host: client_to_host, host_to_client: host_to_client}}
    end
  end

  def derive_session(_shared_secret, _transcript_hash, _salt),
    do: {:error, :invalid_hkdf_input}

  @spec nonce_for_sequence(integer()) :: {:ok, binary()} | {:error, :invalid_sequence}
  def nonce_for_sequence(sequence) when sequence in 1..@max_sequence do
    {:ok, <<0::32, sequence::unsigned-big-64>>}
  end

  def nonce_for_sequence(_sequence), do: {:error, :invalid_sequence}

  @spec aad_for_frame(direction(), integer()) ::
          {:ok, binary()} | {:error, :invalid_direction | :invalid_sequence}
  def aad_for_frame(direction, sequence) do
    with {:ok, label} <- direction_label(direction),
         {:ok, <<_padding::32, encoded_sequence::binary-size(8)>>} <-
           nonce_for_sequence(sequence) do
      {:ok, @protocol_prefix <> "|" <> label <> "|" <> encoded_sequence}
    end
  end

  @spec encrypt_frame(binary(), direction(), integer(), binary()) ::
          {:ok, binary()} | {:error, atom()}
  def encrypt_frame(key, direction, sequence, plaintext)
      when is_binary(key) and byte_size(key) == @key_bytes and is_binary(plaintext) do
    with {:ok, nonce} <- nonce_for_sequence(sequence),
         {:ok, aad} <- aad_for_frame(direction, sequence) do
      {ciphertext, tag} =
        :crypto.crypto_one_time_aead(
          :chacha20_poly1305,
          key,
          nonce,
          plaintext,
          aad,
          @tag_bytes,
          true
        )

      {:ok, ciphertext <> tag}
    end
  rescue
    _error -> {:error, :encryption_failed}
  end

  def encrypt_frame(_key, _direction, _sequence, _plaintext),
    do: {:error, :invalid_key}

  @spec decrypt_frame(binary(), direction(), integer(), binary()) ::
          {:ok, binary()} | {:error, atom()}
  def decrypt_frame(key, direction, sequence, frame)
      when is_binary(key) and byte_size(key) == @key_bytes and is_binary(frame) and
             byte_size(frame) >= @tag_bytes do
    ciphertext_size = byte_size(frame) - @tag_bytes
    <<ciphertext::binary-size(ciphertext_size), tag::binary-size(@tag_bytes)>> = frame

    with {:ok, nonce} <- nonce_for_sequence(sequence),
         {:ok, aad} <- aad_for_frame(direction, sequence),
         plaintext when is_binary(plaintext) <-
           :crypto.crypto_one_time_aead(
             :chacha20_poly1305,
             key,
             nonce,
             ciphertext,
             aad,
             tag,
             false
           ) do
      {:ok, plaintext}
    else
      :error -> {:error, :authentication_failed}
      {:error, _reason} = error -> error
    end
  rescue
    _error -> {:error, :authentication_failed}
  end

  def decrypt_frame(_key, _direction, _sequence, _frame),
    do: {:error, :authentication_failed}

  @spec new_session(session_keys()) :: t()
  def new_session(%{client_to_host: client_to_host, host_to_client: host_to_client})
      when is_binary(client_to_host) and byte_size(client_to_host) == @key_bytes and
             is_binary(host_to_client) and byte_size(host_to_client) == @key_bytes do
    %__MODULE__{
      client_to_host: client_to_host,
      host_to_client: host_to_client
    }
  end

  @spec encrypt(t(), direction(), integer(), binary()) ::
          {:ok, binary(), t()} | {:error, atom()}
  def encrypt(%__MODULE__{} = session, direction, sequence, plaintext) do
    with :ok <- require_next(session.sent, direction, sequence),
         {:ok, key} <- session_key(session, direction),
         {:ok, frame} <- encrypt_frame(key, direction, sequence, plaintext) do
      {:ok, frame, %{session | sent: Map.put(session.sent, direction, sequence)}}
    end
  end

  @spec decrypt(t(), direction(), integer(), binary()) ::
          {:ok, binary(), t()} | {:error, atom()}
  def decrypt(%__MODULE__{} = session, direction, sequence, frame) do
    with :ok <- require_next(session.received, direction, sequence),
         {:ok, key} <- session_key(session, direction),
         {:ok, plaintext} <- decrypt_frame(key, direction, sequence, frame) do
      {:ok, plaintext, %{session | received: Map.put(session.received, direction, sequence)}}
    end
  end

  defp hkdf_expand(_prk, _info, 0), do: <<>>

  defp hkdf_expand(prk, info, length) do
    block_count = div(length + @hash_bytes - 1, @hash_bytes)

    {_previous, output} =
      Enum.reduce(1..block_count, {<<>>, <<>>}, fn block_index, {previous, output} ->
        block = :crypto.mac(:hmac, :sha256, prk, previous <> info <> <<block_index>>)
        {block, output <> block}
      end)

    binary_part(output, 0, length)
  end

  defp direction_label(:client_to_host), do: {:ok, "c2h"}
  defp direction_label(:host_to_client), do: {:ok, "h2c"}
  defp direction_label(_direction), do: {:error, :invalid_direction}

  defp session_key(%__MODULE__{client_to_host: key}, :client_to_host), do: {:ok, key}
  defp session_key(%__MODULE__{host_to_client: key}, :host_to_client), do: {:ok, key}
  defp session_key(_session, _direction), do: {:error, :invalid_direction}

  defp require_next(counters, direction, sequence) do
    with {:ok, _label} <- direction_label(direction),
         {:ok, _nonce} <- nonce_for_sequence(sequence),
         current when is_integer(current) <- Map.fetch!(counters, direction),
         true <- sequence == current + 1 do
      :ok
    else
      _reason -> {:error, :invalid_sequence}
    end
  end
end
