defmodule SymphonyElixirWeb.Tracker.PushController do
  @moduledoc "Browser Web Push subscription management."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.PushNotifications.{Config, Subscription, Subscriptions}
  alias SymphonyElixirWeb.TrackerErrors

  @spec config(Conn.t(), map()) :: Conn.t()
  def config(conn, _params) do
    json(conn, %{
      data: %{
        enabled: Config.enabled?(),
        public_key: Config.vapid_public_key(),
        subject: Config.vapid_subject(),
        subscription_count: Subscriptions.count()
      }
    })
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    if Config.enabled?() do
      attrs =
        params
        |> Map.put("user_agent", user_agent(conn))
        |> Subscription.from_browser_map()

      case Subscriptions.upsert(attrs) do
        {:ok, subscription} ->
          conn
          |> put_status(:created)
          |> json(%{data: present(subscription)})

        {:error, %Ecto.Changeset{} = changeset} ->
          TrackerErrors.render(conn, changeset)
      end
    else
      conn
      |> put_status(:service_unavailable)
      |> json(%{
        error: %{
          code: "push_not_configured",
          message: "Web Push is not configured (missing VAPID keys)"
        }
      })
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"endpoint" => endpoint}) when is_binary(endpoint) and endpoint != "" do
    :ok = Subscriptions.delete_by_endpoint(endpoint)
    json(conn, %{data: %{deleted: true}})
  end

  def delete(conn, _params) do
    TrackerErrors.validation(conn, "endpoint is required")
  end

  defp present(%Subscription{} = subscription) do
    %{
      id: subscription.id,
      endpoint: subscription.endpoint,
      inserted_at: subscription.inserted_at
    }
  end

  defp user_agent(conn) do
    case get_req_header(conn, "user-agent") do
      [agent | _] -> agent
      _ -> nil
    end
  end
end
