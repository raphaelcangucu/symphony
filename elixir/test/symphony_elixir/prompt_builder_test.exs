defmodule SymphonyElixir.PromptBuilderTest do
  use SymphonyElixir.TestSupport

  test "appends superpowers artifacts when present in the workspace" do
    write_workflow_file!(Workflow.workflow_file_path(), prompt: "Ticket {{ issue.identifier }}")

    root = temporary_workspace_root!("pb-artifacts")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))
    File.write!(Path.join([root, "docs", "superpowers", "specs", "x.md"]), "# Spec X")
    File.write!(Path.join([root, "docs", "superpowers", "handoff.md"]), "# Handoff\nkey decisions")

    issue = %Issue{
      identifier: "MAC-1",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    assert prompt =~ "Ticket MAC-1"
    assert prompt =~ "## Existing authoring artifacts (follow these)"
    assert prompt =~ "docs/superpowers/specs/x.md"
    assert prompt =~ "Spec X"
    assert prompt =~ "docs/superpowers/handoff.md"
    assert prompt =~ "Handoff"
    assert prompt =~ "key decisions"
  end

  test "appends no superpowers artifacts without a workspace or docs directory" do
    write_workflow_file!(Workflow.workflow_file_path(), prompt: "Ticket {{ issue.identifier }}")

    root = temporary_workspace_root!("pb-no-artifacts")

    issue = %Issue{
      identifier: "MAC-2",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    assert PromptBuilder.build_prompt(issue) == "Ticket MAC-2"
    assert PromptBuilder.build_prompt(issue, workspace: root) == "Ticket MAC-2"
  end

  test "appends superpowers artifacts in deterministic order and skips oversized files" do
    write_workflow_file!(Workflow.workflow_file_path(), prompt: "Ticket {{ issue.identifier }}")

    root = temporary_workspace_root!("pb-ordered-artifacts")
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "specs"]))
    File.mkdir_p!(Path.join([root, "docs", "superpowers", "plans"]))

    File.write!(Path.join([root, "docs", "superpowers", "specs", "b.md"]), "# Spec B")
    File.write!(Path.join([root, "docs", "superpowers", "specs", "a.md"]), "# Spec A")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "b.md"]), "# Plan B")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "a.md"]), "# Plan A")
    File.write!(Path.join([root, "docs", "superpowers", "handoff.md"]), "# Handoff")
    File.write!(Path.join([root, "docs", "superpowers", "plans", "large.md"]), String.duplicate("x", 512_001))

    issue = %Issue{
      identifier: "MAC-3",
      title: "T",
      description: "d",
      state: "In Progress"
    }

    prompt = PromptBuilder.build_prompt(issue, workspace: root)

    expected_order = [
      "docs/superpowers/specs/a.md",
      "docs/superpowers/specs/b.md",
      "docs/superpowers/plans/a.md",
      "docs/superpowers/plans/b.md",
      "docs/superpowers/plans/large.md",
      "docs/superpowers/handoff.md"
    ]

    positions =
      Enum.map(expected_order, fn relative_path ->
        assert {position, _length} = :binary.match(prompt, relative_path)
        position
      end)

    assert positions == Enum.sort(positions)
    assert prompt =~ "_Skipped: artifact too large._"
    assert prompt =~ "Plan A"
    assert prompt =~ "Spec A"
  end

  defp temporary_workspace_root!(name) do
    root = Path.join(System.tmp_dir!(), "#{name}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)
    root
  end
end
