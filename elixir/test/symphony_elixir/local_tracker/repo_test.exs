defmodule SymphonyElixir.LocalTracker.RepoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo

  test "repo can run a SQLite query" do
    assert %{rows: [[1]]} = Repo.query!("select 1")
  end
end
