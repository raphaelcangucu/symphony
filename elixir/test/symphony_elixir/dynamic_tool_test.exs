defmodule SymphonyElixir.Codex.DynamicToolTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Workpad

  test "tool_specs advertises linear_graphql and github_graphql" do
    names = Enum.map(DynamicTool.tool_specs(), & &1["name"])
    assert "linear_graphql" in names
    assert "github_graphql" in names

    linear = Enum.find(DynamicTool.tool_specs(), &(&1["name"] == "linear_graphql"))
    assert linear["description"] =~ "Linear"
    github = Enum.find(DynamicTool.tool_specs(), &(&1["name"] == "github_graphql"))
    assert github["description"] =~ "GitHub"
  end

  test "tool_specs does not expose the issue-bound set_issue_status tool to the assistant" do
    refute "set_issue_status" in Enum.map(DynamicTool.tool_specs(), & &1["name"])
  end

  test "coding_agent_tool_specs advertises set_issue_status with a required status" do
    names = Enum.map(DynamicTool.coding_agent_tool_specs(), & &1["name"])
    assert "linear_graphql" in names
    assert "github_graphql" in names
    assert "set_issue_status" in names
    assert "check_handoff_gate" in names
    assert "get_evidence_status" in names
    assert "manage_preview" in names
    assert "manage_dev_env" in names
    assert "link_pull_request" in names
    refute "scan_project_setup" in names

    spec = Enum.find(DynamicTool.coding_agent_tool_specs(), &(&1["name"] == "set_issue_status"))
    assert spec["inputSchema"]["required"] == ["status"]
    assert spec["description"] =~ "local-first"
  end

  test "manage_dev_env rejects save_steps for coding agent" do
    issue = %Issue{identifier: "GAM-1", project_slug: "gam"}

    response =
      DynamicTool.execute("manage_dev_env", %{"action" => "save_steps", "steps" => []}, issue: issue)

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "action_not_allowed"
  end

  @tag :tmp_dir
  test "check_handoff_gate uses bound issue context", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-1")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}

    response =
      DynamicTool.execute("check_handoff_gate", %{},
        issue: issue,
        project_config: evidence_disabled_config(),
        workspace: ws
      )

    assert response["success"] == true
    assert response["toolResult"]["tool"] == "check_handoff_gate"
    assert is_boolean(response["toolResult"]["data"]["ready"])
  end

  @tag :tmp_dir
  test "get_evidence_status serializes DateTime run timestamps instead of crashing", %{
    tmp_dir: tmp_dir
  } do
    ws = Path.join(tmp_dir, "GAM-1")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}
    recorded_at = ~U[2026-06-18 02:48:26.297945Z]

    run = %{
      id: 7,
      run_id: "run-7",
      session_id: "sess-7",
      status: "passed",
      ui_change: true,
      manifest: %{"issue" => "GAM-1"},
      inserted_at: recorded_at
    }

    response =
      DynamicTool.execute("get_evidence_status", %{},
        issue: issue,
        project_config: evidence_disabled_config(),
        workspace: ws,
        list_runs: fn _slug, _identifier -> {:ok, [run]} end
      )

    assert response["success"] == true
    text = hd(response["contentItems"])["text"]
    decoded = Jason.decode!(text)
    assert [run_json] = decoded["data"]["runs"]
    assert run_json["recorded_at"] == DateTime.to_iso8601(recorded_at)

    assert response["toolResult"]["data"]["runs"] |> hd() |> Map.fetch!("recorded_at") ==
             DateTime.to_iso8601(recorded_at)
  end

  test "set_issue_status fails when no issue is bound to the session" do
    response = DynamicTool.execute("set_issue_status", %{"status" => "In Progress"})

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "no issue is bound"
  end

  test "set_issue_status fails when status is missing even with a bound issue" do
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}
    response = DynamicTool.execute("set_issue_status", %{}, issue: issue)

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "non-empty `status`"
  end

  test "coding_agent_tool_specs advertises tracker-agnostic comment tools" do
    specs = DynamicTool.coding_agent_tool_specs()
    names = Enum.map(specs, & &1["name"])

    assert "add_comment" in names
    assert "list_comments" in names
    assert "update_comment" in names
    assert "delete_comment" in names

    add = Enum.find(specs, &(&1["name"] == "add_comment"))
    assert add["inputSchema"]["required"] == ["body"]
    assert add["description"] =~ "local-first"
    # Steer agents away from the wrong tracker tool on non-Linear projects.
    assert add["description"] =~ "NOT `linear_graphql`"

    update = Enum.find(specs, &(&1["name"] == "update_comment"))
    assert update["inputSchema"]["required"] == ["comment_id", "body"]

    delete = Enum.find(specs, &(&1["name"] == "delete_comment"))
    assert delete["inputSchema"]["required"] == ["comment_id"]
  end

  test "coding_agent_tool_specs advertises update_acceptance_criteria, kept off the assistant surface" do
    coding = Enum.map(DynamicTool.coding_agent_tool_specs(), & &1["name"])
    assistant = Enum.map(DynamicTool.tool_specs(), & &1["name"])

    assert "update_acceptance_criteria" in coding
    refute "update_acceptance_criteria" in assistant

    spec =
      Enum.find(DynamicTool.coding_agent_tool_specs(), &(&1["name"] == "update_acceptance_criteria"))

    assert spec["description"] =~ "Acceptance criteria"
    assert get_in(spec, ["inputSchema", "properties", "criteria", "type"]) == "array"
  end

  test "update_acceptance_criteria fails when no issue is bound to the session" do
    response = DynamicTool.execute("update_acceptance_criteria", %{"criteria" => []})

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "no issue is bound"
  end

  test "comment tools stay off the assistant-facing tool_specs surface" do
    names = Enum.map(DynamicTool.tool_specs(), & &1["name"])
    refute "add_comment" in names
    refute "list_comments" in names
    refute "update_comment" in names
    refute "delete_comment" in names
  end

  test "comment tools fail when no issue is bound to the session" do
    for tool <- ["add_comment", "list_comments", "update_comment", "delete_comment"] do
      response = DynamicTool.execute(tool, %{"body" => "## Codex Workpad", "comment_id" => 1})

      assert response["success"] == false
      text = hd(response["contentItems"])["text"]
      assert Jason.decode!(text)["error"]["message"] =~ "no issue is bound"
    end
  end

  test "add_comment requires a non-empty body even with a bound issue" do
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}
    response = DynamicTool.execute("add_comment", %{"body" => "   "}, issue: issue)

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "non-empty `body`"
  end

  test "update_comment requires a comment_id even with a bound issue" do
    issue = %Issue{project_slug: "demo", identifier: "DEMO-1"}
    response = DynamicTool.execute("update_comment", %{"body" => "## Codex Workpad"}, issue: issue)

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "require a `comment_id`"
  end

  describe "comment tools against the local-first board" do
    setup do
      SymphonyElixir.TestSupport.truncate_tracker!()
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
      {:ok, issue} = Context.create_issue("macro-markets", %{"title" => "Workpad", "status" => "Todo"})

      %{issue: %Issue{project_slug: "macro-markets", identifier: issue.identifier}}
    end

    test "add_comment creates a comment and returns its id, then update_comment edits it in place", %{issue: issue} do
      created =
        DynamicTool.execute(
          "add_comment",
          %{"body" => "## Codex Workpad\n\n### Plan\n- [ ] step"},
          issue: issue
        )

      assert created["success"] == true
      payload = created["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert payload["tool"] == "add_comment"
      assert payload["identifier"] == issue.identifier
      comment_id = payload["comment"]["id"]
      assert is_integer(comment_id)

      listed = DynamicTool.execute("list_comments", %{}, issue: issue)
      assert listed["success"] == true
      list_payload = listed["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert Enum.any?(list_payload["comments"], &(&1["id"] == comment_id))

      updated =
        DynamicTool.execute(
          "update_comment",
          %{"comment_id" => comment_id, "body" => "## Codex Workpad\n\n### Outcome\nno-op"},
          issue: issue
        )

      assert updated["success"] == true

      assert {:ok, [%{body: body}]} = Context.list_comments("macro-markets", issue.identifier)
      assert body =~ "### Outcome"
    end

    test "update_comment reports a missing comment id", %{issue: issue} do
      response =
        DynamicTool.execute(
          "update_comment",
          %{"comment_id" => 999_999, "body" => "## Codex Workpad"},
          issue: issue
        )

      assert response["success"] == false
      text = hd(response["contentItems"])["text"]
      assert Jason.decode!(text)["error"]["message"] =~ "No comment with that id"
    end

    test "delete_comment removes an existing comment by id", %{issue: issue} do
      created =
        DynamicTool.execute(
          "add_comment",
          %{"body" => "temporary note"},
          issue: issue
        )

      assert created["success"] == true

      comment_id =
        created["contentItems"]
        |> hd()
        |> Map.fetch!("text")
        |> Jason.decode!()
        |> get_in(["comment", "id"])

      deleted =
        DynamicTool.execute(
          "delete_comment",
          %{"comment_id" => comment_id},
          issue: issue
        )

      assert deleted["success"] == true
      payload = deleted["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert payload["tool"] == "delete_comment"
      assert payload["comment_id"] == comment_id

      assert {:ok, []} = Context.list_comments("macro-markets", issue.identifier)
    end

    test "link_pull_request links a PR to the bound issue", %{issue: issue} do
      response =
        DynamicTool.execute(
          "link_pull_request",
          %{"url" => "https://github.com/org/repo/pull/7"},
          issue: issue
        )

      assert response["success"] == true
      payload = response["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert payload["tool"] == "link_pull_request"
      assert payload["data"]["pull_request"]["number"] == 7
      assert payload["data"]["pull_request"]["repo"] == "org/repo"
    end

    test "link_pull_request rejects an invalid url", %{issue: issue} do
      response = DynamicTool.execute("link_pull_request", %{"url" => "not-a-pr"}, issue: issue)

      assert response["success"] == false
      text = hd(response["contentItems"])["text"]
      assert Jason.decode!(text)["error"]["message"] =~ "invalid_pr_url"
    end

    test "update_acceptance_criteria reads then ticks only the acceptance checkboxes" do
      {:ok, created} =
        Context.create_issue("macro-markets", %{
          "title" => "AC issue",
          "status" => "Todo",
          "description" => "Intro.\n\n## Acceptance criteria\n- [ ] First criterion\n- [ ] Second criterion\n\n## Plan\n- [ ] keep me\n"
        })

      bound = %Issue{project_slug: "macro-markets", identifier: created.identifier}

      read = DynamicTool.execute("update_acceptance_criteria", %{}, issue: bound)
      assert read["success"] == true
      read_payload = read["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert read_payload["applied"] == 0
      assert length(read_payload["criteria"]) == 2

      ticked =
        DynamicTool.execute(
          "update_acceptance_criteria",
          %{"criteria" => [%{"index" => 1, "checked" => true}, %{"text" => "second criterion"}]},
          issue: bound
        )

      assert ticked["success"] == true
      payload = ticked["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert payload["tool"] == "update_acceptance_criteria"
      assert payload["applied"] == 2
      assert payload["unmatched"] == []

      assert {:ok, stored} = Context.get_issue("macro-markets", created.identifier)
      assert stored.description =~ "## Acceptance criteria\n- [x] First criterion\n- [x] Second criterion"
      assert stored.description =~ "## Plan\n- [ ] keep me"
    end

    test "update_acceptance_criteria errors when the body has no acceptance section", %{issue: issue} do
      response =
        DynamicTool.execute(
          "update_acceptance_criteria",
          %{"criteria" => [%{"index" => 1}]},
          issue: issue
        )

      assert response["success"] == false
      text = hd(response["contentItems"])["text"]
      assert Jason.decode!(text)["error"]["message"] =~ "Acceptance criteria"
    end
  end

  describe "bundle coordination tools (coding-agent surface)" do
    setup do
      SymphonyElixir.TestSupport.truncate_tracker!()
      {:ok, _project} = Context.ensure_project(%{name: "Macro Markets", slug: "macro-markets"})
      {:ok, parent} = Context.create_issue("macro-markets", %{"title" => "Coordinator", "status" => "Backlog"})
      {:ok, child} = Context.create_issue("macro-markets", %{"title" => "Backend unit", "status" => "Backlog"})
      {:ok, _relation} = Context.add_blocker("macro-markets", child.identifier, parent.identifier, "sub_issue_of")

      workpad = """
      ## Codex Workpad

      ### Execution bundle

      ```yaml
      version: 1
      mode: bundle
      parent: macro-markets##{parent.id}
      units:
        - id: #{child.identifier}
          type: child_run
          repo: macro-markets/backend
      ```
      """

      {:ok, _comment} = Context.add_comment("macro-markets", parent.identifier, workpad, %{"author" => "assistant"})

      %{
        parent: parent,
        child_issue: %Issue{project_slug: "macro-markets", identifier: child.identifier},
        child_id: child.identifier
      }
    end

    test "report_unit_status from a child defaults the parent_identifier to its parent", ctx do
      response =
        DynamicTool.execute(
          "report_unit_status",
          %{"unit" => ctx.child_id, "phase" => "started"},
          issue: ctx.child_issue
        )

      assert response["success"] == true

      {:ok, comments} = Context.list_comments("macro-markets", ctx.parent.identifier)
      workpad = Enum.find(comments, &Workpad.workpad?(&1.body))
      assert workpad.body =~ "### Unit status: #{ctx.child_id}"
      assert workpad.body =~ "phase: started"
    end

    test "query_bundle_status from a child reads the parent bundle tree", ctx do
      response =
        DynamicTool.execute("query_bundle_status", %{}, issue: ctx.child_issue)

      assert response["success"] == true
      payload = response["contentItems"] |> hd() |> Map.fetch!("text") |> Jason.decode!()
      assert payload["data"]["parent"] == ctx.parent.identifier
      unit_ids = Enum.map(payload["data"]["units"], & &1["unit_id"])
      assert ctx.child_id in unit_ids
    end

    test "a child cannot target an unrelated bundle via parent_identifier", ctx do
      {:ok, other} = Context.create_issue("macro-markets", %{"title" => "Unrelated parent", "status" => "Backlog"})

      response =
        DynamicTool.execute(
          "report_unit_status",
          %{"parent_identifier" => other.identifier, "unit" => ctx.child_id, "phase" => "done"},
          issue: ctx.child_issue
        )

      assert response["success"] == false
      text = hd(response["contentItems"])["text"]
      assert Jason.decode!(text)["error"]["message"] =~ "parent_identifier_mismatch"
    end
  end

  test "unsupported tools return a failure payload with the supported tool list" do
    response = DynamicTool.execute("not_a_real_tool", %{})

    assert response["success"] == false

    assert [
             %{
               "type" => "inputText",
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => ~s(Unsupported dynamic tool: "not_a_real_tool".),
               "supportedTools" => [
                 "linear_graphql",
                 "github_graphql",
                 "set_issue_status",
                 "add_comment",
                 "list_comments",
                 "update_comment",
                 "delete_comment",
                 "update_acceptance_criteria",
                 "check_handoff_gate",
                 "get_evidence_status",
                 "manage_preview",
                 "list_previews",
                 "manage_tunnel",
                 "manage_dev_env",
                 "link_pull_request",
                 "goal",
                 "update_shared_contract",
                 "query_bundle_status",
                 "report_unit_status"
               ]
             }
           }
  end

  test "linear_graphql returns successful GraphQL responses as tool text" do
    test_pid = self()

    response =
      DynamicTool.execute(
        "linear_graphql",
        %{
          "query" => "query Viewer { viewer { id } }",
          "variables" => %{"includeTeams" => false}
        },
        linear_client: fn query, variables, opts ->
          send(test_pid, {:linear_client_called, query, variables, opts})
          {:ok, %{"data" => %{"viewer" => %{"id" => "usr_123"}}}}
        end
      )

    assert_received {:linear_client_called, "query Viewer { viewer { id } }", %{"includeTeams" => false}, []}

    assert response["success"] == true

    assert [
             %{
               "type" => "inputText",
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{"data" => %{"viewer" => %{"id" => "usr_123"}}}
  end

  test "linear_graphql accepts a raw GraphQL query string" do
    test_pid = self()

    response =
      DynamicTool.execute(
        "linear_graphql",
        "  query Viewer { viewer { id } }  ",
        linear_client: fn query, variables, opts ->
          send(test_pid, {:linear_client_called, query, variables, opts})
          {:ok, %{"data" => %{"viewer" => %{"id" => "usr_456"}}}}
        end
      )

    assert_received {:linear_client_called, "query Viewer { viewer { id } }", %{}, []}
    assert response["success"] == true
  end

  test "linear_graphql ignores legacy operationName arguments" do
    test_pid = self()

    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }", "operationName" => "Viewer"},
        linear_client: fn query, variables, opts ->
          send(test_pid, {:linear_client_called, query, variables, opts})
          {:ok, %{"data" => %{"viewer" => %{"id" => "usr_789"}}}}
        end
      )

    assert_received {:linear_client_called, "query Viewer { viewer { id } }", %{}, []}
    assert response["success"] == true
  end

  test "linear_graphql passes multi-operation documents through unchanged" do
    test_pid = self()

    query = """
    query Viewer { viewer { id } }
    query Teams { teams { nodes { id } } }
    """

    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => query},
        linear_client: fn forwarded_query, variables, opts ->
          send(test_pid, {:linear_client_called, forwarded_query, variables, opts})
          {:ok, %{"errors" => [%{"message" => "Must provide operation name if query contains multiple operations."}]}}
        end
      )

    assert_received {:linear_client_called, forwarded_query, %{}, []}
    assert forwarded_query == String.trim(query)
    assert response["success"] == false
  end

  test "linear_graphql rejects blank raw query strings even when using the default client" do
    response = DynamicTool.execute("linear_graphql", "   ")

    assert response["success"] == false

    assert [
             %{
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => "`linear_graphql` requires a non-empty `query` string."
             }
           }
  end

  test "linear_graphql marks GraphQL error responses as failures while preserving the body" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "mutation BadMutation { nope }"},
        linear_client: fn _query, _variables, _opts ->
          {:ok, %{"errors" => [%{"message" => "Unknown field `nope`"}], "data" => nil}}
        end
      )

    assert response["success"] == false

    assert [
             %{
               "type" => "inputText",
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "data" => nil,
             "errors" => [%{"message" => "Unknown field `nope`"}]
           }
  end

  test "linear_graphql marks atom-key GraphQL error responses as failures" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts ->
          {:ok, %{errors: [%{message: "boom"}], data: nil}}
        end
      )

    assert response["success"] == false
  end

  test "linear_graphql validates required arguments before calling Linear" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"variables" => %{"commentId" => "comment-1"}},
        linear_client: fn _query, _variables, _opts ->
          flunk("linear client should not be called when arguments are invalid")
        end
      )

    assert response["success"] == false

    assert [
             %{
               "type" => "inputText",
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => "`linear_graphql` requires a non-empty `query` string."
             }
           }

    blank_query =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "   "},
        linear_client: fn _query, _variables, _opts ->
          flunk("linear client should not be called when the query is blank")
        end
      )

    assert blank_query["success"] == false
  end

  test "linear_graphql rejects invalid argument types" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        [:not, :valid],
        linear_client: fn _query, _variables, _opts ->
          flunk("linear client should not be called when arguments are invalid")
        end
      )

    assert response["success"] == false

    assert [
             %{
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => "`linear_graphql` expects either a GraphQL query string or an object with `query` and optional `variables`."
             }
           }
  end

  test "linear_graphql rejects invalid variables" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }", "variables" => ["bad"]},
        linear_client: fn _query, _variables, _opts ->
          flunk("linear client should not be called when variables are invalid")
        end
      )

    assert response["success"] == false

    assert [
             %{
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => "`linear_graphql.variables` must be a JSON object when provided."
             }
           }
  end

  test "linear_graphql formats transport and auth failures" do
    missing_token =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts -> {:error, :missing_linear_api_token} end
      )

    assert missing_token["success"] == false

    assert [
             %{
               "text" => missing_token_text
             }
           ] = missing_token["contentItems"]

    assert Jason.decode!(missing_token_text) == %{
             "error" => %{
               "message" => "Symphony is missing Linear auth. Set `linear.api_key` in `WORKFLOW.md` or export `LINEAR_API_KEY`."
             }
           }

    status_error =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts -> {:error, {:linear_api_status, 503}} end
      )

    assert [
             %{
               "text" => status_error_text
             }
           ] = status_error["contentItems"]

    assert Jason.decode!(status_error_text) == %{
             "error" => %{
               "message" => "Linear GraphQL request failed with HTTP 503.",
               "status" => 503
             }
           }

    request_error =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts -> {:error, {:linear_api_request, :timeout}} end
      )

    assert [
             %{
               "text" => request_error_text
             }
           ] = request_error["contentItems"]

    assert Jason.decode!(request_error_text) == %{
             "error" => %{
               "message" => "Linear GraphQL request failed before receiving a successful response.",
               "reason" => ":timeout"
             }
           }
  end

  test "linear_graphql formats unexpected failures from the client" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts -> {:error, :boom} end
      )

    assert response["success"] == false

    assert [
             %{
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text) == %{
             "error" => %{
               "message" => "Linear GraphQL tool execution failed.",
               "reason" => ":boom"
             }
           }
  end

  test "linear_graphql falls back to inspect for non-JSON payloads" do
    response =
      DynamicTool.execute(
        "linear_graphql",
        %{"query" => "query Viewer { viewer { id } }"},
        linear_client: fn _query, _variables, _opts -> {:ok, :ok} end
      )

    assert response["success"] == true

    assert [
             %{
               "text" => ":ok"
             }
           ] = response["contentItems"]
  end

  test "github_graphql returns successful GraphQL responses" do
    response =
      DynamicTool.execute(
        "github_graphql",
        %{"query" => "query { viewer { login } }"},
        github_client: fn query, variables, _opts ->
          assert query =~ "viewer"
          assert variables == %{}
          {:ok, %{"data" => %{"viewer" => %{"login" => "octocat"}}}}
        end
      )

    assert response["success"] == true
  end

  test "github_graphql reports missing token" do
    response =
      DynamicTool.execute(
        "github_graphql",
        %{"query" => "query { viewer { login } }"},
        github_client: fn _, _, _ -> {:error, :missing_github_token} end
      )

    assert response["success"] == false

    assert [
             %{
               "text" => text
             }
           ] = response["contentItems"]

    assert Jason.decode!(text)["error"]["message"] =~ "GITHUB_TOKEN"
  end

  test "github_graphql reports HTTP status errors" do
    response =
      DynamicTool.execute(
        "github_graphql",
        %{"query" => "query { viewer { login } }"},
        github_client: fn _, _, _ -> {:error, {:github_api_status, 500}} end
      )

    assert response["success"] == false
    text = hd(response["contentItems"])["text"]
    assert Jason.decode!(text)["error"]["message"] =~ "500"
  end

  defp evidence_disabled_config do
    struct!(SymphonyElixir.ProjectConfig,
      project_id: "proj-1",
      project_slug: "gam",
      tracker_kind: "github",
      wait_states: ["Human Review"],
      completion_transitions: %{"In Progress" => "Human Review"},
      evidence: %{required: false, repos: %{}}
    )
  end
end
