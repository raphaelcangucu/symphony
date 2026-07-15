defmodule SymphonyElixirWeb.AgentExecutionChannel do
  @moduledoc "Global agent execution channel: pushes execution snapshots to tracker clients."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.{TrackerAuth, TrackerPresenter}

  @pubsub SymphonyElixir.PubSub
  @topic "agent_executions"

  @impl true
  def join("agent_executions", _payload, socket) do
    if authorized?(socket) do
      :ok = Phoenix.PubSub.subscribe(@pubsub, @topic)
      send(self(), :after_join)
      {:ok, %{}, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_info(:after_join, socket) do
    push(socket, "snapshot", snapshot_payload())
    {:noreply, socket}
  end

  def handle_info({:agent_execution_event, event, payload}, socket) do
    push(socket, event, payload)
    {:noreply, socket}
  end

  defp snapshot_payload do
    data = AgentExecution.list() |> Enum.map(&TrackerPresenter.agent_execution/1)
    %{"data" => data}
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false
end
