defmodule SymphonyElixir.LocalTracker.ProjectTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project

  describe "changeset/2 tracker_kind" do
    test "defaults to local when absent" do
      changeset = Project.changeset(%Project{}, %{name: "X", slug: "x"})
      assert changeset.valid?
      assert Ecto.Changeset.get_field(changeset, :tracker_kind) == "local"
    end

    test "accepts github with required config keys" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "github",
          tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1"}
        })

      assert changeset.valid?
    end

    test "rejects github without project_id" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "github",
          tracker_config: %{"repo" => "o/r"}
        })

      refute changeset.valid?
      assert %{tracker_config: _} = errors_on(changeset)
    end

    test "rejects linear without project_id" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "X",
          slug: "x",
          tracker_kind: "linear",
          tracker_config: %{}
        })

      refute changeset.valid?
    end

    test "accepts jira with a project_key" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "Advising",
          slug: "advising",
          tracker_kind: "jira",
          tracker_config: %{"project_key" => "CDE"}
        })

      assert changeset.valid?
    end

    test "rejects jira without a project_key" do
      changeset =
        Project.changeset(%Project{}, %{
          name: "Advising",
          slug: "advising",
          tracker_kind: "jira",
          tracker_config: %{}
        })

      refute changeset.valid?
      assert %{tracker_config: _} = errors_on(changeset)
    end

    test "rejects unknown tracker_kind" do
      changeset =
        Project.changeset(%Project{}, %{name: "X", slug: "x", tracker_kind: "trello"})

      refute changeset.valid?
    end
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
