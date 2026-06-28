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
    plug(SymphonyElixirWeb.Plugs.SetLocale)
    plug(SymphonyElixirWeb.TrackerAuth)
  end

  pipeline :tracker_sse do
    plug(SymphonyElixirWeb.Plugs.SetLocale)
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
    pipe_through(:tracker_sse)

    get("/projects/:project_slug/issues/:identifier/dev_servers/events", DevServerController, :events)

    get(
      "/projects/:project_slug/issues/:identifier/dev_servers/:server_id/output/events",
      DevServerController,
      :output_events
    )
  end

  scope "/api/tracker/v1", SymphonyElixirWeb.Tracker do
    pipe_through(:tracker_api)

    get("/viewer", ViewerController, :show)
    get("/settings", SettingsController, :index)
    get("/settings/agents/availability", SettingsController, :availability)
    get("/settings/identities", SettingsController, :identities)
    get("/settings/credentials", CredentialsController, :index)
    put("/settings/credentials", CredentialsController, :update)
    delete("/settings/credentials/:provider/:key", CredentialsController, :delete)
    get("/push/config", PushController, :config)
    post("/push/subscriptions", PushController, :create)
    delete("/push/subscriptions", PushController, :delete)
    post("/push/test", PushController, :test)
    put("/settings/:group", SettingsController, :update)
    get("/observability", ObservabilityController, :index)
    get("/observability/pr_monitor", ObservabilityController, :pr_monitor)
    post("/observability/report", ObservabilityController, :report)
    get("/backups", BackupController, :index)
    get("/backups/stats", BackupController, :stats)
    post("/backups", BackupController, :create)
    post("/backups/cleanup", BackupController, :cleanup)
    get("/backups/:id", BackupController, :show)
    get("/backups/:id/download", BackupController, :download)
    post("/backups/:id/restore", BackupController, :restore)
    delete("/backups/:id", BackupController, :delete)
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
    put("/projects/:id/setup", ProjectController, :update_setup)
    put("/projects/:id/repositories", ProjectController, :update_repositories)
    get("/projects/:id/export", ProjectController, :export)
    post("/projects/:id/share", ProjectController, :share)
    post("/projects/import", ProjectController, :import_bundle)
    post("/projects/:id/import", ProjectController, :import_config)
    resources("/projects", ProjectController, only: [:index, :create, :show, :update, :delete])
    get("/projects/:project_slug/issues/form_options", IssueController, :form_options)
    get("/assistant/threads", AssistantThreadController, :index)
    post("/assistant/threads", AssistantThreadController, :create)
    post("/assistant/threads/:thread_id/archive", AssistantThreadController, :archive)
    get("/assistant/threads/:thread_id/documents", AssistantThreadDocumentController, :index)
    get("/assistant/threads/:thread_id/documents/*path", AssistantThreadDocumentController, :show)
    get("/recents", RecentsController, :index)
    get("/projects/:project_slug/assistant/config", AssistantController, :config)
    post("/projects/:project_slug/assistant/attachments", AssistantController, :upload_attachment)
    get("/projects/:project_slug/assistant/attachments/*path", AssistantController, :show_attachment)
    get("/projects/:project_slug/jira/attachments/:id", JiraAttachmentController, :show)
    delete("/projects/:project_slug/jira/attachments/:id", JiraAttachmentController, :delete)
    get("/projects/:project_slug/github/assets/:owner/:repo/:basename", GitHubAssetController, :show)
    post("/projects/:project_slug/assistant/messages", AssistantController, :create)
    resources("/projects/:project_slug/issues", IssueController, only: [:index, :create, :show, :update])
    get("/projects/:project_slug/issues/:identifier/documents", IssueDocumentController, :index)
    get("/projects/:project_slug/issues/:identifier/documents/*path", IssueDocumentController, :show)
    post("/projects/:project_slug/issues/:identifier/move", IssueController, :move)
    post("/projects/:project_slug/issues/:identifier/dispatch", IssueController, :dispatch_agent)
    post("/projects/:project_slug/issues/:identifier/goal", IssueController, :goal_control)
    post("/projects/:project_slug/issues/:identifier/sync", IssueController, :sync)
    post("/projects/:project_slug/issues/:identifier/archive", IssueController, :archive)
    post("/projects/:project_slug/issues/:identifier/restore", IssueController, :restore)
    delete("/projects/:project_slug/issues/:identifier", IssueController, :delete)
    get("/projects/:project_slug/issues/:identifier/comments", CommentController, :index)
    post("/projects/:project_slug/issues/:identifier/comments", CommentController, :create)
    patch("/projects/:project_slug/issues/:identifier/comments/:comment_id", CommentController, :update)
    delete("/projects/:project_slug/issues/:identifier/comments/:comment_id", CommentController, :delete)
    post("/projects/:project_slug/evidence/propose", EvidenceConfigController, :propose)
    put("/projects/:project_slug/evidence", EvidenceConfigController, :save)
    get("/projects/:project_slug/issues/:identifier/evidence", EvidenceController, :index)
    delete("/projects/:project_slug/issues/:identifier/evidence", EvidenceController, :clear)
    post("/projects/:project_slug/issues/:identifier/evidence/clear-failed", EvidenceController, :clear_failed)
    delete("/projects/:project_slug/issues/:identifier/evidence/:run_id", EvidenceController, :delete)
    get("/projects/:project_slug/issues/:identifier/commit_evidence", CommitEvidenceController, :index)

    get(
      "/projects/:project_slug/issues/:identifier/commit_evidence/:repo/:sha",
      CommitEvidenceController,
      :show
    )

    get(
      "/projects/:project_slug/issues/:identifier/evidence/:run_id/artifacts/*path",
      EvidenceController,
      :artifact
    )

    get("/projects/:project_slug/issues/:identifier/pull_requests", PullRequestController, :index)
    post("/projects/:project_slug/issues/:identifier/pull_requests/link", PullRequestController, :link)
    delete("/projects/:project_slug/issues/:identifier/pull_requests/link", PullRequestController, :unlink)
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

    post(
      "/projects/:project_slug/issues/:identifier/pull_requests/:number/rerun_failed",
      PullRequestRerunController,
      :create
    )

    get("/projects/:project_slug/issues/:identifier/activity", ActivityController, :index)
    get("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :index)
    post("/projects/:project_slug/issues/:identifier/blockers", BlockerController, :create)
    delete("/projects/:project_slug/issues/:identifier/blockers/:blocker_identifier", BlockerController, :delete)
    post("/projects/:project_slug/issues/:identifier/group", GroupController, :create)
    delete("/projects/:project_slug/issues/:identifier/group", GroupController, :delete)
    post("/projects/:project_slug/issues/:identifier/subtasks", IssueController, :create_subtask)
    post("/projects/:project_slug/issues/:identifier/parent", IssueController, :set_parent)
    delete("/projects/:project_slug/issues/:identifier/parent", IssueController, :clear_parent)
    post("/projects/:project_slug/issues/:identifier/terminal", TerminalController, :create)
    get("/projects/:project_slug/issues/:identifier/dev_servers", DevServerController, :index)
    get("/projects/:project_slug/issues/:identifier/dev_servers/:server_id/output", DevServerController, :output)
    post("/projects/:project_slug/issues/:identifier/dev_servers/start", DevServerController, :start)
    post("/projects/:project_slug/issues/:identifier/dev_servers/stop", DevServerController, :stop)
    post("/projects/:project_slug/issues/:identifier/dev_servers/restart", DevServerController, :restart)
    post("/projects/:project_slug/issues/:identifier/dev_servers/:server_id/start", DevServerController, :start_server)
    post("/projects/:project_slug/issues/:identifier/dev_servers/:server_id/stop", DevServerController, :stop_server)
    post("/projects/:project_slug/issues/:identifier/dev_servers/:server_id/restart", DevServerController, :restart_server)
    post("/tunnel/start", TunnelController, :start)
    get("/projects/:project_slug/editor", EditorController, :show)
    get("/projects/:project_slug/issues/:identifier/editor", EditorController, :show)
    get("/projects/:project_slug/issues/:identifier/files", WorkspaceFileController, :index)
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

    get("/kb/search", KnowledgeBaseController, :search_general)
    post("/kb/connect", KnowledgeBaseController, :general_connect)
    post("/kb/home", KnowledgeBaseController, :general_regenerate_home)
    get("/kb/pages/*path", KnowledgeBaseController, :general_show_page)
    put("/kb/pages/*path", KnowledgeBaseController, :general_save_page)
    get("/kb", KnowledgeBaseController, :general_overview)
    get("/projects/:project_slug/kb/search", KnowledgeBaseController, :search_project)
    get("/projects/:project_slug/kb", KnowledgeBaseController, :project_overview)
    get("/projects/:project_slug/kb/repos/:repo", KnowledgeBaseController, :repo_tree)
    get("/projects/:project_slug/kb/repos/:repo/pages/*path", KnowledgeBaseController, :show_page)
    put("/projects/:project_slug/kb/repos/:repo/pages/*path", KnowledgeBaseController, :save_page)

    delete(
      "/projects/:project_slug/kb/repos/:repo/pages/*path",
      KnowledgeBaseController,
      :delete_page
    )

    delete(
      "/projects/:project_slug/kb/repos/:repo/folders/*path",
      KnowledgeBaseController,
      :delete_folder
    )

    post("/projects/:project_slug/kb/repos/:repo/move", KnowledgeBaseController, :move_page)
    post("/projects/:project_slug/kb/repos/:repo/assets/rename", KnowledgeBaseController, :rename_asset)
    get("/projects/:project_slug/kb/repos/:repo/assets/*path", KnowledgeBaseController, :show_asset)

    delete(
      "/projects/:project_slug/kb/repos/:repo/assets/*path",
      KnowledgeBaseController,
      :delete_asset
    )

    post("/projects/:project_slug/kb/repos/:repo/assets", KnowledgeBaseController, :upload_asset)
    get("/projects/:project_slug/kb/repos/:repo/sync", KnowledgeBaseController, :sync_status)
    post("/projects/:project_slug/kb/repos/:repo/sync", KnowledgeBaseController, :request_sync)
  end

  pipeline :observability_api do
    plug(:accepts, ["json"])
    plug(SymphonyElixirWeb.Plugs.SetLocale)
  end

  scope "/", SymphonyElixirWeb do
    pipe_through(:observability_api)

    get("/api/v1/state", ObservabilityApiController, :state)

    match(:*, "/api/v1/state", ObservabilityApiController, :method_not_allowed)
    post("/api/v1/refresh", ObservabilityApiController, :refresh)
    match(:*, "/api/v1/refresh", ObservabilityApiController, :method_not_allowed)
    get("/api/v1/:issue_identifier", ObservabilityApiController, :issue)
    match(:*, "/api/v1/:issue_identifier", ObservabilityApiController, :method_not_allowed)
    match(:*, "/*path", ObservabilityApiController, :not_found)
  end
end
