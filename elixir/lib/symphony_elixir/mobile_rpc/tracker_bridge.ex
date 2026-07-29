defmodule SymphonyElixir.MobileRpc.TrackerBridge do
  @moduledoc """
  Transitional allowlisted bridge from encrypted mobile RPC domains to the
  existing tracker controllers.

  The bridge bypasses HTTP authentication only after the mobile socket has
  completed device authentication inside the encrypted channel. Route matching
  remains explicit so an RPC client cannot turn this into an arbitrary internal
  HTTP request.
  """

  alias SymphonyElixirWeb.Tracker.{
    AssistantController,
    AssistantThreadController,
    AssistantThreadDocumentController,
    AssistantThreadFileController,
    BlockerController,
    CommentController,
    DevServerController,
    IssueController,
    MobilePushController,
    ProjectController,
    ProjectSessionController,
    PullRequestBranchController,
    PullRequestController,
    PullRequestFixController,
    PullRequestMergeController,
    PullRequestRerunController,
    SettingsController,
    ViewerController,
    WorktreeInventoryController,
    WorkspaceDiffController
  }

  @domains [
    :system,
    :projects,
    :tasks,
    :sessions,
    :workspace,
    :git,
    :previews,
    :pull_requests,
    :notifications
  ]
  @methods ~w(GET POST PATCH DELETE)

  @type domain ::
          :system
          | :projects
          | :tasks
          | :sessions
          | :workspace
          | :git
          | :previews
          | :pull_requests
          | :notifications
  @type route :: %{
          controller: module(),
          action: atom(),
          params: map(),
          idempotency_key: String.t() | nil,
          method: String.t(),
          path: String.t()
        }

  @spec request(domain(), map()) :: {:ok, map()} | {:error, term()}
  def request(domain, request), do: request(domain, request, %{})

  @spec request(domain(), map(), map()) :: {:ok, map()} | {:error, term()}
  def request(domain, request, context) do
    with {:ok, route} <- resolve(domain, request),
         {:ok, conn} <- invoke(route, context),
         {:ok, payload} <- decode_response(conn) do
      {:ok, payload}
    end
  end

  @spec resolve(domain(), map()) :: {:ok, route()} | {:error, term()}
  def resolve(domain, request) when domain in @domains and is_map(request) do
    with {:ok, method} <- method(request["method"]),
         {:ok, uri, segments} <- local_uri(request["path"]),
         {:ok, body} <- body(request["body"]),
         {:ok, idempotency_key} <- idempotency_key(request["idempotency_key"]),
         {:ok, controller, action, path_params} <- route(domain, method, segments),
         {:ok, query} <- query_params(uri.query) do
      {:ok,
       %{
         controller: controller,
         action: action,
         params: query |> Map.merge(body) |> Map.merge(path_params),
         idempotency_key: idempotency_key,
         method: method,
         path: uri.path
       }}
    end
  end

  def resolve(_domain, _request), do: {:error, :invalid_request}

  defp invoke(route, context) do
    conn =
      route.method
      |> Plug.Test.conn(route.path)
      |> Plug.Conn.put_private(:phoenix_endpoint, SymphonyElixirWeb.Endpoint)
      |> Plug.Conn.put_private(:phoenix_format, "json")
      |> Plug.Conn.put_req_header("accept", "application/json")
      |> Plug.Conn.assign(:mobile_rpc_context, context)
      |> maybe_put_idempotency_key(route.idempotency_key)

    {:ok, apply(route.controller, route.action, [conn, route.params])}
  rescue
    _error -> {:error, :request_failed}
  end

  defp decode_response(%Plug.Conn{status: status, resp_body: body})
       when status in 200..299 do
    case IO.iodata_to_binary(body || "") do
      "" -> {:ok, %{"data" => nil}}
      encoded -> Jason.decode(encoded)
    end
  end

  defp decode_response(%Plug.Conn{status: status, resp_body: body}) do
    payload =
      case Jason.decode(IO.iodata_to_binary(body || "")) do
        {:ok, decoded} -> decoded
        _ -> %{}
      end

    {:error, {:tracker_request_failed, status, error_message(payload)}}
  end

  defp route(:system, "GET", ["viewer"]),
    do: {:ok, ViewerController, :show, %{}}

  defp route(:system, "GET", ["settings", "agents", "availability"]),
    do: {:ok, SettingsController, :availability, %{}}

  defp route(:system, "GET", ["settings", "agents", "usage"]),
    do: {:ok, SettingsController, :usage, %{}}

  defp route(:projects, "GET", ["projects"]),
    do: {:ok, ProjectController, :index, %{}}

  defp route(:projects, "POST", ["projects", project_slug, "workspaces"]),
    do: {:ok, WorktreeInventoryController, :create_workspace, %{"project_slug" => project_slug}}

  defp route(:sessions, "GET", ["assistant", "threads"]),
    do: {:ok, AssistantThreadController, :index, %{}}

  defp route(:sessions, "POST", ["assistant", "threads"]),
    do: {:ok, AssistantThreadController, :create, %{}}

  defp route(:sessions, "GET", ["assistant", "config"]),
    do: {:ok, AssistantController, :config, %{}}

  defp route(:sessions, "GET", ["projects", project_slug, "sessions"]),
    do: {:ok, ProjectSessionController, :index, %{"project_slug" => project_slug}}

  defp route(:sessions, "GET", ["projects", project_slug, "assistant", "config"]),
    do: {:ok, AssistantController, :config, %{"project_slug" => project_slug}}

  defp route(:tasks, "GET", ["projects", project_slug, "issues"]),
    do: {:ok, IssueController, :index, %{"project_slug" => project_slug}}

  defp route(:tasks, "POST", ["projects", project_slug, "issues"]),
    do: {:ok, IssueController, :create, %{"project_slug" => project_slug}}

  defp route(:tasks, "GET", ["projects", project_slug, "issues", "form_options"]),
    do: {:ok, IssueController, :form_options, %{"project_slug" => project_slug}}

  defp route(:tasks, "GET", ["projects", project_slug, "issues", identifier]),
    do: {:ok, IssueController, :show, %{"project_slug" => project_slug, "id" => identifier}}

  defp route(:tasks, "PATCH", ["projects", project_slug, "issues", identifier]),
    do: {:ok, IssueController, :update, %{"project_slug" => project_slug, "id" => identifier}}

  defp route(
         :tasks,
         method,
         ["projects", project_slug, "issues", identifier, "comments"]
       )
       when method in ["GET", "POST"] do
    action = if method == "GET", do: :index, else: :create

    {:ok, CommentController, action, %{"project_slug" => project_slug, "identifier" => identifier}}
  end

  defp route(:tasks, "GET", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "blockers"
       ]),
       do: {:ok, BlockerController, :index, %{"project_slug" => project_slug, "identifier" => identifier}}

  defp route(:tasks, method, [
         "projects",
         project_slug,
         "issues",
         identifier,
         "subtasks"
       ])
       when method in ["GET", "POST"] do
    action = if method == "GET", do: :subtasks, else: :create_subtask

    {:ok, IssueController, action, %{"project_slug" => project_slug, "identifier" => identifier}}
  end

  defp route(:tasks, "POST", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "dispatch"
       ]),
       do: {:ok, IssueController, :dispatch_agent, %{"project_slug" => project_slug, "identifier" => identifier}}

  defp route(:tasks, "POST", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "goal"
       ]),
       do: {:ok, IssueController, :goal_control, %{"project_slug" => project_slug, "identifier" => identifier}}

  defp route(:workspace, "GET", ["assistant", "threads", thread_id, "documents"]),
    do: {:ok, AssistantThreadDocumentController, :index, %{"thread_id" => thread_id}}

  defp route(:workspace, "GET", ["assistant", "threads", thread_id, "documents" | path]),
    do: {:ok, AssistantThreadDocumentController, :show, %{"thread_id" => thread_id, "path" => path}}

  defp route(:workspace, "GET", ["assistant", "threads", thread_id, "files"]),
    do: {:ok, AssistantThreadFileController, :index, %{"thread_id" => thread_id}}

  defp route(:workspace, "GET", ["assistant", "threads", thread_id, "files" | path]),
    do: {:ok, AssistantThreadFileController, :show, %{"thread_id" => thread_id, "path" => path}}

  defp route(:git, "GET", ["assistant", "threads", thread_id, "diff", "stats"]),
    do: {:ok, WorkspaceDiffController, :stats_thread, %{"thread_id" => thread_id}}

  defp route(:git, "GET", ["assistant", "threads", thread_id, "diff", "files"]),
    do: {:ok, WorkspaceDiffController, :files_thread, %{"thread_id" => thread_id}}

  defp route(:git, "GET", ["assistant", "threads", thread_id, "diff", "patch"]),
    do: {:ok, WorkspaceDiffController, :file_patch_thread, %{"thread_id" => thread_id}}

  defp route(:git, "POST", ["assistant", "threads", thread_id, "diff", "commit"]),
    do: {:ok, WorkspaceDiffController, :commit_thread, %{"thread_id" => thread_id}}

  defp route(:git, "POST", ["assistant", "threads", thread_id, "diff", "push"]),
    do: {:ok, WorkspaceDiffController, :push_thread, %{"thread_id" => thread_id}}

  defp route(:previews, "GET", ["assistant", "threads", thread_id, "dev_servers"]),
    do: {:ok, DevServerController, :index_thread, %{"thread_id" => thread_id}}

  defp route(:previews, "POST", [
         "assistant",
         "threads",
         thread_id,
         "dev_servers",
         "start"
       ]),
       do: {:ok, DevServerController, :start_thread, %{"thread_id" => thread_id}}

  defp route(:previews, "POST", [
         "assistant",
         "threads",
         thread_id,
         "dev_servers",
         "restart"
       ]),
       do: {:ok, DevServerController, :restart_thread, %{"thread_id" => thread_id}}

  defp route(:pull_requests, "GET", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "pull_requests"
       ]),
       do: {:ok, PullRequestController, :index, %{"project_slug" => project_slug, "identifier" => identifier}}

  defp route(:pull_requests, method, [
         "projects",
         project_slug,
         "issues",
         identifier,
         "pull_requests",
         "link"
       ])
       when method in ["POST", "DELETE"] do
    action = if method == "POST", do: :link, else: :unlink

    {:ok, PullRequestController, action, %{"project_slug" => project_slug, "identifier" => identifier}}
  end

  defp route(:pull_requests, "POST", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "pull_requests",
         "fix"
       ]),
       do: {:ok, PullRequestFixController, :create, %{"project_slug" => project_slug, "identifier" => identifier}}

  defp route(:pull_requests, "POST", [
         "projects",
         project_slug,
         "issues",
         identifier,
         "pull_requests",
         number,
         action
       ])
       when action in ["update_branch", "rerun_failed", "merge"] do
    {controller, controller_action} =
      case action do
        "update_branch" -> {PullRequestBranchController, :update}
        "rerun_failed" -> {PullRequestRerunController, :create}
        "merge" -> {PullRequestMergeController, :create}
      end

    {:ok, controller, controller_action, %{"project_slug" => project_slug, "identifier" => identifier, "number" => number}}
  end

  defp route(:notifications, method, ["mobile_push", "subscriptions"])
       when method in ["POST", "DELETE"] do
    action = if method == "POST", do: :create, else: :delete
    {:ok, MobilePushController, action, %{}}
  end

  defp route(:notifications, "POST", ["mobile_push", "test"]),
    do: {:ok, MobilePushController, :test, %{}}

  defp route(_domain, _method, _segments), do: {:error, :route_not_allowed}

  defp local_uri(path) when is_binary(path) and byte_size(path) in 1..2_048 do
    uri = URI.parse(path)

    with nil <- uri.scheme,
         nil <- uri.host,
         nil <- uri.fragment,
         true <- is_binary(uri.path) and String.starts_with?(uri.path, "/"),
         {:ok, segments} <- decode_segments(uri.path),
         false <- Enum.any?(segments, &(&1 in [".", ".."])) do
      {:ok, uri, segments}
    else
      _ -> {:error, :invalid_path}
    end
  end

  defp local_uri(_path), do: {:error, :invalid_path}

  defp decode_segments(path) do
    {:ok,
     path
     |> String.split("/", trim: true)
     |> Enum.map(&URI.decode/1)}
  rescue
    _error -> {:error, :invalid_path}
  end

  defp query_params(nil), do: {:ok, %{}}

  defp query_params(query) when is_binary(query) do
    {:ok, URI.decode_query(query)}
  rescue
    _error -> {:error, :invalid_query}
  end

  defp body(nil), do: {:ok, %{}}
  defp body(value) when is_map(value), do: {:ok, value}
  defp body(_value), do: {:error, :invalid_body}

  defp method(value) when value in @methods, do: {:ok, value}
  defp method(nil), do: {:ok, "GET"}
  defp method(_value), do: {:error, :invalid_method}

  defp idempotency_key(nil), do: {:ok, nil}

  defp idempotency_key(value) when is_binary(value) and byte_size(value) in 1..128,
    do: {:ok, value}

  defp idempotency_key(_value), do: {:error, :invalid_idempotency_key}

  defp maybe_put_idempotency_key(conn, nil), do: conn

  defp maybe_put_idempotency_key(conn, value),
    do: Plug.Conn.put_req_header(conn, "idempotency-key", value)

  defp error_message(%{"error" => %{"message" => message}}) when is_binary(message),
    do: message

  defp error_message(_payload), do: "Tracker request failed"
end
