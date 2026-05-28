defmodule SymphonyElixirWeb.Router do
  @moduledoc """
  Router for Symphony's observability dashboard and API.
  """

  use Phoenix.Router
  import Phoenix.LiveView.Router

  pipeline :browser do
    plug(:fetch_session)
    plug(:fetch_live_flash)
    plug(:put_root_layout, html: {SymphonyElixirWeb.Layouts, :root})
    plug(:protect_from_forgery)
    plug(:put_secure_browser_headers)
  end

  pipeline :tracker_api do
    plug(:accepts, ["json"])
    plug(SymphonyElixirWeb.TrackerAuth)
  end

  scope "/", SymphonyElixirWeb do
    get("/dashboard.css", StaticAssetController, :dashboard_css)
    get("/vendor/phoenix_html/phoenix_html.js", StaticAssetController, :phoenix_html_js)
    get("/vendor/phoenix/phoenix.js", StaticAssetController, :phoenix_js)
    get("/vendor/phoenix_live_view/phoenix_live_view.js", StaticAssetController, :phoenix_live_view_js)
    get("/tracker", StaticAssetController, :tracker_index)
    get("/tracker/*path", StaticAssetController, :tracker_asset_or_index)
  end

  scope "/", SymphonyElixirWeb do
    pipe_through(:browser)

    live("/", DashboardLive, :index)
  end

  scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do
    pipe_through(:tracker_api)

    resources("/projects", ProjectController, only: [:index, :create, :show])
    resources("/projects/:project_slug/issues", IssueController, only: [:index, :create, :show, :update])
    post("/projects/:project_slug/issues/:identifier/move", IssueController, :move)
    get("/projects/:project_slug/issues/:identifier/comments", CommentController, :index)
    post("/projects/:project_slug/issues/:identifier/comments", CommentController, :create)
    get("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :index)
    post("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :create)
    delete("/projects/:project_slug/issues/:identifier/blockers/:blocker_identifier", BlockerController, :delete)
    post("/projects/:project_slug/issues/:identifier/terminal", TerminalController, :create)
  end

  scope "/", SymphonyElixirWeb do
    get("/api/v1/state", ObservabilityApiController, :state)

    match(:*, "/", ObservabilityApiController, :method_not_allowed)
    match(:*, "/api/v1/state", ObservabilityApiController, :method_not_allowed)
    post("/api/v1/refresh", ObservabilityApiController, :refresh)
    match(:*, "/api/v1/refresh", ObservabilityApiController, :method_not_allowed)
    get("/api/v1/:issue_identifier", ObservabilityApiController, :issue)
    match(:*, "/api/v1/:issue_identifier", ObservabilityApiController, :method_not_allowed)
    match(:*, "/*path", ObservabilityApiController, :not_found)
  end
end
