defmodule SymphonyElixir.MobileRpc.Devices do
  @moduledoc """
  Registry for pending and paired mobile devices.

  Raw device tokens are returned once in the pairing offer. Only an HMAC digest
  tied to this Symphony instance is persisted.
  """

  import Ecto.Query

  alias SymphonyElixir.MobileRpc.Device
  alias SymphonyElixir.Repo

  @scope "mobile"
  @token_bytes 32
  @protocol_version 1

  @spec create_pairing(String.t()) ::
          {:ok, %{device: Device.t(), token: String.t()}} | {:error, term()}
  def create_pairing(name) when is_binary(name) do
    normalized_name = String.trim(name)

    if normalized_name == "" do
      {:error, :invalid_device_name}
    else
      Repo.transaction(fn ->
        now = now()

        from(device in Device,
          where:
            device.scope == @scope and is_nil(device.paired_at) and
              is_nil(device.revoked_at)
        )
        |> Repo.update_all(set: [revoked_at: now, updated_at: now])

        token = Base.url_encode64(:crypto.strong_rand_bytes(@token_bytes), padding: false)

        device =
          %Device{}
          |> Device.changeset(%{
            device_id: random_id("device_", 18),
            name: normalized_name,
            token_digest: token_digest(token),
            scope: @scope
          })
          |> Repo.insert!()

        %{device: device, token: token}
      end)
    end
  end

  @spec validate_token(String.t(), String.t()) ::
          {:ok, Device.t()} | {:error, :invalid_token | :revoked}
  def validate_token(device_id, token) when is_binary(device_id) and is_binary(token) do
    case Repo.get_by(Device, device_id: device_id) do
      nil ->
        {:error, :invalid_token}

      %Device{revoked_at: revoked_at} when not is_nil(revoked_at) ->
        {:error, :revoked}

      %Device{} = device ->
        supplied_digest = token_digest(token)

        if byte_size(supplied_digest) == byte_size(device.token_digest) and
             Plug.Crypto.secure_compare(supplied_digest, device.token_digest) do
          {:ok, device}
        else
          {:error, :invalid_token}
        end
    end
  end

  def validate_token(_device_id, _token), do: {:error, :invalid_token}

  @spec activate(String.t(), String.t(), integer()) ::
          {:ok, Device.t()} | {:error, atom() | Ecto.Changeset.t()}
  def activate(device_id, token, @protocol_version) do
    with {:ok, device} <- validate_token(device_id, token) do
      current_time = now()

      device
      |> Device.changeset(%{
        paired_at: device.paired_at || current_time,
        last_seen_at: current_time,
        protocol_version: @protocol_version
      })
      |> Repo.update()
    end
  end

  def activate(_device_id, _token, _protocol_version), do: {:error, :protocol_incompatible}

  @spec list_paired() :: [Device.t()]
  def list_paired do
    Repo.all(
      from(device in Device,
        where: not is_nil(device.paired_at) and is_nil(device.revoked_at),
        order_by: [asc: device.paired_at]
      )
    )
  end

  @spec revoke(String.t()) :: :ok
  def revoke(device_id) when is_binary(device_id) do
    current_time = now()

    from(device in Device,
      where: device.device_id == ^device_id and is_nil(device.revoked_at)
    )
    |> Repo.update_all(set: [revoked_at: current_time, updated_at: current_time])

    :ok
  end

  defp token_digest(token) do
    :crypto.mac(:hmac, :sha256, token_digest_key(), token)
  end

  defp token_digest_key do
    secret =
      :symphony_elixir
      |> Application.get_env(SymphonyElixirWeb.Endpoint, [])
      |> Keyword.get(:secret_key_base, "")

    :crypto.hash(:sha256, "symphony.mobile_rpc.device_token.v1\0" <> secret)
  end

  defp random_id(prefix, bytes) do
    prefix <> Base.url_encode64(:crypto.strong_rand_bytes(bytes), padding: false)
  end

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:microsecond)
end
