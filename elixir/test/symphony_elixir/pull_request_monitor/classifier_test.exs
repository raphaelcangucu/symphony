defmodule SymphonyElixir.PullRequestMonitor.ClassifierTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PullRequestMonitor.Classifier

  @ci_context %{
    issue: %{identifier: "#42", title: "Add login", description: "desc"},
    pr: %{
      number: 7,
      title: "feat: login",
      head_ref: "codex/42-login",
      base_ref: "main",
      changed_files: ["lib/login.ex"]
    },
    failing_jobs: [%{name: "test", excerpt: "assertion failed in login_test.exs"}]
  }

  test "parse_verdict accepts the last fenced JSON block" do
    reply = """
    Some reasoning here.

    ```json
    {"kind": "ci_failure", "verdict": "pr_caused", "confidence": 0.9, "summary": "login test broke"}
    ```
    """

    assert {:ok, verdict} = Classifier.parse_verdict(reply)
    assert verdict["verdict"] == "pr_caused"
  end

  test "parse_verdict rejects malformed output" do
    assert {:error, _} = Classifier.parse_verdict("no json here")
    assert {:error, _} = Classifier.parse_verdict("```json\n{\"verdict\": \"sideways\"}\n```")
  end

  test "low-confidence actionable verdicts are downgraded to needs_human" do
    runner = fn _prompt, _opts ->
      {:ok, ~s(```json\n{"kind":"ci_failure","verdict":"pr_caused","confidence":0.3,"summary":"unsure"}\n```)}
    end

    assert {:ok, %{"verdict" => "needs_human"}} =
             Classifier.classify(:ci_failure, @ci_context, runner: runner)
  end

  test "runner errors fall back to needs_human" do
    runner = fn _prompt, _opts -> {:error, :timeout} end

    assert {:ok, %{"verdict" => "needs_human", "summary" => _}} =
             Classifier.classify(:ci_failure, @ci_context, runner: runner)
  end

  test "build_prompt embeds logs for ci and review body for reviews" do
    ci_prompt = Classifier.build_prompt(:ci_failure, @ci_context)
    assert ci_prompt =~ "assertion failed in login_test.exs"
    assert ci_prompt =~ "pr_caused"

    review_context =
      Map.put(@ci_context, :review, %{
        author: "bot",
        body: "Blocking: nil check missing",
        state: "CHANGES_REQUESTED"
      })

    review_prompt = Classifier.build_prompt(:review_findings, review_context)
    assert review_prompt =~ "Blocking: nil check missing"
    assert review_prompt =~ "fixable_by_agent"
  end
end
