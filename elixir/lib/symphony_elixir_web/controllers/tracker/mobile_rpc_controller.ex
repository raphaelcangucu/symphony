defmodule SymphonyElixirWeb.Tracker.MobileRpcController do
  @moduledoc """
  Host-local administration for direct mobile pairing and device revocation.

  These routes use the existing tracker operator authentication. Device
  credentials are returned only by pairing creation and are never returned by
  list or revoke operations.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.MobileRpc.{Devices, PairingOffer}
  alias SymphonyElixirWeb.TrackerErrors

  @spec create_pairing_offer(Conn.t(), map()) :: Conn.t()
  def create_pairing_offer(
        conn,
        %{
          "endpoint" => endpoint,
          "host_name" => host_name,
          "device_name" => device_name
        }
      ) do
    case PairingOffer.generate(endpoint, host_name, device_name) do
      {:ok, %{url: url, offer: offer}} ->
        conn
        |> put_status(:created)
        |> json(%{
          data: %{
            url: url,
            host_id: offer["host_id"],
            device_id: offer["device_id"],
            endpoint: offer["endpoint"],
            single_device_credential: true
          }
        })

      {:error, reason} ->
        TrackerErrors.validation_msg(conn, "could not create mobile pairing: %{reason}", %{
          reason: to_string(reason)
        })
    end
  end

  def create_pairing_offer(conn, _params) do
    TrackerErrors.validation_msg(
      conn,
      "endpoint, host_name and device_name are required"
    )
  end

  @spec devices(Conn.t(), map()) :: Conn.t()
  def devices(conn, _params) do
    data = Devices.list_paired() |> Enum.map(&Devices.public_metadata/1)
    json(conn, %{data: %{devices: data}})
  end

  @spec revoke_device(Conn.t(), map()) :: Conn.t()
  def revoke_device(conn, %{"device_id" => device_id}) do
    with {:ok, _device} <- Devices.get_paired(device_id),
         :ok <- Devices.revoke(device_id) do
      json(conn, %{data: %{revoked: true}})
    else
      {:error, :not_found} -> TrackerErrors.render(conn, :not_found)
    end
  end
end
