defmodule SymphonyElixir.MobileRpc.Methods.CoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.TrackerBridge
  alias SymphonyElixir.MobileRpc.Methods.{Projects, Sessions, System, Tasks}

  defmodule FakeBridge do
    def request(domain, params, context) do
      send(context.test_pid, {:bridge_context, context.host_id, context.device_id})
      {:ok, %{"domain" => Atom.to_string(domain), "path" => params["path"]}}
    end
  end

  test "resolves only allowlisted tracker routes inside their RPC domain" do
    assert {:ok, route} =
             TrackerBridge.resolve(:tasks, %{
               "path" => "/projects/mobile%20app/issues/MOB-7/comments?limit=20",
               "method" => "GET",
               "body" => nil,
               "idempotency_key" => nil
             })

    assert route.controller == SymphonyElixirWeb.Tracker.CommentController
    assert route.action == :index
    assert route.params["project_slug"] == "mobile app"
    assert route.params["identifier"] == "MOB-7"
    assert route.params["limit"] == "20"

    assert {:ok, subtask_route} =
             TrackerBridge.resolve(:tasks, %{
               "path" => "/projects/mobile%20app/issues/MOB-7/subtasks",
               "method" => "POST",
               "body" => %{"title" => "Stream approvals", "status" => "Todo"},
               "idempotency_key" => nil
             })

    assert subtask_route.controller == SymphonyElixirWeb.Tracker.IssueController
    assert subtask_route.action == :create_subtask
    assert subtask_route.params["identifier"] == "MOB-7"

    assert {:error, :route_not_allowed} =
             TrackerBridge.resolve(:tasks, %{
               "path" => "/assistant/threads",
               "method" => "GET",
               "body" => nil,
               "idempotency_key" => nil
             })
  end

  test "rejects absolute URLs, traversal and unsupported request methods" do
    for request <- [
          %{"path" => "https://other.test/projects", "method" => "GET"},
          %{"path" => "/projects/../settings", "method" => "GET"},
          %{"path" => "/projects", "method" => "PUT"}
        ] do
      assert {:error, _reason} = TrackerBridge.resolve(:projects, request)
    end
  end

  test "routes workspace, git, previews, pull requests and notifications explicitly" do
    for {domain, method, path, controller, action} <- [
          {:workspace, "GET", "/assistant/threads/42/files/src/app.ts", SymphonyElixirWeb.Tracker.AssistantThreadFileController, :show},
          {:git, "POST", "/assistant/threads/42/diff/commit", SymphonyElixirWeb.Tracker.WorkspaceDiffController, :commit_thread},
          {:previews, "POST", "/assistant/threads/42/dev_servers/restart", SymphonyElixirWeb.Tracker.DevServerController, :restart_thread},
          {:pull_requests, "POST", "/projects/symphony/issues/SYM-7/pull_requests/12/merge", SymphonyElixirWeb.Tracker.PullRequestMergeController, :create},
          {:notifications, "POST", "/mobile_push/subscriptions", SymphonyElixirWeb.Tracker.MobilePushController, :create}
        ] do
      assert {:ok, route} =
               TrackerBridge.resolve(domain, %{
                 "path" => path,
                 "method" => method,
                 "body" => %{},
                 "idempotency_key" => nil
               })

      assert route.controller == controller
      assert route.action == action
    end
  end

  test "routes multi-repo workspace creation through the projects domain" do
    assert {:ok, route} =
             TrackerBridge.resolve(:projects, %{
               "path" => "/projects/symphony/workspaces",
               "method" => "POST",
               "body" => %{"name" => "mobile-html"},
               "idempotency_key" => "mobile-workspace-1"
             })

    assert route.controller == SymphonyElixirWeb.Tracker.WorktreeInventoryController
    assert route.action == :create_workspace
    assert route.params["project_slug"] == "symphony"
    assert route.params["name"] == "mobile-html"
  end

  test "routes Magic templates and issue file context through tasks" do
    for {method, path, controller, action} <- [
          {"GET", "/projects/symphony/prompt-templates", SymphonyElixirWeb.Tracker.PromptTemplateController, :project_index},
          {"POST", "/projects/symphony/issues/SYM-7/run-prompt-template", SymphonyElixirWeb.Tracker.RunPromptTemplateController, :create},
          {"GET", "/projects/symphony/issues/SYM-7/files?q=app", SymphonyElixirWeb.Tracker.WorkspaceFileController, :index}
        ] do
      assert {:ok, route} =
               TrackerBridge.resolve(:tasks, %{
                 "path" => path,
                 "method" => method,
                 "body" => %{},
                 "idempotency_key" => nil
               })

      assert route.controller == controller
      assert route.action == action
    end
  end

  test "routes the machine-wide assistant catalogue through the sessions domain" do
    assert {:ok, route} =
             TrackerBridge.resolve(:sessions, %{
               "path" => "/assistant/config",
               "method" => "GET",
               "body" => %{},
               "idempotency_key" => nil
             })

    assert route.controller == SymphonyElixirWeb.Tracker.AssistantController
    assert route.action == :config
  end

  test "core methods validate requests and delegate to the selected host bridge" do
    context = %{
      tracker_bridge: FakeBridge,
      test_pid: self(),
      host_id: "host_01",
      device_id: "paired_device_01"
    }

    assert {:ok, %{"domain" => "projects"}} =
             Projects.Request.call(request("/projects"), context)

    assert {:ok, %{"domain" => "tasks"}} =
             Tasks.Request.call(request("/projects/symphony/issues"), context)

    assert {:ok, %{"domain" => "sessions"}} =
             Sessions.Request.call(request("/assistant/threads"), context)

    assert {:ok, %{"domain" => "system"}} =
             System.Tracker.call(request("/viewer"), context)

    assert_receive {:bridge_context, "host_01", "paired_device_01"}
  end

  test "encrypted session commands allow provider-neutral turn and goal controls" do
    for {event, payload} <- [
          {"set_turn_preferences", %{"execution_mode" => "build"}},
          {"set_goal_mode", %{"goal_mode" => true, "objective" => "Ship the health route"}},
          {"goal_status", %{}},
          {"goal_pause", %{}},
          {"goal_resume", %{}},
          {"goal_clear", %{}},
          {"goal_set_objective", %{"objective" => "Capture E2E evidence"}},
          {"kill_tool", %{"tool_call_id" => "call_01"}}
        ] do
      assert {:ok, _params} =
               Sessions.Command.validate(%{
                 "thread_id" => 42,
                 "event" => event,
                 "payload" => payload
               })
    end
  end

  defp request(path) do
    %{
      "path" => path,
      "method" => "GET",
      "body" => nil,
      "idempotency_key" => nil
    }
  end
end
