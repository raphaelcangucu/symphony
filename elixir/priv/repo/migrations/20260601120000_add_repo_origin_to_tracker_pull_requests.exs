defmodule SymphonyElixir.Repo.Migrations.AddRepoOriginToTrackerPullRequests do
  use Ecto.Migration

  def up do
    alter table(:tracker_pull_requests) do
      add(:repo, :string)
      add(:origin, :string, null: false, default: "auto")
    end

    # Backfill repo from the PR url: https://github.com/<owner>/<name>/pull/<n>
    execute("""
    UPDATE tracker_pull_requests
    SET repo = (
      SELECT substr(
        url,
        length('https://github.com/') + 1,
        instr(substr(url, length('https://github.com/') + 1), '/pull/') - 1
      )
    )
    WHERE url LIKE 'https://github.com/%/pull/%' AND repo IS NULL
    """)
  end

  def down do
    alter table(:tracker_pull_requests) do
      remove(:repo)
      remove(:origin)
    end
  end
end
