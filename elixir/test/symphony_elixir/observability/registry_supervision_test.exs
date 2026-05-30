defmodule SymphonyElixir.Observability.RegistrySupervisionTest do
  use ExUnit.Case, async: false

  test "registry is started by the application" do
    assert is_pid(Process.whereis(SymphonyElixir.Observability.Registry))
  end
end
