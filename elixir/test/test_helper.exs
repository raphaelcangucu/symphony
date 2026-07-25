ExUnit.start()
Code.require_file("support/snapshot_support.exs", __DIR__)
Code.require_file("support/test_support.exs", __DIR__)
Code.require_file("support/git_fixtures.exs", __DIR__)
Code.require_file("support/knowledge_base_test_fixtures.exs", __DIR__)
Code.require_file("support/sqlite_fixtures.exs", __DIR__)

# Ensure the local tracker schema exists before any test runs. Several suites
# only truncate tables in their setup and assume the DB is already migrated;
# running migrations once here removes the cross-suite "no such table" ordering
# dependency on whichever test happens to migrate first.
{:ok, _result, _apps} =
  Ecto.Migrator.with_repo(SymphonyElixir.Repo, fn repo ->
    Ecto.Migrator.run(repo, :up, all: true)
  end)
