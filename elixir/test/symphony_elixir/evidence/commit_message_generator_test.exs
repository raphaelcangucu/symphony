defmodule SymphonyElixir.Evidence.CommitMessageGeneratorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.CommitMessageGenerator

  @issue %{id: "iss-1", identifier: "510", title: "Dock branches"}

  test "generate returns trimmed message from runner" do
    runner = fn _workspace, _prompt, _issue, _opts ->
      {:ok, %{assistant_message: "feat: add dock branches\n\n"}}
    end

    assert {:ok, "feat: add dock branches"} =
             CommitMessageGenerator.generate("/tmp", @issue,
               runner: runner,
               diff_summary: "diff --git a/x b/x\n+hello"
             )
  end

  test "generate errors when diff summary blank" do
    assert {:error, :nothing_to_commit} =
             CommitMessageGenerator.generate("/tmp", @issue, diff_summary: "  ")
  end

  test "build_prompt asks for conventional commit only" do
    prompt = CommitMessageGenerator.build_prompt(%{
      identifier: "510",
      title: "Dock",
      diff_summary: "+ foo"
    })

    assert prompt =~ "Return only the final commit message"
    assert prompt =~ "510"
    assert prompt =~ "+ foo"
  end

  test "strips markdown fences from model output" do
    runner = fn _, _, _, _ ->
      {:ok, %{assistant_message: "```\nfeat: fenced\n```"}}
    end

    assert {:ok, "feat: fenced"} =
             CommitMessageGenerator.generate("/tmp", @issue,
               runner: runner,
               diff_summary: "+x"
             )
  end

  test "propagate runner errors" do
    runner = fn _, _, _, _ -> {:error, :agent_failed} end

    assert {:error, :agent_failed} =
             CommitMessageGenerator.generate("/tmp", @issue,
               runner: runner,
               diff_summary: "+x"
             )
  end

  test "forwards workspace_root to the runner for per-project cwd guards" do
    parent = self()

    runner = fn _workspace, _prompt, _issue, opts ->
      send(parent, {:runner_opts, opts})
      {:ok, %{assistant_message: "feat: scoped root"}}
    end

    assert {:ok, "feat: scoped root"} =
             CommitMessageGenerator.generate("/tmp/project/issue-1", @issue,
               runner: runner,
               diff_summary: "+x",
               workspace_root: "/tmp/project"
             )

    assert_receive {:runner_opts, opts}
    assert Keyword.get(opts, :workspace_root) == "/tmp/project"
  end
end
