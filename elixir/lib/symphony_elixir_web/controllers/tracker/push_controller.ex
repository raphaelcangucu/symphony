defmodule SymphonyElixirWeb.Tracker.PushController do
  @moduledoc "Browser Web Push subscription management."

  use Phoenix.Controller, formats: [:json]
  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias Gettext, as: GettextCore
  alias Plug.Conn
  alias SymphonyElixir.PushNotifications.{Config, Subscription, Subscriptions}
  alias SymphonyElixir.Settings.Ui
  alias SymphonyElixirWeb.{Gettext, as: GettextBackend, TrackerErrors}

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
      TrackerErrors.render(conn, :push_not_configured_vapid)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"endpoint" => endpoint}) when is_binary(endpoint) and endpoint != "" do
    :ok = Subscriptions.delete_by_endpoint(endpoint)
    json(conn, %{data: %{deleted: true}})
  end

  def delete(conn, _params) do
    TrackerErrors.validation_msg(conn, "endpoint is required")
  end

  @spec test(Conn.t(), map()) :: Conn.t()
  def test(conn, _params) do
    if Config.enabled?() do
      GettextCore.with_locale(GettextBackend, Ui.effective_gettext_locale(), fn ->
        :ok =
          SymphonyElixir.PushNotifications.Dispatcher.notify("test", %{
            title: dgettext("push", "Symphony test"),
            body: dgettext("push", "Push notification test — tap to open Settings"),
            url: "/tracker/settings",
            tag: "symphony-test"
          })
      end)

      json(conn, %{data: %{sent: true, subscription_count: Subscriptions.count()}})
    else
      TrackerErrors.render(conn, :push_not_configured)
    end
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
