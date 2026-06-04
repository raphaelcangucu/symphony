defmodule SymphonyElixir.LocalTracker.TemplatesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Templates, WorkspaceTemplate}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "create_template + get_template" do
    assert {:ok, template} =
             Templates.create_template(%{
               "name" => "Gamba",
               "slug" => "gamba",
               "validation_commands" => ["mix test"],
               "repositories" => [
                 %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "api", "role" => "backend"}
               ]
             })

    assert {:ok, fetched} = Templates.get_template("gamba")
    assert fetched.id == template.id
    assert WorkspaceTemplate.validation_commands_list(fetched) == ["mix test"]
    assert [%{github_full_name: "g/api"}] = fetched.repositories
  end

  test "list_templates orders newest first" do
    {:ok, _a} = Templates.create_template(%{"name" => "A", "slug" => "a"})
    {:ok, _b} = Templates.create_template(%{"name" => "B", "slug" => "b"})
    assert ["b", "a"] = Templates.list_templates() |> Enum.map(& &1.slug)
  end

  test "save_project_as_template captures repos and parameterizes slug" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Src",
        "slug" => "src",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "g/api", "workspace_path" => "src/api", "role" => "backend", "clone_url" => "https://github.com/g/api.git"}],
        "setup" => %{"after_create_hook" => "cd /root/src/api && echo hi"}
      })

    assert {:ok, template} = Templates.save_project_as_template("src", %{slug: "src-tpl"})
    assert template.slug == "src-tpl"
    assert template.metadata["source"] == "saved_from_project"
    assert [%{workspace_path: "{{slug}}/api"}] = template.repositories
  end

  test "save_project_as_template handles project without setup" do
    {:ok, _project} = Context.ensure_project(%{"name" => "Bare", "slug" => "bare"})

    assert {:ok, template} = Templates.save_project_as_template("bare", %{})
    assert template.slug == "bare-template"
    assert template.metadata["source"] == "saved_from_project"
    assert template.after_create_hook == nil
    assert WorkspaceTemplate.validation_commands_list(template) == []
    assert template.repositories == []
  end

  test "update_template updates fields and replaces repositories" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Orig",
        "slug" => "orig",
        "repositories" => [
          %{"github_full_name" => "g/old", "clone_url" => "https://github.com/g/old.git", "workspace_path" => "old", "role" => "backend"}
        ]
      })

    assert {:ok, updated} =
             Templates.update_template("orig", %{
               "name" => "Renamed",
               "repositories" => [
                 %{"github_full_name" => "g/new", "clone_url" => "https://github.com/g/new.git", "workspace_path" => "new", "role" => "frontend"}
               ]
             })

    assert updated.name == "Renamed"
    assert [%{github_full_name: "g/new", workspace_path: "new"}] = updated.repositories
  end

  test "update_template without repositories leaves existing repositories untouched" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Keep",
        "slug" => "keep",
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "api", "role" => "backend"}
        ]
      })

    assert {:ok, updated} = Templates.update_template("keep", %{"description" => "now described"})
    assert updated.description == "now described"
    assert [%{github_full_name: "g/api", workspace_path: "api"}] = updated.repositories
  end

  test "update_template returns error for unknown slug" do
    assert {:error, {:template_not_found, "missing"}} = Templates.update_template("missing", %{"name" => "Nope"})
  end

  test "delete_template removes the template" do
    {:ok, _template} = Templates.create_template(%{"name" => "Doomed", "slug" => "doomed"})

    assert {:ok, _deleted} = Templates.delete_template("doomed")
    assert {:error, {:template_not_found, "doomed"}} = Templates.get_template("doomed")
  end

  test "delete_template returns error for unknown slug" do
    assert {:error, {:template_not_found, "missing"}} = Templates.delete_template("missing")
  end

  test "create_template rolls back when a repository is invalid" do
    assert {:error, %Ecto.Changeset{} = changeset} =
             Templates.create_template(%{
               "name" => "Bad",
               "slug" => "bad",
               "repositories" => [%{"github_full_name" => "g/bad", "workspace_path" => "bad"}]
             })

    assert changeset.errors[:clone_url]
    assert {:error, {:template_not_found, "bad"}} = Templates.get_template("bad")
  end

  test "update_template rolls back when a replacement repository is invalid" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Upd",
        "slug" => "upd",
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "api", "role" => "backend"}
        ]
      })

    assert {:error, %Ecto.Changeset{} = changeset} =
             Templates.update_template("upd", %{
               "repositories" => [%{"github_full_name" => "g/bad", "workspace_path" => "bad"}]
             })

    assert changeset.errors[:clone_url]

    assert {:ok, fetched} = Templates.get_template("upd")
    assert [%{github_full_name: "g/api"}] = fetched.repositories
  end

  test "instantiate_template creates project, repos, and clone jobs" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Gamba",
        "slug" => "gamba",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "{{slug}}/api", "role" => "backend"}
        ]
      })

    assert {:ok, project} = Templates.instantiate_template("gamba", %{"name" => "Gamba One", "slug" => "gamba-one"})
    assert project.slug == "gamba-one"

    [repo] = Context.list_repositories("gamba-one")
    assert repo.workspace_path == "gamba-one/api"

    jobs = Templates.list_clone_jobs("gamba-one")
    assert length(jobs) == 1
    assert hd(jobs).status == "pending"
  end

  test "instantiate_template skips statuses for github tracker" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Remote",
        "slug" => "remote-tpl",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => []
      })

    assert {:ok, _project} =
             Templates.instantiate_template("remote-tpl", %{
               "name" => "R",
               "slug" => "r-remote",
               "tracker" => %{"kind" => "github", "config" => %{"repo" => "o/r", "project_id" => "PVT_1"}}
             })

    assert Context.list_statuses("r-remote") == []
  end

  test "start_clone_jobs triggers the starter for each enqueued job" do
    {:ok, _template} =
      Templates.create_template(%{
        "name" => "Cloner",
        "slug" => "cloner",
        "repositories" => [
          %{"github_full_name" => "g/api", "clone_url" => "https://github.com/g/api.git", "workspace_path" => "{{slug}}/api", "role" => "backend"}
        ]
      })

    {:ok, _project} = Templates.instantiate_template("cloner", %{"name" => "Cloner One", "slug" => "cloner-one"})

    [job] = Templates.list_clone_jobs("cloner-one")
    test_pid = self()

    assert :ok = Templates.start_clone_jobs("cloner-one", fn id -> send(test_pid, {:started, id}) end)
    assert_received {:started, started_id}
    assert started_id == job.id
  end

  test "start_clone_jobs returns ok for a project with no clone jobs" do
    {:ok, _template} =
      Templates.create_template(%{"name" => "Empty", "slug" => "empty-tpl", "repositories" => []})

    {:ok, _project} = Templates.instantiate_template("empty-tpl", %{"name" => "Empty One", "slug" => "empty-one"})

    assert Templates.list_clone_jobs("empty-one") == []
    assert :ok = Templates.start_clone_jobs("empty-one")
  end

  test "start_clone_jobs returns error for unknown project" do
    assert {:error, :project_not_found} = Templates.start_clone_jobs("nope", fn _ -> :ok end)
  end

  test "list_clone_jobs returns empty list for unknown project" do
    assert Templates.list_clone_jobs("nope") == []
  end

  test "resolve_slug maps legacy shorthand slugs" do
    {:ok, _template} = Templates.create_template(%{"name" => "Full-stack", "slug" => "multi-repo-fullstack"})
    assert {:ok, "multi-repo-fullstack"} = Templates.resolve_slug("multi-repo")
    assert {:ok, template} = Templates.get_template("multi-repo")
    assert template.slug == "multi-repo-fullstack"
  end

  test "import_builtins seeds templates idempotently" do
    assert :ok = Templates.import_builtins()
    templates = Templates.list_templates()
    slugs = Enum.map(templates, & &1.slug)
    assert "single-repo-elixir" in slugs
    assert "multi-repo-fullstack" in slugs
    assert "macro-markets" in slugs

    macro = Enum.find(templates, &(&1.slug == "macro-markets"))
    repo_paths = macro.repositories |> Enum.map(& &1.workspace_path) |> Enum.sort()
    assert repo_paths == ["back", "front"]
    branches = macro.repositories |> Enum.map(& &1.default_branch) |> Enum.sort()
    assert branches == ["dev", "homolog"]

    # Idempotent: second run does not duplicate
    assert :ok = Templates.import_builtins()
    count = Templates.list_templates() |> Enum.count(&(&1.slug == "macro-markets"))
    assert count == 1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
