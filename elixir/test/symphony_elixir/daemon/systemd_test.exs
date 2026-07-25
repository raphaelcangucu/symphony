defmodule SymphonyElixir.Daemon.SystemdTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Systemd

  test "show normalizes systemctl properties" do
    runner = fn "systemctl", args, _opts ->
      assert args == [
               "--user",
               "show",
               "symphony.service",
               "--property=LoadState,UnitFileState,ActiveState,SubState,MainPID,NRestarts,Result",
               "--no-pager"
             ]

      {"LoadState=loaded\nUnitFileState=enabled\nActiveState=active\nSubState=running\nMainPID=42\nNRestarts=3\nResult=success\n", 0}
    end

    assert {:ok, info} = Systemd.show("symphony.service", runner: runner)
    assert info["MainPID"] == "42"
    assert info["NRestarts"] == "3"
  end

  test "nonzero commands return a redacted stable error" do
    runner = fn _, _, _ -> {"Failed to connect to bus", 1} end

    assert {:error, {:command_failed, 1, "Failed to connect to bus"}} =
             Systemd.start("symphony.service", runner: runner)
  end
end
