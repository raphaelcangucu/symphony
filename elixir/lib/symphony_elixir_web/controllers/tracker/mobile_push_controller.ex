defmodule SymphonyElixirWeb.Tracker.MobilePushController do
  @moduledoc "Expo mobile push registration and test notification endpoints."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.PushNotifications.{MobileSubscription, MobileSubscriptions, NativeSender}
  alias SymphonyElixirWeb.TrackerErrors

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case upsert(conn, params) do
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

      {:error, :not_owner} ->
        conn
        |> put_status(:forbidden)
        |> json(%{
          error: %{
            code: "mobile_push_not_owned",
            message: "This push registration belongs to another paired mobile device."
          }
        })
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(
        %Conn{assigns: %{mobile_rpc_context: context}} = conn,
        %{"device_id" => device_id} = params
      )
      when is_map_key(context, :host_id) and is_map_key(context, :device_id) and
             is_binary(device_id) and device_id != "" do
    render_delete(conn, delete_subscription(conn, params, device_id))
  end

  def delete(conn, %{"profile_id" => profile_id, "device_id" => device_id} = params)
      when is_binary(profile_id) and profile_id != "" and
             is_binary(device_id) and device_id != "" do
    render_delete(conn, delete_subscription(conn, params, device_id))
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

  defp render_delete(conn, result) do
    case result do
      :ok ->
        json(conn, %{data: %{deleted: true}})

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{
          error: %{
            code: "mobile_push_not_found",
            message: "Push registration was not found for this paired mobile device."
          }
        })
    end
  end

  defp sender do
    Application.get_env(:symphony_elixir, :native_push_sender, NativeSender)
  end

  defp upsert(%Conn{assigns: %{mobile_rpc_context: context}}, params)
       when is_map_key(context, :host_id) and is_map_key(context, :device_id) do
    params
    |> Map.put("profile_id", context.host_id)
    |> MobileSubscriptions.upsert_owned(context.device_id)
  end

  defp upsert(_conn, params), do: MobileSubscriptions.upsert(params)

  defp delete_subscription(
         %Conn{assigns: %{mobile_rpc_context: context}},
         _params,
         device_id
       )
       when is_map_key(context, :host_id) and is_map_key(context, :device_id) do
    MobileSubscriptions.delete_owned(context.host_id, device_id, context.device_id)
  end

  defp delete_subscription(_conn, %{"profile_id" => profile_id}, device_id)
       when is_binary(profile_id) and profile_id != "" do
    MobileSubscriptions.delete(profile_id, device_id)
  end

  defp delete_subscription(_conn, _params, _device_id), do: {:error, :not_found}
end
