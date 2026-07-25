defmodule SymphonyElixir.Daemon.Systemd.UnitTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.{Paths, Systemd.Unit}

  test "renders restart, drain, cgroup, and absolute path contracts" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})
    unit = Unit.render(paths)

    assert unit =~ "EnvironmentFile=/home/alice/.config/symphony/symphony.env"
    assert unit =~ "ExecStart=/home/alice/.local/lib/symphony/current/bin/symphony-service"
    assert unit =~ "Restart=always"
    assert unit =~ "RestartPreventExitStatus=78"
    assert unit =~ "StartLimitBurst=5"
    assert unit =~ "TimeoutStopSec=330"
    assert unit =~ "KillMode=control-group"
    assert unit =~ "OOMPolicy=continue"
    assert unit =~ "WantedBy=default.target"
  end
end
