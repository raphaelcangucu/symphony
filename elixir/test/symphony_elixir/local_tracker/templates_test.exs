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
