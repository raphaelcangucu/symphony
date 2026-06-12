defmodule SymphonyElixir.Repo.Migrations.AddHeadBranchToTrackerPullRequests do
  use Ecto.Migration

  def change do
    alter table(:tracker_pull_requests) do
      add(:head_branch, :string)
    end
  end
end
