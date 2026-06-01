defmodule SymphonyElixir.LocalTracker.LabelSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Label}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "changeset accepts label remote_id", %{project: project} do
    attrs = %{project_id: project.id, name: "bug", color: "#ff0000", remote_id: "LA_kwDO1"}
    assert {:ok, label} = %Label{} |> Label.changeset(attrs) |> Repo.insert()
    assert label.remote_id == "LA_kwDO1"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
