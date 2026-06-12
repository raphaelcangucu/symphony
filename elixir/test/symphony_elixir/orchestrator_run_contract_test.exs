defmodule SymphonyElixir.OrchestratorRunContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator

  test "blocked_comment_body lists violations and explains no transition" do
    body =
      Orchestrator.blocked_comment_body([
        %{repo: "frontend", kind: :unpublished_branch, detail: "branch docs/gam-3 has 3 commit(s) without an upstream"}
      ])

    assert body =~ "## Codex Workpad"
    assert body =~ "blocked"
    assert body =~ "frontend: branch docs/gam-3"
    assert body =~ "NOT moved to review"
  end

  test "default_publish_contract returns ok with prs for satisfied gate" do
    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> :satisfied end,
      pull_requests: fn _states, _checker -> [%{repo: "frontend", url: "https://x/pull/1"}] end,
      finalize: fn _workspace, _issue -> raise "must not finalize" end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/1"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "violations route to finalizer; finalizer success returns its prs" do
    evaluate_calls = :atomics.new(1, [])

    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker ->
        if :atomics.add(evaluate_calls, 1, 1) == 1 do
          {:violations, [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]}
        else
          :satisfied
        end
      end,
      pull_requests: fn _states, _checker -> [%{repo: "frontend", url: "https://x/pull/2"}] end,
      finalize: fn _workspace, _issue -> {:ok, [%{repo: "frontend", url: "https://x/pull/2"}]} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/2"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "finalizer partial success that satisfies the gate returns ok" do
    evaluate_calls = :atomics.new(1, [])

    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker ->
        if :atomics.add(evaluate_calls, 1, 1) == 1 do
          {:violations, [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]}
        else
          :satisfied
        end
      end,
      pull_requests: fn _states, _checker -> [%{repo: "frontend", url: "https://x/pull/3"}] end,
      finalize: fn _workspace, _issue ->
        {:partial, [%{repo: "frontend", url: "https://x/pull/3"}], [{"backend", :push_failed}]}
      end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/3"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "finalizer failure blocks with remaining violations" do
    violations = [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]

    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> {:violations, violations} end,
      pull_requests: fn _states, _checker -> [] end,
      finalize: fn _workspace, _issue -> {:partial, [], [{"frontend", :push_failed}]} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}

    assert {:blocked, ^violations, {:partial_failure, [{"frontend", :push_failed}]}} =
             Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "evidence_comment_body renders run table, screenshots and ui-change note" do
    record = %SymphonyElixir.Evidence.Record{
      run_id: "20260610-1",
      status: "passed",
      ui_change: true,
      manifest: %{
        "runs" => [
          %{
            "kind" => "unit",
            "repo" => "frontend",
            "command" => "npm test",
            "status" => "passed",
            "summary" => %{"total" => 3, "passed" => 3, "failed" => 0}
          },
          %{
            "kind" => "e2e",
            "repo" => "frontend",
            "command" => "npx playwright test",
            "status" => "passed",
            "screenshots" => ["artifacts/screens/home.png"]
          }
        ]
      }
    }

    issue = %SymphonyElixir.Issue{
      id: "uuid",
      identifier: "GAM-9",
      state: "In Progress",
      project_slug: "gam"
    }

    body = Orchestrator.evidence_comment_body(record, issue, "http://localhost:4000")

    assert body =~ "## Codex Evidence"
    assert body =~ "Run `20260610-1`"
    assert body =~ "UI change: e2e + visual capture required"
    assert body =~ "| unit | frontend | `npm test` | passed | 3/3 passed, 0 failed |"
    assert body =~ "| e2e | frontend | `npx playwright test` | passed | - |"

    assert body =~
             "![home.png](http://localhost:4000/api/tracker/v1/projects/gam/issues/GAM-9/evidence/20260610-1/artifacts/artifacts/screens/home.png)"
  end
end
