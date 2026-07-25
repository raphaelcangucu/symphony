defmodule SymphonyElixirWeb.Tracker.AssistantThreadPathOwnershipInventory do
  @moduledoc false

  @spec scan(String.t()) :: {:ok, map()} | {:error, term()}
  def scan(_project_slug) do
    Application.fetch_env!(:symphony_elixir, :assistant_thread_path_ownership_scan_result)
  end
end

defmodule SymphonyElixirWeb.Tracker.AssistantThreadControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.{AgentSession, History, ProjectExploreWorkspace, Thread}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow
  alias SymphonyElixirWeb.Tracker.AssistantThreadController

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @inventory_module_env :workspace_display_name_inventory_module
  @scan_result_env :assistant_thread_path_ownership_scan_result

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_threads()

    previous_token = System.get_env(@token_env)
    previous_inventory_module = Application.get_env(:symphony_elixir, @inventory_module_env)
    previous_native_name_setter = Application.get_env(:symphony_elixir, :native_thread_name_setter)
    System.put_env(@token_env, "secret")

    tmp = Path.join(System.tmp_dir!(), "assistant-thread-controller-#{System.unique_integer([:positive])}")
    workspace_root = Path.join(tmp, "workspaces")
    File.mkdir_p!(workspace_root)
    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      restore_inventory_module(previous_inventory_module)
      Application.delete_env(:symphony_elixir, @scan_result_env)
      Application.delete_env(:symphony_elixir, :workflow_file_path)

      if previous_native_name_setter,
        do: Application.put_env(:symphony_elixir, :native_thread_name_setter, previous_native_name_setter),
        else: Application.delete_env(:symphony_elixir, :native_thread_name_setter)

      File.rm_rf(tmp)
    end)

    {:ok, tmp: tmp, workspace_root: workspace_root}
  end

  test "POST creates a freeform thread" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "freeform", title: "Ideas"})

    assert %{"data" => %{"scope" => "freeform", "title" => "Ideas", "project_slug" => nil, "id" => _}} =
             json_response(conn, 201)
  end

  test "POST freeform thread persists agent_kind and model/effort metadata" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "freeform",
        title: "Ops",
        agent_kind: "cursor",
        model: "gpt-5",
        effort: "high"
      })

    assert %{
             "data" => %{
               "id" => id,
               "scope" => "freeform",
               "agent_kind" => "cursor"
             }
           } = json_response(conn, 201)

    assert {:ok, thread} = History.get_thread(id)
    assert thread.agent_kind == "cursor"
    assert thread.metadata["model"] == "gpt-5"
    assert thread.metadata["effort"] == "high"
  end

  test "POST freeform thread stores a per-thread workspace path, not the shared root" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "freeform", title: "Scoped"})

    assert %{"data" => %{"id" => id}} = json_response(conn, 201)

    {:ok, thread} = History.get_thread(id)

    assert thread.workspace_path == AgentSession.freeform_workspace(id)
    refute thread.workspace_path == AgentSession.freeform_workspace_root()
  end

  test "GET lists freeform threads" do
    {:ok, _} = History.create_freeform_thread(%{title: "A", workspace_path: System.tmp_dir!()})

    conn = get(authorize(), "/api/tracker/v1/assistant/threads?scope=freeform")

    assert %{"data" => [%{"scope" => "freeform"} | _]} = json_response(conn, 200)
  end

  test "GET editor returns browser and Cursor targets for the thread workspace", ctx do
    workspace_path = Path.join(ctx.tmp, "editor-workspace")
    File.mkdir_p!(workspace_path)

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Editor",
        workspace_path: workspace_path
      })

    previous_enabled = Application.get_env(:symphony_elixir, :editor_enabled)
    previous_base_url = Application.get_env(:symphony_elixir, :editor_base_url)
    previous_status_fun = Application.get_env(:symphony_elixir, :editor_status_fun)
    previous_wsl = System.get_env("WSL_DISTRO_NAME")

    Application.put_env(:symphony_elixir, :editor_enabled, true)
    Application.put_env(:symphony_elixir, :editor_base_url, "https://editor.example.com")
    Application.put_env(:symphony_elixir, :editor_status_fun, fn -> :ready end)
    System.delete_env("WSL_DISTRO_NAME")

    on_exit(fn ->
      restore_application_env(:editor_enabled, previous_enabled)
      restore_application_env(:editor_base_url, previous_base_url)
      restore_application_env(:editor_status_fun, previous_status_fun)
      restore_env("WSL_DISTRO_NAME", previous_wsl)
    end)

    conn = get(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}/editor")

    expected_browser_url =
      "https://editor.example.com/?folder=" <> URI.encode_www_form(workspace_path)

    expected_cursor_url = "cursor://file/" <> URI.encode(Path.expand(workspace_path))

    assert %{
             "data" => %{
               "available" => true,
               "url" => ^expected_browser_url,
               "reason" => nil,
               "cursor_desktop" => %{
                 "available" => true,
                 "url" => ^expected_cursor_url,
                 "reason" => nil
               }
             }
           } = json_response(conn, 200)
  end

  test "GET editor returns workspace_missing when the thread workspace path is empty" do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Missing editor workspace",
        workspace_path: System.tmp_dir!()
      })

    Ecto.Adapters.SQL.query!(
      Repo,
      "UPDATE assistant_threads SET workspace_path = '' WHERE id = ?",
      [thread.id]
    )

    conn = get(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}/editor")

    assert %{
             "data" => %{
               "available" => false,
               "url" => nil,
               "reason" => "workspace_missing",
               "cursor_desktop" => %{
                 "available" => false,
                 "url" => nil,
                 "reason" => "workspace_missing"
               }
             }
           } = json_response(conn, 200)
  end

  test "GET editor rejects an invalid thread id" do
    conn = get(authorize(), "/api/tracker/v1/assistant/threads/not-an-id/editor")

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "GET editor returns thread_not_found for a missing thread" do
    conn = get(authorize(), "/api/tracker/v1/assistant/threads/2147483647/editor")

    assert %{"error" => %{"code" => "thread_not_found"}} = json_response(conn, 404)
  end

  test "POST archive hides thread from list" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Old", workspace_path: System.tmp_dir!()})
    id = thread.id

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads/#{id}/archive")

    assert %{"data" => %{"id" => ^id, "status" => "archived"}} = json_response(conn, 200)
    refute Enum.any?(History.list_threads(scope: "freeform"), &(&1.id == id))
  end

  test "PATCH updates title labels and review state" do
    workspace_path = Path.join(System.tmp_dir!(), "assistant-thread-update")
    {:ok, thread} = History.create_freeform_thread(%{title: "Old", workspace_path: workspace_path})
    {:ok, thread} = History.put_agent_thread_id(thread, "codex", "native-thread-update")
    test_pid = self()

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn workspace, thread_id, name, _opts ->
      send(test_pid, {:native_name_set, workspace, thread_id, name})
      :ok
    end)

    conn =
      authorize()
      |> patch("/api/tracker/v1/assistant/threads/#{thread.id}", %{
        title: "  New title  ",
        labels: [" idea ", "idea", "wip"],
        needs_review: true
      })

    assert %{
             "data" => %{
               "id" => id,
               "title" => "New title",
               "workspace_path" => ^workspace_path,
               "labels" => ["idea", "wip"],
               "needs_review" => true
             }
           } = json_response(conn, 200)

    assert id == thread.id
    assert_receive {:native_name_set, ^workspace_path, "native-thread-update", "New title"}
  end

  test "PATCH updates agent_kind on an assistant thread" do
    workspace_path = Path.join(System.tmp_dir!(), "assistant-thread-agent-kind")
    {:ok, thread} = History.create_freeform_thread(%{title: "Agent", workspace_path: workspace_path, agent_kind: "codex"})

    conn =
      authorize()
      |> patch("/api/tracker/v1/assistant/threads/#{thread.id}", %{agent_kind: "cursor"})

    assert %{
             "data" => %{
               "id" => id,
               "agent_kind" => "cursor"
             }
           } = json_response(conn, 200)

    assert id == thread.id
    assert {:ok, reloaded} = History.get_thread(thread.id)
    assert reloaded.agent_kind == "cursor"
  end

  test "PATCH rejects an invalid agent_kind" do
    {:ok, thread} =
      History.create_freeform_thread(%{title: "Agent", workspace_path: System.tmp_dir!(), agent_kind: "codex"})

    conn =
      authorize()
      |> patch("/api/tracker/v1/assistant/threads/#{thread.id}", %{agent_kind: "not-an-agent"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
    assert {:ok, reloaded} = History.get_thread(thread.id)
    assert reloaded.agent_kind == "codex"
  end

  test "GET with include_archived=true includes archived threads" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Archived", workspace_path: System.tmp_dir!()})
    {:ok, _archived} = History.archive_thread(thread.id)

    conn = get(authorize(), "/api/tracker/v1/assistant/threads?scope=freeform&include_archived=true")

    assert %{"data" => rows} = json_response(conn, 200)
    assert Enum.any?(rows, &(&1["id"] == thread.id and &1["status"] == "archived"))
  end

  test "GET excludes archived threads unless include_archived is strictly true" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Archived", workspace_path: System.tmp_dir!()})
    {:ok, _archived} = History.archive_thread(thread.id)

    excluded_params = [
      %{"scope" => "freeform"},
      %{"scope" => "freeform", "include_archived" => false},
      %{"scope" => "freeform", "include_archived" => "false"},
      %{"scope" => "freeform", "include_archived" => "anything"}
    ]

    for params <- excluded_params do
      refute thread.id in index_thread_ids(params)
    end

    assert thread.id in index_thread_ids(%{"scope" => "freeform", "include_archived" => true})
    assert thread.id in index_thread_ids(%{"scope" => "freeform", "include_archived" => "true"})
  end

  test "DELETE removes an archived eligible local thread" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Delete", workspace_path: System.tmp_dir!()})
    {:ok, _archived} = History.archive_thread(thread.id)

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "PATCH rejects a blank title" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Keep", workspace_path: System.tmp_dir!()})

    conn = patch(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}", %{title: "   "})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "POST generate_title persists an LLM title from the injected runner" do
    previous_runner = Application.get_env(:symphony_elixir, :title_generator_runner)

    Application.put_env(:symphony_elixir, :title_generator_runner, fn _workspace, _prompt, _issue, _opts ->
      {:ok, %{assistant_message: "Title: Cleanup goapi GAM-19"}}
    end)

    on_exit(fn ->
      if previous_runner,
        do: Application.put_env(:symphony_elixir, :title_generator_runner, previous_runner),
        else: Application.delete_env(:symphony_elixir, :title_generator_runner)
    end)

    {:ok, thread} =
      History.create_freeform_thread(%{title: "Project session", workspace_path: System.tmp_dir!()})

    {:ok, thread} = History.put_agent_thread_id(thread, "codex", "native-thread-generated")
    test_pid = self()

    Application.put_env(:symphony_elixir, :native_thread_name_setter, fn workspace, thread_id, name, _opts ->
      send(test_pid, {:native_name_set, workspace, thread_id, name})
      :ok
    end)

    {:ok, _} = History.append_message(thread, %{role: "user", content: "cleanup goapi"})
    {:ok, _} = History.append_message(thread, %{role: "assistant", content: "Sure, drafting a plan."})

    conn = post(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}/generate_title", %{})

    assert %{"data" => %{"id" => id, "title" => "Cleanup goapi GAM-19"}} = json_response(conn, 200)
    assert id == thread.id
    assert_receive {:native_name_set, _, "native-thread-generated", "Cleanup goapi GAM-19"}
  end

  test "POST generate_title returns not_enough_context without an exchange" do
    {:ok, thread} =
      History.create_freeform_thread(%{title: "Project session", workspace_path: System.tmp_dir!()})

    conn = post(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}/generate_title", %{})

    assert %{"error" => %{"code" => "not_enough_context"}} = json_response(conn, 422)
  end

  test "PATCH rejects invalid labels" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Keep", workspace_path: System.tmp_dir!()})

    conn = patch(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}", %{labels: "idea"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PATCH rejects invalid needs_review without crashing" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Keep", workspace_path: System.tmp_dir!()})

    conn = patch(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}", %{needs_review: "true"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "DELETE removes an active eligible local thread" do
    {:ok, thread} = History.create_freeform_thread(%{title: "Active", workspace_path: System.tmp_dir!()})

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "DELETE removes an active issue-scoped thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete Issue", slug: "delete-issue"})
    {:ok, thread} = History.promote_project_thread_to_issue("delete-issue", "CDE-1", %{workspace_path: "/tmp/delete-issue"})

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "DELETE removes an active project_explore thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete Explore", slug: "delete-explore-api"})

    {:ok, thread} =
      History.ensure_project_explore_thread("delete-explore-api", %{workspace_path: "/tmp/delete-explore-api"})

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "DELETE removes an active kb thread" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete KB", slug: "delete-kb-api"})
    {:ok, thread} = History.ensure_kb_thread("delete-kb-api", "delete-kb-api", "SETTINGS.md", %{})

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "DELETE removes an active issue_execution thread" do
    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "issue_execution",
        project_slug: "delete-exec-api",
        issue_identifier: "CDE-DEL-API-1",
        workspace_path: "/tmp/delete-exec-api",
        status: "active",
        title: "Run · CDE-DEL-API-1"
      })
      |> Repo.insert()

    conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{thread.id}")

    assert response(conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(thread.id)
  end

  test "PATCH rejects an invalid thread id" do
    conn = patch(authorize(), "/api/tracker/v1/assistant/threads/not-an-id", %{title: "Nope"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PATCH maps a missing thread through tracker errors" do
    conn = patch(authorize(), "/api/tracker/v1/assistant/threads/2147483647", %{title: "Missing"})

    assert %{"error" => %{"code" => "thread_not_found"}} = json_response(conn, 404)
  end

  test "DELETE maps not-found and invalid thread ids through tracker errors" do
    not_found_conn = delete(authorize(), "/api/tracker/v1/assistant/threads/2147483647")
    invalid_id_conn = delete(authorize(), "/api/tracker/v1/assistant/threads/not-an-id")

    assert %{"error" => %{"code" => "thread_not_found"}} = json_response(not_found_conn, 404)
    assert %{"error" => %{"code" => "validation_failed"}} = json_response(invalid_id_conn, 422)
  end

  test "DELETE removes legacy project-scoped threads and errored freeform threads" do
    {:ok, _project} = Context.ensure_project(%{name: "Delete Mapping", slug: "delete-mapping"})
    {:ok, project_thread} = History.ensure_thread("delete-mapping", %{workspace_path: "/tmp/delete-mapping"})
    {:ok, archived_project_thread} = History.archive_thread(project_thread.id)

    project_delete_conn =
      delete(authorize(), "/api/tracker/v1/assistant/threads/#{archived_project_thread.id}")

    {:ok, freeform_thread} =
      History.create_freeform_thread(%{title: "Errored", workspace_path: "/tmp/delete-status-mapping"})

    {:ok, errored_thread} = History.update_thread(freeform_thread, %{status: "error"})
    errored_delete_conn = delete(authorize(), "/api/tracker/v1/assistant/threads/#{errored_thread.id}")

    assert response(project_delete_conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(archived_project_thread.id)
    assert response(errored_delete_conn, 204) == ""
    assert {:error, :not_found} = History.get_thread(errored_thread.id)
  end

  test "POST with unsupported scope returns 422" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{scope: "project"})

    assert %{"error" => %{"message" => _}} = json_response(conn, 422)
  end

  test "POST creates a project_session pinned to an owned standalone workspace", ctx do
    workspace_path = owned_workspace!(ctx, "explicit-project", :standalone)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "project_session",
        project_slug: "explicit-project",
        workspace_path: "  #{workspace_path}  ",
        title: "Standalone follow-up",
        agent_kind: "cursor"
      })

    assert %{
             "data" => %{
               "id" => id,
               "scope" => "project_session",
               "project_slug" => "explicit-project",
               "workspace_path" => ^workspace_path,
               "title" => "Standalone follow-up",
               "agent_kind" => "cursor"
             }
           } = json_response(conn, 201)

    assert {:ok, %{workspace_path: ^workspace_path}} = History.get_thread(id)
  end

  test "POST legacy project_session uses the explore workspace without inventory ownership", _ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Legacy Project", slug: "legacy-project"})
    use_inventory_error(:ownership_must_not_be_called)
    expected_path = ProjectExploreWorkspace.path("legacy-project")

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "project_session",
        project_slug: "legacy-project",
        title: "Legacy session"
      })

    assert %{
             "data" => %{
               "id" => id,
               "scope" => "project_session",
               "project_slug" => "legacy-project",
               "workspace_path" => ^expected_path
             }
           } = json_response(conn, 201)

    assert expected_path != ""
    assert {:ok, %{scope: "project_session", workspace_path: ^expected_path}} = History.get_thread(id)
  end

  test "POST creates issue_session threads pinned to canonical and parallel issue workspaces", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Issue Paths", slug: "issue-paths"})
    {:ok, issue} = Context.create_issue("issue-paths", %{"title" => "Pinned issue", "status" => "Todo"})

    canonical_path = Path.join([ctx.workspace_root, "issue-paths", issue.identifier])
    parallel_path = canonical_path <> "__p1"
    File.mkdir_p!(canonical_path)
    File.mkdir_p!(parallel_path)

    use_inventory([
      inventory_entry(canonical_path, :issue, issue.identifier),
      inventory_entry(parallel_path, :issue_parallel, issue.identifier)
    ])

    for {workspace_path, title, agent_kind, workspace_kind} <- [
          {canonical_path, "Canonical pass", "claude", "shared"},
          {parallel_path, "Parallel pass", "cursor", "isolated"}
        ] do
      conn =
        authorize()
        |> post("/api/tracker/v1/assistant/threads", %{
          scope: "issue_session",
          project_slug: "issue-paths",
          issue_identifier: issue.identifier,
          workspace_path: workspace_path,
          title: title,
          agent_kind: agent_kind,
          execution_mode: "plan"
        })

      assert %{
               "data" => %{
                 "id" => id,
                 "scope" => "issue_session",
                 "issue_identifier" => issue_identifier,
                 "workspace_path" => ^workspace_path,
                 "title" => ^title,
                 "agent_kind" => ^agent_kind
               }
             } = json_response(conn, 201)

      assert issue_identifier == issue.identifier
      assert {:ok, thread} = History.get_thread(id)
      assert thread.issue_identifier == issue.identifier
      assert History.thread_execution_mode(thread) == "plan"
      assert thread.metadata["workspace_kind"] == workspace_kind
    end
  end

  test "POST rejects an issue workspace owned by another issue", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Mismatch", slug: "mismatch"})
    {:ok, requested_issue} = Context.create_issue("mismatch", %{"title" => "Requested", "status" => "Todo"})
    {:ok, owner_issue} = Context.create_issue("mismatch", %{"title" => "Owner", "status" => "Todo"})
    workspace_path = Path.join([ctx.workspace_root, "mismatch", owner_issue.identifier])
    File.mkdir_p!(workspace_path)
    use_inventory([inventory_entry(workspace_path, :issue, owner_issue.identifier)])

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "mismatch",
        issue_identifier: requested_issue.identifier,
        workspace_path: workspace_path
      })

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "POST explicit issue_session requires issue_identifier", ctx do
    workspace_path = owned_workspace!(ctx, "missing-identifier", :issue)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "missing-identifier",
        workspace_path: workspace_path
      })

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "POST explicit issue_session rejects project and standalone workspace kinds", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Wrong Kinds", slug: "wrong-kinds"})
    {:ok, issue} = Context.create_issue("wrong-kinds", %{"title" => "Requested", "status" => "Todo"})

    for kind <- [:project, :standalone] do
      workspace_path = Path.join([ctx.workspace_root, "wrong-kinds", "#{kind}"])
      File.mkdir_p!(workspace_path)
      use_inventory([inventory_entry(workspace_path, kind, nil)])

      conn =
        authorize()
        |> post("/api/tracker/v1/assistant/threads", %{
          scope: "issue_session",
          project_slug: "wrong-kinds",
          issue_identifier: issue.identifier,
          workspace_path: workspace_path
        })

      assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
    end
  end

  test "POST explicit issue_session rejects a child-worktree-only path", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Child Path", slug: "child-path"})
    {:ok, issue} = Context.create_issue("child-path", %{"title" => "Requested", "status" => "Todo"})
    workspace_path = Path.join([ctx.workspace_root, "child-path", issue.identifier])
    child_path = Path.join(workspace_path, ".worktrees/child")
    File.mkdir_p!(child_path)

    parent_entry =
      inventory_entry(workspace_path, :issue, issue.identifier)
      |> Map.put(:child_worktrees, [%{path: child_path, repo_name: "app", slug: "child"}])

    use_inventory([parent_entry])

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "child-path",
        issue_identifier: issue.identifier,
        workspace_path: child_path
      })

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "POST explicit issue_session rejects invalid and non-owned paths", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Invalid Issue Paths", slug: "invalid-issue-paths"})

    {:ok, issue} =
      Context.create_issue("invalid-issue-paths", %{"title" => "Requested", "status" => "Todo"})

    owned_path = Path.join([ctx.workspace_root, "invalid-issue-paths", issue.identifier])
    File.mkdir_p!(owned_path)
    use_inventory([inventory_entry(owned_path, :issue, issue.identifier)])

    for workspace_path <- ["relative/path", owned_path <> <<0>>, Path.join(ctx.tmp, "outside-issue")] do
      conn =
        authorize()
        |> post("/api/tracker/v1/assistant/threads", %{
          scope: "issue_session",
          project_slug: "invalid-issue-paths",
          issue_identifier: issue.identifier,
          workspace_path: workspace_path
        })

      assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
    end
  end

  test "POST explicit issue_session maps inventory failures to 500", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Issue Inventory Error", slug: "issue-inventory-error"})

    {:ok, issue} =
      Context.create_issue("issue-inventory-error", %{"title" => "Requested", "status" => "Todo"})

    workspace_path = Path.join([ctx.workspace_root, "issue-inventory-error", issue.identifier])
    File.mkdir_p!(workspace_path)
    use_inventory_error(:scan_failed)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "issue-inventory-error",
        issue_identifier: issue.identifier,
        workspace_path: workspace_path
      })

    assert %{"error" => %{"code" => "request_failed"}} = json_response(conn, 500)
  end

  test "POST rejects invalid and non-owned explicit workspace paths", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Invalid Paths", slug: "invalid-paths"})
    owned_path = Path.join([ctx.workspace_root, "invalid-paths", "__ws_owned"])
    File.mkdir_p!(owned_path)
    use_inventory([inventory_entry(owned_path, :standalone, nil)])

    for workspace_path <- ["relative/path", owned_path <> <<0>>, Path.join(ctx.tmp, "outside")] do
      conn =
        authorize()
        |> post("/api/tracker/v1/assistant/threads", %{
          scope: "project_session",
          project_slug: "invalid-paths",
          workspace_path: workspace_path
        })

      assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
    end
  end

  test "POST explicit workspace paths preserve missing project and issue conventions", ctx do
    missing_project_path = Path.join([ctx.workspace_root, "missing-project", "__ws_path"])
    File.mkdir_p!(missing_project_path)
    use_inventory([inventory_entry(missing_project_path, :standalone, nil)])

    project_conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "project_session",
        project_slug: "missing-project",
        workspace_path: missing_project_path
      })

    assert %{"error" => %{"code" => "project_not_found"}} = json_response(project_conn, 404)

    {:ok, _project} = Context.ensure_project(%{name: "Missing Issue", slug: "missing-issue"})

    {:ok, deleted_issue} =
      Context.create_issue("missing-issue", %{"title" => "Deleted issue", "status" => "Todo"})

    missing_issue_path = Path.join([ctx.workspace_root, "missing-issue", deleted_issue.identifier])
    File.mkdir_p!(missing_issue_path)
    use_inventory([inventory_entry(missing_issue_path, :issue, deleted_issue.identifier)])
    {:ok, _deleted} = Context.delete_issue("missing-issue", deleted_issue.identifier)

    issue_conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "missing-issue",
        issue_identifier: deleted_issue.identifier,
        workspace_path: missing_issue_path
      })

    assert %{"error" => %{"code" => "issue_not_found"}} = json_response(issue_conn, 404)
  end

  test "POST maps explicit workspace inventory failures to 500", ctx do
    {:ok, _project} = Context.ensure_project(%{name: "Inventory Error", slug: "inventory-error"})
    workspace_path = Path.join([ctx.workspace_root, "inventory-error", "__ws_path"])
    File.mkdir_p!(workspace_path)
    use_inventory_error(:scan_failed)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "project_session",
        project_slug: "inventory-error",
        workspace_path: workspace_path
      })

    assert %{"error" => %{"code" => "request_failed"}} = json_response(conn, 500)
  end

  test "POST freeform rejects workspace_path" do
    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "freeform",
        title: "Unsafe",
        workspace_path: "/tmp/client-selected"
      })

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "POST creates multiple issue_session threads for the same issue" do
    {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})

    conn_one =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "macro-markets",
        issue_identifier: "MAC-510",
        title: "Build pass 1",
        execution_mode: "build"
      })

    assert %{"data" => %{"id" => id_one, "scope" => "issue_session", "issue_identifier" => "MAC-510"}} =
             json_response(conn_one, 201)

    conn_two =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "macro-markets",
        issue_identifier: "MAC-510",
        title: "Build pass 2",
        execution_mode: "build"
      })

    assert %{"data" => %{"id" => id_two}} = json_response(conn_two, 201)
    assert id_two != id_one

    conn =
      authorize()
      |> get("/api/tracker/v1/assistant/threads?project_slug=macro-markets&issue_identifier=MAC-510&scopes=issue_session")

    assert %{"data" => rows} = json_response(conn, 200)
    assert length(rows) == 2
    assert Enum.all?(rows, &(&1["scope"] == "issue_session"))
  end

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp index_thread_ids(params) do
    conn = AssistantThreadController.index(authorize(), params)
    %{"data" => rows} = json_response(conn, 200)
    Enum.map(rows, & &1["id"])
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_threads do
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM assistant_messages", [])
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM assistant_threads", [])
  end

  defp owned_workspace!(ctx, project_slug, kind) do
    {:ok, _project} = Context.ensure_project(%{name: project_slug, slug: project_slug})
    workspace_path = Path.join([ctx.workspace_root, project_slug, "__ws_selected"])
    File.mkdir_p!(workspace_path)
    use_inventory([inventory_entry(workspace_path, kind, nil)])
    workspace_path
  end

  defp inventory_entry(path, kind, issue_identifier) do
    %{path: path, kind: kind, issue_identifier: issue_identifier, child_worktrees: []}
  end

  defp use_inventory(entries) do
    Application.put_env(
      :symphony_elixir,
      @inventory_module_env,
      SymphonyElixirWeb.Tracker.AssistantThreadPathOwnershipInventory
    )

    Application.put_env(:symphony_elixir, @scan_result_env, {:ok, %{workspaces: entries}})
  end

  defp use_inventory_error(reason) do
    Application.put_env(
      :symphony_elixir,
      @inventory_module_env,
      SymphonyElixirWeb.Tracker.AssistantThreadPathOwnershipInventory
    )

    Application.put_env(:symphony_elixir, @scan_result_env, {:error, reason})
  end

  defp restore_env(key, value) do
    case value do
      nil -> System.delete_env(key)
      val -> System.put_env(key, val)
    end
  end

  defp restore_application_env(key, nil), do: Application.delete_env(:symphony_elixir, key)

  defp restore_application_env(key, value),
    do: Application.put_env(:symphony_elixir, key, value)

  defp restore_inventory_module(nil), do: Application.delete_env(:symphony_elixir, @inventory_module_env)

  defp restore_inventory_module(module),
    do: Application.put_env(:symphony_elixir, @inventory_module_env, module)
end
