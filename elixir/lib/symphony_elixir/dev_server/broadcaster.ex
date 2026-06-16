defmodule SymphonyElixir.DevServer.Broadcaster do
  @moduledoc "Broadcasts dev-server preview status changes to SSE subscribers."

  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer
  alias SymphonyElixirWeb.DevServerPresenter

  @pubsub SymphonyElixir.PubSub

  @spec topic(String.t(), String.t()) :: String.t()
  def topic(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    "dev_server:#{project_slug}:#{canonical_identifier(identifier)}"
  end

  @spec notify(String.t(), String.t()) :: :ok
  def notify(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    identifier = canonical_identifier(identifier)

    case build_payload(project_slug, identifier) do
      {:ok, payload} ->
        Phoenix.PubSub.broadcast(@pubsub, topic(project_slug, identifier), {:dev_server_update, payload})

      :error ->
        :ok
    end
  end

  def notify(_project_slug, _identifier), do: :ok

  @spec build_payload(String.t(), String.t()) :: {:ok, map()} | :error
  def build_payload(project_slug, identifier) do
    with {:ok, view} <- DevServer.issue_targets(project_slug, identifier) do
      data =
        view
        |> DevServerPresenter.view()
        |> Map.put(:tunnel, Tunnel.summary())

      {:ok, %{data: data}}
    else
      _ -> :error
    end
  end

  defp canonical_identifier(identifier) do
    identifier
    |> String.trim()
    |> String.trim_leading("#")
  end
end
