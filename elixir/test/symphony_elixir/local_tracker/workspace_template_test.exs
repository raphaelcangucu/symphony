defmodule SymphonyElixir.LocalTracker.WorkspaceTemplateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  test "valid changeset requires name and slug" do
    changeset = WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{})
    refute changeset.valid?
    assert %{name: _, slug: _} = errors_on(changeset)
  end

  test "accepts list fields and wraps them for storage" do
    changeset =
      WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{
        name: "Gamba",
        slug: "gamba",
        workflow_statuses: [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        validation_commands: ["mix test"]
      })

    assert changeset.valid?
    assert Ecto.Changeset.get_field(changeset, :validation_commands) == %{"items" => ["mix test"]}
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
  end
end
