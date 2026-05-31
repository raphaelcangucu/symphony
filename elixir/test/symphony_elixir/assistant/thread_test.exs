defmodule SymphonyElixir.Assistant.ThreadTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.Thread

  test "project scope requires project_slug" do
    changeset = Thread.changeset(%Thread{}, %{scope: "project", workspace_path: "/tmp/a", status: "active"})
    refute changeset.valid?
    assert %{project_slug: _} = errors_on(changeset)
  end

  test "freeform scope rejects a project_slug" do
    changeset =
      Thread.changeset(%Thread{}, %{scope: "freeform", project_slug: "p", workspace_path: "/tmp/a", status: "active"})

    refute changeset.valid?
    assert %{project_slug: _} = errors_on(changeset)
  end

  test "freeform scope is valid without a project" do
    changeset =
      Thread.changeset(%Thread{}, %{scope: "freeform", title: "Brainstorm", workspace_path: "/tmp/a", status: "active"})

    assert changeset.valid?
  end

  test "rejects unknown scope" do
    changeset = Thread.changeset(%Thread{}, %{scope: "weird", workspace_path: "/tmp/a", status: "active"})
    refute changeset.valid?
    assert %{scope: _} = errors_on(changeset)
  end

  test "issue scope requires project_slug and issue_identifier" do
    changeset = Thread.changeset(%Thread{}, %{scope: "issue", project_slug: "demo", workspace_path: "/tmp/a", status: "active"})
    refute changeset.valid?
    assert %{issue_identifier: _} = errors_on(changeset)

    valid =
      Thread.changeset(%Thread{}, %{
        scope: "issue",
        project_slug: "demo",
        issue_identifier: "ABC-1",
        workspace_path: "/tmp/a",
        status: "active"
      })

    assert valid.valid?
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
  end
end
