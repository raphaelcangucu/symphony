defmodule SymphonyElixirWeb.TrackerChannel do
  @moduledoc "Project-scoped realtime channel for local tracker events."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth

  @impl true
  def join("project:" <> project_slug, _payload, socket) when project_slug != "" do
    if authorized?(socket) do
      {:ok, %{project_slug: project_slug}, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_info({:tracker_event, event_name, payload}, socket) do
    push(socket, event_name, payload)
    {:noreply, socket}
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false
end
