defmodule SymphonyElixirWeb.Tracker.MobilePushController do
  @moduledoc "Expo mobile push registration and test notification endpoints."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.PushNotifications.{MobileSubscription, MobileSubscriptions, NativeSender}
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case MobileSubscriptions.upsert(params) do
      {:ok, %MobileSubscription{} = subscription} ->
        conn
        |> put_status(:created)
        |> json(%{
          data: %{
            registered: true,
            device_id: subscription.device_id,
            platform: subscription.platform
          }
        })

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"profile_id" => profile_id, "device_id" => device_id})
      when is_binary(profile_id) and profile_id != "" and is_binary(device_id) and device_id != "" do
    :ok = MobileSubscriptions.delete(profile_id, device_id)
    json(conn, %{data: %{deleted: true}})
  end

  def delete(conn, _params),
    do: TrackerErrors.validation_msg(conn, "profile_id and device_id are required")

  @spec test(Conn.t(), map()) :: Conn.t()
  def test(conn, _params) do
    :ok =
      sender().deliver_all("test", %{
        title: "Symphony test",
        body: "Native notifications are connected."
      })

    json(conn, %{data: %{sent: true, device_count: MobileSubscriptions.count()}})
  end

  defp sender do
    Application.get_env(:symphony_elixir, :native_push_sender, NativeSender)
  end
end
