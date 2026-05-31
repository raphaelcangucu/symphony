defmodule SymphonyElixirWeb.Router do
  @moduledoc """
  Router for Symphony's observability dashboard and API.
  """

  use Phoenix.Router

  pipeline :browser do
    plug(:accepts, ["html"])
    plug(:fetch_session)
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

    get("/", RootRedirectController, :index)
  end

  scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do
    pipe_through(:tracker_api)

    get("/viewer", ViewerController, :show)
    get("/observability", ObservabilityController, :index)
    post("/observability/report", ObservabilityController, :report)
    get("/agent_executions", AgentExecutionController, :index)
    get("/github/owners", GitHubController, :owners)
    get("/github/owners/:owner/repositories", GitHubController, :repositories)
    post("/github/projects/discover", RemoteDiscoveryController, :github_discover)
    post("/linear/projects/discover", RemoteDiscoveryController, :linear_discover)
    post("/project_setup/scan", ProjectSetupController, :scan)
    post("/project_setup/suggest", ProjectSetupController, :suggest)
    post("/projects/workspace", ProjectController, :workspace)
    post("/projects/:id/archive", ProjectController, :archive)
    post("/projects/:id/restore", ProjectController, :restore)
    resources("/projects", ProjectController, only: [:index, :create, :show, :update, :delete])
    get("/projects/:project_slug/issues/form_options", IssueController, :form_options)
    get("/assistant/threads", AssistantThreadController, :index)
    post("/assistant/threads", AssistantThreadController, :create)
    get("/recents", RecentsController, :index)
    get("/projects/:project_slug/assistant/config", AssistantController, :config)
    post("/projects/:project_slug/assistant/attachments", AssistantController, :upload_attachment)
    post("/projects/:project_slug/assistant/messages", AssistantController, :create)
    resources("/projects/:project_slug/issues", IssueController, only: [:index, :create, :show, :update])
    get("/projects/:project_slug/issues/:identifier/documents", IssueDocumentController, :index)
    get("/projects/:project_slug/issues/:identifier/documents/*path", IssueDocumentController, :show)
    post("/projects/:project_slug/issues/:identifier/move", IssueController, :move)
    get("/projects/:project_slug/issues/:identifier/comments", CommentController, :index)
    post("/projects/:project_slug/issues/:identifier/comments", CommentController, :create)
    get("/projects/:project_slug/issues/:identifier/pull_requests", PullRequestController, :index)
    post("/projects/:project_slug/issues/:identifier/pull_requests/fix", PullRequestFixController, :create)

    post(
      "/projects/:project_slug/issues/:identifier/pull_requests/:number/update_branch",
      PullRequestBranchController,
      :update
    )

    post(
      "/projects/:project_slug/issues/:identifier/pull_requests/:number/merge",
      PullRequestMergeController,
      :create
    )

    get("/projects/:project_slug/issues/:identifier/activity", ActivityController, :index)
    get("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :index)
    post("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :create)
    delete("/projects/:project_slug/issues/:identifier/blockers/:blocker_identifier", BlockerController, :delete)
    post("/projects/:project_slug/issues/:identifier/terminal", TerminalController, :create)
    get("/projects/:project_slug/issues/:identifier/dev_servers", DevServerController, :index)
    post("/projects/:project_slug/issues/:identifier/dev_servers/start", DevServerController, :start)
    post("/projects/:project_slug/issues/:identifier/dev_servers/stop", DevServerController, :stop)
    post("/projects/:project_slug/issues/:identifier/dev_servers/restart", DevServerController, :restart)
    get("/projects/:project_slug/issues/:identifier/editor", EditorController, :show)
    get("/projects/:project_slug/dev_env/steps", DevEnvController, :index)
    put("/projects/:project_slug/dev_env/steps", DevEnvController, :save)
    post("/projects/:project_slug/dev_env/propose", DevEnvController, :propose)
    post("/projects/:project_slug/dev_env/run", DevEnvController, :run)
    post("/projects/:project_slug/dev_env/steps/:step_id/run", DevEnvController, :run_step)
    get("/projects/:project_slug/dev_env/runs", DevEnvController, :runs)
    post("/templates/import", TemplateController, :import)
    resources("/templates", TemplateController, only: [:index, :create, :show, :update, :delete], param: "slug")
    get("/templates/:slug/export", TemplateController, :export)
    post("/templates/:template_slug/instantiate", TemplateController, :instantiate)
    post("/projects/:project_slug/save_as_template", TemplateController, :save_as_template)
    get("/projects/:project_slug/clone_jobs", CloneJobController, :index)
    post("/projects/:project_slug/clone_jobs/:id/retry", CloneJobController, :retry)
  end

  scope "/", SymphonyElixirWeb do
    get("/api/v1/state", ObservabilityApiController, :state)

    match(:*, "/api/v1/state", ObservabilityApiController, :method_not_allowed)
    post("/api/v1/refresh", ObservabilityApiController, :refresh)
    match(:*, "/api/v1/refresh", ObservabilityApiController, :method_not_allowed)
    get("/api/v1/:issue_identifier", ObservabilityApiController, :issue)
    match(:*, "/api/v1/:issue_identifier", ObservabilityApiController, :method_not_allowed)
    match(:*, "/*path", ObservabilityApiController, :not_found)
  end
end
