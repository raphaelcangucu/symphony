defmodule SymphonyElixir.Tracker.LabelResolverTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Label}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.LabelResolver

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "resolve_names maps a cached remote_id to the label name" do
    {:ok, project} = Context.ensure_project(%{name: "Labels", slug: "label-resolver"})

    %Label{}
    |> Label.changeset(%{
      project_id: project.id,
      name: "bug",
      remote_id: "LA_kwDOJHngx88AAAACmEYycw"
    })
    |> Repo.insert!()

    assert LabelResolver.resolve_names(project, ["LA_kwDOJHngx88AAAACmEYycw"]) == ["bug"]
  end

  test "display_name resolves a stored github id via remote_id" do
    {:ok, project} = Context.ensure_project(%{name: "Labels", slug: "label-display"})

    %Label{}
    |> Label.changeset(%{
      project_id: project.id,
      name: "bug",
      remote_id: "LA_kwDOJHngx88AAAACmEYycw"
    })
    |> Repo.insert!()

    assert LabelResolver.display_name(project, "LA_kwDOJHngx88AAAACmEYycw") == "bug"
  end

  test "resolve_names keeps custom label names unchanged" do
    {:ok, project} = Context.ensure_project(%{name: "Labels", slug: "label-custom"})

    assert LabelResolver.resolve_names(project, ["frontend"]) == ["frontend"]
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
