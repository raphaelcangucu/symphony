defmodule SymphonyElixir.Assistant.IssueDocumentsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Assistant.IssueDocuments
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    clean_threads()

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
      clean_threads()
      Workflow.set_workflow_file_path(previous_workflow_path)
      File.rm_rf!(root)
    end)

    %{root: root, workspace_root: workspace_root}
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

  test "list/1 scans only a bounded title prefix", %{workspace_root: workspace_root} do
    late_title_path =
      Path.join([
        workspace_root,
        "MAC-1",
        "docs",
        "superpowers",
        "specs",
        "late-title.md"
      ])

    File.write!(late_title_path, String.duplicate("x", 20_000) <> "\n# Late Title\n")

    assert %{available: true, documents: documents} = IssueDocuments.list("MAC-1")
    assert %{title: "late-title.md"} = Enum.find(documents, &(&1.path == "docs/superpowers/specs/late-title.md"))
  end

  test "list/1 treats symlinked docs root as missing", %{root: root, workspace_root: workspace_root} do
    issue_root = empty_issue_root!(workspace_root, "MAC-DOCS-LINK")
    external_docs = Path.join([root, "external-docs"])
    File.mkdir_p!(Path.join([external_docs, "superpowers", "specs"]))
    File.write!(Path.join([external_docs, "superpowers", "specs", "outside.md"]), "# Outside\n")
    File.ln_s!(external_docs, Path.join(issue_root, "docs"))

    assert %{available: false, reason: "workspace_missing", documents: []} = IssueDocuments.list("MAC-DOCS-LINK")
  end

  test "list/1 treats symlinked superpowers root as missing", %{root: root, workspace_root: workspace_root} do
    issue_root = empty_issue_root!(workspace_root, "MAC-SUPERPOWERS-LINK")
    external_superpowers = Path.join([root, "external-superpowers"])
    File.mkdir_p!(Path.join([external_superpowers, "specs"]))
    File.write!(Path.join([external_superpowers, "specs", "outside.md"]), "# Outside\n")
    File.mkdir_p!(Path.join(issue_root, "docs"))
    File.ln_s!(external_superpowers, Path.join([issue_root, "docs", "superpowers"]))

    assert %{available: false, reason: "workspace_missing", documents: []} =
             IssueDocuments.list("MAC-SUPERPOWERS-LINK")
  end

  test "list/1 treats symlinked specs and plans dirs as empty", %{root: root, workspace_root: workspace_root} do
    issue_root = empty_issue_root!(workspace_root, "MAC-KIND-LINKS")
    doc_root = Path.join([issue_root, "docs", "superpowers"])
    external_specs = Path.join([root, "external-specs"])
    external_plans = Path.join([root, "external-plans"])

    File.mkdir_p!(doc_root)
    File.mkdir_p!(external_specs)
    File.mkdir_p!(external_plans)
    File.write!(Path.join(external_specs, "outside-spec.md"), "# Outside Spec\n")
    File.write!(Path.join(external_plans, "outside-plan.md"), "# Outside Plan\n")
    File.write!(Path.join(doc_root, "handoff.md"), "# Handoff\n")
    File.ln_s!(external_specs, Path.join(doc_root, "specs"))
    File.ln_s!(external_plans, Path.join(doc_root, "plans"))

    assert %{available: true, documents: [%{kind: "handoff", title: "Handoff"}]} = IssueDocuments.list("MAC-KIND-LINKS")
  end

  test "list/1 ignores symlinked handoff file", %{root: root, workspace_root: workspace_root} do
    issue_root = empty_issue_root!(workspace_root, "MAC-HANDOFF-LINK")
    doc_root = Path.join([issue_root, "docs", "superpowers"])
    external_handoff = Path.join([root, "outside-handoff.md"])

    File.mkdir_p!(Path.join(doc_root, "specs"))
    File.mkdir_p!(Path.join(doc_root, "plans"))
    File.write!(Path.join([doc_root, "specs", "inside.md"]), "# Inside\n")
    File.write!(external_handoff, "# Outside Handoff\n")
    File.ln_s!(external_handoff, Path.join(doc_root, "handoff.md"))

    assert %{available: true, documents: documents} = IssueDocuments.list("MAC-HANDOFF-LINK")
    assert Enum.map(documents, & &1.kind) == ["spec"]
    refute Enum.any?(documents, &(&1.kind == "handoff"))
  end

  test "list/1 reports workspace_missing when the dir is absent" do
    assert %{available: false, reason: "workspace_missing", documents: []} = IssueDocuments.list("MAC-404")
  end

  test "list/1 reads from the persisted thread workspace when it differs from the computed path", %{
    workspace_root: workspace_root
  } do
    {:ok, _project} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    persisted_root = Path.join(workspace_root, "persisted-tree")
    specs_dir = Path.join([persisted_root, "docs", "superpowers", "specs"])
    File.mkdir_p!(specs_dir)
    File.write!(Path.join(specs_dir, "design.md"), "# Persisted Design\n\nbody")

    {:ok, _thread} =
      History.ensure_issue_thread("macro", "MAC-PERSISTED", %{workspace_path: persisted_root})

    assert persisted_root != SymphonyElixir.Workspace.path_for_issue("MAC-PERSISTED")

    assert %{available: true, documents: [%{title: "Persisted Design", kind: "spec"}]} =
             IssueDocuments.list("MAC-PERSISTED")

    assert {:ok, "# Persisted Design\n\nbody"} =
             IssueDocuments.read("MAC-PERSISTED", "docs/superpowers/specs/design.md")
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

  defp empty_issue_root!(workspace_root, identifier) do
    issue_root = Path.join(workspace_root, identifier)
    File.rm_rf!(issue_root)
    File.mkdir_p!(issue_root)
    issue_root
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_threads do
    for table <- ["assistant_messages", "assistant_threads"] do
      Repo.query!("DELETE FROM #{table}")
    end
  end
end
