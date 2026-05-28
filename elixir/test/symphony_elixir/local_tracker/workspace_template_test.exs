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

  test "stores an already-wrapped items map as-is" do
    wrapped = %{"items" => [%{"name" => "Done"}]}

    changeset =
      WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{
        name: "Gamba",
        slug: "gamba",
        workflow_statuses: wrapped
      })

    assert changeset.valid?
    assert Ecto.Changeset.get_field(changeset, :workflow_statuses) == wrapped
  end

  test "leaves list field unchanged for non-list, non-wrapped values" do
    changeset =
      WorkspaceTemplate.changeset(%WorkspaceTemplate{}, %{
        name: "Gamba",
        slug: "gamba",
        workflow_statuses: "not-a-list"
      })

    assert changeset.valid?
    assert Ecto.Changeset.get_field(changeset, :workflow_statuses) == %{}
  end

  test "workflow_statuses_list returns items when wrapped" do
    template = %WorkspaceTemplate{workflow_statuses: %{"items" => [%{"name" => "Todo"}]}}
    assert WorkspaceTemplate.workflow_statuses_list(template) == [%{"name" => "Todo"}]
  end

  test "workflow_statuses_list returns empty list for default map" do
    assert WorkspaceTemplate.workflow_statuses_list(%WorkspaceTemplate{}) == []
  end

  test "validation_commands_list returns items when wrapped" do
    template = %WorkspaceTemplate{validation_commands: %{"items" => ["mix test"]}}
    assert WorkspaceTemplate.validation_commands_list(template) == ["mix test"]
  end

  test "validation_commands_list returns empty list for default map" do
    assert WorkspaceTemplate.validation_commands_list(%WorkspaceTemplate{}) == []
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
  end
end
