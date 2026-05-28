defmodule SymphonyElixirWeb.UserSocket do
  @moduledoc "Phoenix socket for local tracker realtime updates."

  use Phoenix.Socket

  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth

  channel("project:*", SymphonyElixirWeb.TrackerChannel)
  channel("terminal:*", SymphonyElixirWeb.TerminalChannel)

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) when is_binary(token) do
    expected_token = System.get_env(Config.local_api_token_env())

    if TrackerAuth.valid_token?(token, expected_token) do
      {:ok, assign(socket, :tracker_token_valid, true)}
    else
      :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(_socket), do: nil
end
