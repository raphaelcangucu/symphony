defmodule SymphonyElixir.Assistant.ThreadDocumentsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.{CodexSession, History, ThreadDocuments}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_threads()

    root = Path.join(System.tmp_dir!(), "tdocs-#{System.unique_integer([:positive])}")
    workspace = Path.join([root, "assistant", "freeform", "42"])
    File.mkdir_p!(workspace)
    File.write!(Path.join(workspace, "distributionmachine-tracker-project.md"), "# Tracker Project\n\nbody")
    File.write!(Path.join(workspace, "notes.txt"), "ignored")
    File.mkdir_p!(Path.join(workspace, "nested"))
    File.write!(Path.join([workspace, "nested", "child.md"]), "# Child\n\nnested")

    {:ok, thread} =
      History.create_freeform_thread(%{
        title: "Draft",
        workspace_path: workspace
      })

    on_exit(fn ->
      clean_threads()
      File.rm_rf!(root)
    end)

    %{thread: thread, workspace: workspace}
  end

  test "list/1 returns markdown drafts from the thread workspace", %{thread: thread} do
    assert %{available: true, reason: nil, documents: documents} = ThreadDocuments.list(thread.id)

    assert Enum.map(documents, & &1.path) == [
             "distributionmachine-tracker-project.md",
             "nested/child.md"
           ]

    assert %{
             kind: "draft",
             title: "Tracker Project",
             path: "distributionmachine-tracker-project.md"
           } = Enum.find(documents, &(&1.path == "distributionmachine-tracker-project.md"))
  end

  test "read/2 returns markdown content from the thread workspace", %{thread: thread} do
    assert {:ok, "# Tracker Project\n\nbody"} =
             ThreadDocuments.read(thread.id, "distributionmachine-tracker-project.md")
  end

  test "read/2 rejects traversal outside the thread workspace", %{thread: thread} do
    assert {:error, :invalid_path} = ThreadDocuments.read(thread.id, "../outside.md")
  end

  test "list/1 falls back to the canonical freeform workspace path", %{thread: thread, workspace: workspace} do
    File.rm_rf!(workspace)
    fallback = CodexSession.freeform_workspace(thread.id)
    File.mkdir_p!(fallback)
    File.write!(Path.join(fallback, "fallback.md"), "# Fallback\n\nok")

    assert %{available: true, documents: documents} = ThreadDocuments.list(thread.id)
    assert Enum.any?(documents, &(&1.path == "fallback.md"))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_threads do
    Repo.delete_all(SymphonyElixir.Assistant.Message)
    Repo.delete_all(SymphonyElixir.Assistant.Thread)
  end
end
