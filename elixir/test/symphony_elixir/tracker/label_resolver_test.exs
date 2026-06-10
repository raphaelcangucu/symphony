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

  test "display_name resolves github id stored as label name via remote catalog" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba-labels",
        tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_test"}
      })

    %Label{}
    |> Label.changeset(%{project_id: project.id, name: "LA_kwDOJHngx88AAAACmEYycw"})
    |> Repo.insert!()

    previous = Application.get_env(:symphony_elixir, :issue_adapters, %{})

    Application.put_env(:symphony_elixir, :issue_adapters, %{
      "github" => SymphonyElixir.Tracker.LabelResolverTest.StubGitHubIssueAdapter
    })

    on_exit(fn -> Application.put_env(:symphony_elixir, :issue_adapters, previous) end)

    assert LabelResolver.display_name(project, "LA_kwDOJHngx88AAAACmEYycw") == "symphony:codex"
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

defmodule SymphonyElixir.Tracker.LabelResolverTest.StubGitHubIssueAdapter do
  @moduledoc false

  def list_labels(_project) do
    {:ok, [%{id: "LA_kwDOJHngx88AAAACmEYycw", name: "symphony:codex"}]}
  end
end
