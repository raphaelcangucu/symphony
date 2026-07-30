defmodule SymphonyElixir.InstanceSecret do
  @moduledoc """
  Stable per-instance root secret for encrypted local state and mobile RPC.

  Operators may provide `SYMPHONY_CREDENTIALS_KEY` as base64-encoded 32 bytes.
  Otherwise Symphony creates a random key beside the local tracker database,
  stores it with owner-only permissions, and reuses it across restarts.
  """

  alias SymphonyElixir.Config

  @key_env "SYMPHONY_CREDENTIALS_KEY"
  @secret_bytes 32
  @filename "instance.key"

  @spec root_key() :: binary()
  def root_key do
    case System.get_env(@key_env) do
      value when is_binary(value) and value != "" -> decode_env_key!(value)
      _ -> load_or_create_file_key!()
    end
  end

  @spec derive(String.t()) :: binary()
  def derive(label) when is_binary(label) and label != "" do
    :crypto.mac(:hmac, :sha256, root_key(), "symphony.instance.v1\0" <> label)
  end

  @spec path() :: String.t()
  def path do
    Application.get_env(:symphony_elixir, :instance_secret_path) ||
      Path.join(Path.dirname(Config.local_tracker_database_path()), @filename)
  end

  defp decode_env_key!(value) do
    case Base.decode64(String.trim(value)) do
      {:ok, <<key::binary-size(@secret_bytes)>>} ->
        key

      _ ->
        raise ArgumentError,
              "#{@key_env} must be base64-encoded #{@secret_bytes} bytes"
    end
  end

  defp load_or_create_file_key! do
    key_path = path()

    case read_file_key(key_path) do
      {:ok, key} ->
        key

      {:error, :enoent} ->
        create_file_key!(key_path)

      {:error, reason} ->
        raise "could not read Symphony instance secret #{key_path}: #{inspect(reason)}"
    end
  end

  defp read_file_key(key_path) do
    with {:ok, encoded} <- File.read(key_path),
         {:ok, <<key::binary-size(@secret_bytes)>>} <- Base.decode64(String.trim(encoded)) do
      {:ok, key}
    else
      {:error, :enoent} -> {:error, :enoent}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :invalid_instance_secret}
    end
  end

  defp create_file_key!(key_path) do
    File.mkdir_p!(Path.dirname(key_path))
    key = :crypto.strong_rand_bytes(@secret_bytes)
    encoded = Base.encode64(key)
    temporary_path = "#{key_path}.tmp.#{System.unique_integer([:positive, :monotonic])}"

    try do
      :ok = write_private_file(temporary_path, encoded)

      case File.ln(temporary_path, key_path) do
        :ok ->
          key

        {:error, :eexist} ->
          case read_file_key(key_path) do
            {:ok, existing_key} -> existing_key
            {:error, reason} -> raise "invalid Symphony instance secret: #{inspect(reason)}"
          end

        {:error, reason} ->
          raise "could not persist Symphony instance secret: #{inspect(reason)}"
      end
    after
      File.rm(temporary_path)
    end
  end

  defp write_private_file(path, contents) do
    with :ok <- File.write(path, contents, [:binary, :exclusive]),
         :ok <- File.chmod(path, 0o600) do
      :ok
    end
  end
end
