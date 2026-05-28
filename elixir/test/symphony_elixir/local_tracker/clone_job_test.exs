defmodule SymphonyElixir.LocalTracker.CloneJobTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.CloneJob

  test "changeset validates status inclusion" do
    valid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "pending"})
    assert valid.valid?

    invalid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "bogus"})
    refute invalid.valid?
  end

  test "changeset requires project_id, repository_id, and status" do
    changeset = CloneJob.changeset(%CloneJob{status: nil}, %{})
    refute changeset.valid?

    errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
    assert Map.has_key?(errors, :project_id)
    assert Map.has_key?(errors, :repository_id)
    assert Map.has_key?(errors, :status)
  end

  test "statuses/0 exposes the allowed status values" do
    assert CloneJob.statuses() == ~w(pending running succeeded failed skipped)
  end
end
