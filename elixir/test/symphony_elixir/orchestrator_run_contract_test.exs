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
    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker ->
        {:violations, [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]}
      end,
      pull_requests: fn _states, _checker -> [] end,
      finalize: fn _workspace, _issue -> {:ok, [%{repo: "frontend", url: "https://x/pull/2"}]} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/2"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "finalizer failure blocks with violations" do
    violations = [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]

    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> {:violations, violations} end,
      pull_requests: fn _states, _checker -> [] end,
      finalize: fn _workspace, _issue -> {:error, {"frontend", :push_failed}} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:blocked, ^violations, {"frontend", :push_failed}} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end
end
