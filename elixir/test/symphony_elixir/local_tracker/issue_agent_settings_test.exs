defmodule SymphonyElixir.LocalTracker.IssueAgentSettingsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.IssueAgentSettings
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(IssueAgentSettings)
    :ok
  end

  test "changeset requires project_slug and identifier" do
    changeset = IssueAgentSettings.changeset(%IssueAgentSettings{}, %{})

    refute changeset.valid?
    assert %{project_slug: ["can't be blank"], identifier: ["can't be blank"]} = errors(changeset)
  end

  test "changeset casts the optional agent fields" do
    changeset =
      IssueAgentSettings.changeset(%IssueAgentSettings{}, %{
        project_slug: "demo",
        identifier: "DEMO-1",
        agent_kind: "codex",
        model: "gpt-5.5",
        effort: "high",
        mode: "build"
      })

    assert changeset.valid?
    assert Ecto.Changeset.get_change(changeset, :agent_kind) == "codex"
    assert Ecto.Changeset.get_change(changeset, :model) == "gpt-5.5"
    assert Ecto.Changeset.get_change(changeset, :effort) == "high"
    assert Ecto.Changeset.get_change(changeset, :mode) == "build"
  end

  test "changeset rejects an unknown mode" do
    changeset =
      IssueAgentSettings.changeset(%IssueAgentSettings{}, %{
        project_slug: "demo",
        identifier: "DEMO-1",
        mode: "turbo"
      })

    refute changeset.valid?
    assert %{mode: [_message]} = errors(changeset)
  end

  test "changeset allows a nil mode" do
    changeset =
      IssueAgentSettings.changeset(%IssueAgentSettings{}, %{
        project_slug: "demo",
        identifier: "DEMO-1",
        model: "gpt-5.5"
      })

    assert changeset.valid?
  end

  test "unique on project_slug + identifier" do
    attrs = %{project_slug: "demo", identifier: "DEMO-1", mode: "build"}

    assert {:ok, _} = %IssueAgentSettings{} |> IssueAgentSettings.changeset(attrs) |> Repo.insert()

    assert {:error, changeset} =
             %IssueAgentSettings{} |> IssueAgentSettings.changeset(attrs) |> Repo.insert()

    assert %{project_slug: [_message]} = errors(changeset)
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
