defmodule SymphonyElixir.TestSupportTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.{Repo, SharedSupervisor, TestSupport}

  test "truncate_tracker restores the supervised Repo when it was stopped" do
    assert is_pid(Process.whereis(Repo))
    assert :ok = Supervisor.terminate_child(SharedSupervisor, Repo)
    refute Process.whereis(Repo)

    assert :ok = TestSupport.truncate_tracker!()
    assert is_pid(Process.whereis(Repo))
  end
end
