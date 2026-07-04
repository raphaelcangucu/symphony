defmodule SymphonyElixir.PromptTemplates.TemplateTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PromptTemplates.Template
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(Template)
    :ok
  end

  test "changeset requires slug, name, and body" do
    changeset = Template.changeset(%Template{}, %{})

    refute changeset.valid?
    assert %{slug: ["can't be blank"], name: ["can't be blank"], body: ["can't be blank"]} = errors(changeset)
    assert Ecto.Changeset.get_field(changeset, :scope) == "global"
  end

  test "changeset rejects blank slug values" do
    changeset =
      Template.changeset(%Template{}, %{
        slug: "   ",
        name: "Investigate",
        body: "Investigate {{ issue.identifier }}",
        scope: "global"
      })

    refute changeset.valid?
    assert %{slug: ["can't be blank"]} = errors(changeset)
  end

  test "changeset validates mode with ExecutionMode values" do
    changeset =
      Template.changeset(%Template{}, %{
        slug: "investigate-issue",
        name: "Investigate Issue",
        body: "Investigate {{ issue.identifier }}",
        mode: "turbo",
        scope: "global"
      })

    refute changeset.valid?
    assert %{mode: [_message]} = errors(changeset)
  end

  test "changeset allows nil mode" do
    changeset =
      Template.changeset(%Template{}, %{
        slug: "investigate-issue",
        name: "Investigate Issue",
        body: "Investigate {{ issue.identifier }}",
        scope: "global"
      })

    assert changeset.valid?
  end

  test "changeset enforces unique scope + slug" do
    attrs = %{slug: "code-review", name: "Code Review", body: "Review {{ issue.identifier }}", scope: "global"}

    assert {:ok, _template} = %Template{} |> Template.changeset(attrs) |> Repo.insert()

    assert {:error, changeset} =
             %Template{} |> Template.changeset(attrs) |> Repo.insert()

    assert %{scope: [_message]} = errors(changeset)
  end

  test "allows same slug across different scopes" do
    attrs = %{slug: "code-review", name: "Code Review", body: "Review {{ issue.identifier }}"}

    assert {:ok, _template} =
             %Template{} |> Template.changeset(Map.put(attrs, :scope, "global")) |> Repo.insert()

    assert {:ok, _template} =
             %Template{} |> Template.changeset(Map.put(attrs, :scope, "demo-project")) |> Repo.insert()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Enum.reduce(opts, message, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
