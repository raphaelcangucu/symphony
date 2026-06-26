defmodule SymphonyElixir.KnowledgeBase.FtsAvailabilityTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  test "SQLite build has FTS5 enabled" do
    assert {:ok, _} = Repo.query("CREATE VIRTUAL TABLE temp.kb_fts_probe USING fts5(x)")
    assert {:ok, _} = Repo.query("DROP TABLE temp.kb_fts_probe")
  end
end
