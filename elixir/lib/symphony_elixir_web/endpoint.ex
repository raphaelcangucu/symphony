defmodule SymphonyElixirWeb.Endpoint do
  @moduledoc """
  Phoenix endpoint for Symphony's optional observability UI and API.
  """

  use Phoenix.Endpoint, otp_app: :symphony_elixir

  @session_options [
    store: :cookie,
    key: "_symphony_elixir_key",
    signing_salt: "symphony-session"
  ]

  socket("/live", Phoenix.LiveView.Socket,
    websocket: [connect_info: [session: @session_options]],
    longpoll: false
  )

  socket("/socket", SymphonyElixirWeb.UserSocket,
    websocket: true,
    longpoll: false
  )

  plug(Plug.RequestId)
  plug(Plug.Telemetry, event_prefix: [:phoenix, :endpoint])
  plug(SymphonyElixirWeb.MobileRpcUpgradePlug)

  # Reverse-proxy preview-host traffic before Plug.Parsers so the upstream
  # receives the raw request body. Parsing here would consume the body and
  # leave the proxied request with a Content-Length header but no payload,
  # causing the upstream dev server to hang on POSTs (e.g. Livewire updates).
  plug(SymphonyElixirWeb.PublicHostPlug)

  plug(Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason
  )

  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(Plug.Session, @session_options)
  plug(SymphonyElixirWeb.Plugs.Cors)
  plug(SymphonyElixirWeb.Router)
end
