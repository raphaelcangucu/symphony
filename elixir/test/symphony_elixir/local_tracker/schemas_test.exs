defmodule SymphonyElixir.LocalTracker.SchemasTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.{
    ActivityEvent,
    Comment,
    IssueLabel,
    IssueRecord,
    IssueRelation,
    Label,
    Project,
    Seeds,
    WorkflowStatus
  }

  test "project requires name and slug" do
    changeset = Project.changeset(%Project{}, %{})

    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:name]
    assert {"can't be blank", _} = changeset.errors[:slug]
  end

  test "workflow status requires project, name, category, and position" do
    changeset = WorkflowStatus.changeset(%WorkflowStatus{}, %{})

    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:project_id]
    assert {"can't be blank", _} = changeset.errors[:name]
    assert {"can't be blank", _} = changeset.errors[:category]
    assert {"can't be blank", _} = changeset.errors[:position]
  end

  test "issue requires project, status, identifier, title, and position" do
    changeset = IssueRecord.changeset(%IssueRecord{}, %{})

    refute changeset.valid?
    assert {"can't be blank", _} = changeset.errors[:project_id]
    assert {"can't be blank", _} = changeset.errors[:status_id]
    assert {"can't be blank", _} = changeset.errors[:identifier]
    assert {"can't be blank", _} = changeset.errors[:title]
    assert {"can't be blank", _} = changeset.errors[:position]
  end

  test "issue validates priority bounds" do
    attrs = %{
      project_id: 1,
      status_id: 1,
      identifier: "MAC-1",
      title: "Build local tracker",
      position: 0,
      priority: 5
    }

    changeset = IssueRecord.changeset(%IssueRecord{}, attrs)

    refute changeset.valid?
    assert {"must be less than or equal to %{number}", _} = changeset.errors[:priority]
  end

  test "related records validate required fields" do
    refute Comment.changeset(%Comment{}, %{}).valid?
    refute Label.changeset(%Label{}, %{}).valid?
    refute IssueLabel.changeset(%IssueLabel{}, %{}).valid?
    refute IssueRelation.changeset(%IssueRelation{}, %{}).valid?
    refute ActivityEvent.changeset(%ActivityEvent{}, %{}).valid?
  end

  test "default statuses are returned in workflow order" do
    assert Enum.map(Seeds.default_statuses(), &elem(&1, 0)) == [
             "Backlog",
             "Todo",
             "In Progress",
             "Human Review",
             "Merging",
             "Rework",
             "Done"
           ]
  end
end
