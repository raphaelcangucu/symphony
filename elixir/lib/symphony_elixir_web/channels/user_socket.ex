defmodule SymphonyElixirWeb.UserSocket do
  @moduledoc "Phoenix socket for local tracker realtime updates."

  use Phoenix.Socket

  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.Plugs.SetLocale
  alias SymphonyElixirWeb.TrackerAuth

  channel("project:*", SymphonyElixirWeb.TrackerChannel)
  channel("assistant:*", SymphonyElixirWeb.AssistantChannel)
  channel("terminal:*", SymphonyElixirWeb.TerminalChannel)
  channel("session_log:*", SymphonyElixirWeb.SessionLogChannel)
  channel("observability:global", SymphonyElixirWeb.ObservabilityChannel)
  channel("agent_executions", SymphonyElixirWeb.AgentExecutionChannel)

  @impl true
  def connect(%{"token" => token} = params, socket, _connect_info) when is_binary(token) do
    expected_token = System.get_env(Config.local_api_token_env())

    if TrackerAuth.valid_token?(token, expected_token) do
      {:ok,
       socket
       |> assign(:tracker_token_valid, true)
       |> assign(:gettext_locale, SetLocale.resolve_locale(Map.get(params, "locale")))}
    else
      :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(_socket), do: nil
end
