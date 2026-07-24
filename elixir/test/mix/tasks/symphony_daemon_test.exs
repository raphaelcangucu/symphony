defmodule Mix.Tasks.Symphony.DaemonTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Daemon, as: Task

  test "parse delegates the daemon command contract" do
    assert {:ok, {:status, %{json: true}}} = Task.parse(["status", "--json"])
  end
end
