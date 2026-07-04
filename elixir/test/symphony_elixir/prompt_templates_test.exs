defmodule SymphonyElixir.PromptTemplatesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PromptTemplates
  alias SymphonyElixir.PromptTemplates.Template
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(Template)
    :ok
  end

  test "create, update, and delete manage non-built-in templates" do
    assert {:ok, template} =
             PromptTemplates.create(%{
               slug: "custom-command",
               name: "Custom command",
               body: "Run {{ issue.identifier }}",
               scope: "global"
             })

    assert {:ok, updated} = PromptTemplates.update(template, %{description: "Custom user template"})
    assert updated.description == "Custom user template"

    assert {:ok, deleted} = PromptTemplates.delete(updated)
    assert deleted.id == updated.id
  end

  test "delete blocks built-in templates" do
    assert {:ok, template} =
             PromptTemplates.create(%{
               slug: "code-review",
               name: "Code review",
               body: "Review {{ issue.identifier }}",
               scope: "global",
               built_in: true
             })

    assert {:error, :built_in_template} = PromptTemplates.delete(template)
  end

  test "get_by_slug falls back from project scope to global" do
    assert {:ok, _template} =
             PromptTemplates.create(%{
               slug: "release-notes",
               name: "Release notes",
               body: "Summarize {{ issue.identifier }}",
               scope: "global"
             })

    assert %Template{scope: "global"} =
             PromptTemplates.get_by_slug("release-notes", scope: "demo-project")
  end

  test "list merges global and project scope, with project overriding by slug" do
    assert {:ok, _global_review} =
             PromptTemplates.create(%{
               slug: "code-review",
               name: "Global code review",
               body: "Global {{ issue.identifier }}",
               scope: "global",
               position: 10
             })

    assert {:ok, _global_release} =
             PromptTemplates.create(%{
               slug: "release-notes",
               name: "Global release notes",
               body: "Release {{ issue.identifier }}",
               scope: "global",
               position: 30
             })

    assert {:ok, _project_review} =
             PromptTemplates.create(%{
               slug: "code-review",
               name: "Project code review",
               body: "Project {{ issue.identifier }}",
               scope: "demo-project",
               position: 5
             })

    templates = PromptTemplates.list(scope: "demo-project")

    assert Enum.map(templates, & &1.slug) == ["code-review", "release-notes"]
    assert Enum.find(templates, &(&1.slug == "code-review")).scope == "demo-project"
  end

  test "render fills Solid variables from context" do
    assert {:ok, template} =
             PromptTemplates.create(%{
               slug: "investigate",
               name: "Investigate",
               body: "Investigate {{ issue.identifier }}: {{ issue.title }}",
               scope: "global"
             })

    rendered =
      PromptTemplates.render(template, %{
        issue: %{identifier: "DEMO-1", title: "Broken test"}
      })

    assert rendered == "Investigate DEMO-1: Broken test"
  end

  test "ensure_builtins is idempotent" do
    assert :ok = PromptTemplates.ensure_builtins()
    count_after_first_run = Repo.aggregate(Template, :count)

    assert :ok = PromptTemplates.ensure_builtins()
    count_after_second_run = Repo.aggregate(Template, :count)

    assert count_after_second_run == count_after_first_run
    assert count_after_second_run >= 6
  end

  test "ensure_builtins does not overwrite user template with same scope and slug" do
    assert {:ok, _template} =
             PromptTemplates.create(%{
               slug: "code-review",
               name: "My custom code review",
               body: "Only custom instructions",
               scope: "global",
               built_in: false
             })

    assert :ok = PromptTemplates.ensure_builtins()

    assert %Template{} = code_review = PromptTemplates.get_by_slug("code-review", scope: "global")
    assert code_review.built_in == false
    assert code_review.name == "My custom code review"

    assert %Template{built_in: true} =
             PromptTemplates.get_by_slug("investigate-issue", scope: "global")
  end

  test "ensure_builtins refreshes built-in rows" do
    assert :ok = PromptTemplates.ensure_builtins()

    builtin = PromptTemplates.get_by_slug("investigate-issue", scope: "global")
    assert {:ok, _updated} = PromptTemplates.update(builtin, %{name: "Temp name"})

    assert :ok = PromptTemplates.ensure_builtins()

    assert PromptTemplates.get_by_slug("investigate-issue", scope: "global").name == "Investigate issue"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
