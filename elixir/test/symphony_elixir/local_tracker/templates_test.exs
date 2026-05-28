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
    assert {:error, :template_not_found} = Templates.update_template("missing", %{"name" => "Nope"})
  end

  test "delete_template removes the template" do
    {:ok, _template} = Templates.create_template(%{"name" => "Doomed", "slug" => "doomed"})

    assert {:ok, _deleted} = Templates.delete_template("doomed")
    assert {:error, :template_not_found} = Templates.get_template("doomed")
  end

  test "delete_template returns error for unknown slug" do
    assert {:error, :template_not_found} = Templates.delete_template("missing")
  end

  test "create_template rolls back when a repository is invalid" do
    assert {:error, %Ecto.Changeset{} = changeset} =
             Templates.create_template(%{
               "name" => "Bad",
               "slug" => "bad",
               "repositories" => [%{"github_full_name" => "g/bad", "workspace_path" => "bad"}]
             })

    assert changeset.errors[:clone_url]
    assert {:error, :template_not_found} = Templates.get_template("bad")
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

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_clone_jobs",
          "local_tracker_workspace_template_repositories",
          "local_tracker_workspace_templates",
          "local_tracker_activity_events",
          "local_tracker_issue_relations",
          "local_tracker_issue_labels",
          "local_tracker_labels",
          "local_tracker_comments",
          "local_tracker_issues",
          "local_tracker_workflow_statuses",
          "local_tracker_repositories",
          "local_tracker_project_setups",
          "local_tracker_projects"
        ] do
      Repo.query!("delete from #{table}")
    end
  end
end
