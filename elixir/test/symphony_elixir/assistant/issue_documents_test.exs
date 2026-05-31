defmodule SymphonyElixir.Assistant.IssueDocumentsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.IssueDocuments
  alias SymphonyElixir.Workflow

  setup do
    root = Path.join(System.tmp_dir!(), "idocs-#{System.unique_integer([:positive])}")
    workspace_root = Path.join(root, "workspaces")
    workflow_root = Path.join(root, "workflow")
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    previous_workflow_path = Workflow.workflow_file_path()

    File.mkdir_p!(workflow_root)
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    issue_root = Path.join(workspace_root, "MAC-1")
    specs_dir = Path.join([issue_root, "docs", "superpowers", "specs"])
    plans_dir = Path.join([issue_root, "docs", "superpowers", "plans"])

    File.mkdir_p!(specs_dir)
    File.mkdir_p!(plans_dir)
    File.write!(Path.join(specs_dir, "2026-05-31-x-design.md"), "# X Design\n\nbody")
    File.write!(Path.join(plans_dir, "2026-05-31-y-plan.md"), "# Y Plan\n\nsteps")
    File.write!(Path.join([issue_root, "docs", "superpowers", "handoff.md"]), "# Handoff\n\nnotes")
    File.write!(Path.join([issue_root, "docs", "superpowers", "notes.txt"]), "private")
    File.write!(Path.join(specs_dir, "too-large.md"), String.duplicate("a", 512_001))

    on_exit(fn ->
      Workflow.set_workflow_file_path(previous_workflow_path)
      File.rm_rf!(root)
    end)

    %{root: root}
  end

  test "list/1 returns docs with derived titles in stable kind order" do
    assert %{available: true, reason: nil, documents: documents} = IssueDocuments.list("MAC-1")

    assert Enum.map(documents, & &1.kind) == ["spec", "spec", "plan", "handoff"]

    assert %{
             id: "docs/superpowers/specs/2026-05-31-x-design.md",
             kind: "spec",
             title: "X Design",
             path: "docs/superpowers/specs/2026-05-31-x-design.md",
             updated_at: updated_at
           } = Enum.find(documents, &(&1.path == "docs/superpowers/specs/2026-05-31-x-design.md"))

    assert is_binary(updated_at)

    assert %{
             kind: "plan",
             title: "Y Plan",
             path: "docs/superpowers/plans/2026-05-31-y-plan.md"
           } = Enum.find(documents, &(&1.path == "docs/superpowers/plans/2026-05-31-y-plan.md"))

    assert %{
             kind: "handoff",
             title: "Handoff",
             path: "docs/superpowers/handoff.md"
           } = List.last(documents)
  end

  test "list/1 reports workspace_missing when the dir is absent" do
    assert %{available: false, reason: "workspace_missing", documents: []} = IssueDocuments.list("MAC-404")
  end

  test "read/2 returns the markdown body" do
    assert {:ok, "# X Design\n\nbody"} =
             IssueDocuments.read("MAC-1", "docs/superpowers/specs/2026-05-31-x-design.md")
  end

  test "read/2 rejects path traversal" do
    assert {:error, :invalid_path} = IssueDocuments.read("MAC-1", "../../../../etc/passwd")
    assert {:error, :invalid_path} = IssueDocuments.read("MAC-1", "docs/superpowers/../../secret.md")
  end

  test "read/2 rejects non-markdown files under docs/superpowers" do
    assert {:error, :invalid_path} = IssueDocuments.read("MAC-1", "docs/superpowers/notes.txt")
  end

  test "read/2 limits markdown size" do
    assert {:error, :too_large} = IssueDocuments.read("MAC-1", "docs/superpowers/specs/too-large.md")
  end
end
