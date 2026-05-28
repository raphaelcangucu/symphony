defmodule SymphonyElixir.LocalTracker.CloneJobTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.CloneJob

  test "changeset validates status inclusion" do
    valid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "pending"})
    assert valid.valid?

    invalid = CloneJob.changeset(%CloneJob{}, %{project_id: 1, repository_id: 1, status: "bogus"})
    refute invalid.valid?
  end
end
