defmodule SymphonyElixir.Daemon.PathsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Paths

  test "defaults every persistent path under the user home" do
    paths = Paths.resolve(%{"HOME" => "/home/alice"})

    assert paths.config_dir == "/home/alice/.config/symphony"
    assert paths.env_file == "/home/alice/.config/symphony/symphony.env"
    assert paths.unit_file == "/home/alice/.config/systemd/user/symphony.service"
    assert paths.data_dir == "/home/alice/.local/share/symphony"
    assert paths.database == "/home/alice/.local/share/symphony/tracker.sqlite3"
    assert paths.backup_dir == "/home/alice/.local/share/symphony/backups"
    assert paths.state_dir == "/home/alice/.local/state/symphony"
    assert paths.log_dir == "/home/alice/.local/state/symphony/log"
    assert paths.releases_dir == "/home/alice/.local/lib/symphony/releases"
    assert paths.current_link == "/home/alice/.local/lib/symphony/current"
    assert paths.launcher == "/home/alice/.local/bin/symphony"
  end

  test "honors XDG roots and an isolated unit name" do
    paths =
      Paths.resolve(%{
        "HOME" => "/home/alice",
        "XDG_CONFIG_HOME" => "/cfg",
        "XDG_DATA_HOME" => "/data",
        "XDG_STATE_HOME" => "/state",
        "SYMPHONY_CONFIG_DIR" => "/private/config",
        "SYMPHONY_SYSTEMD_USER_DIR" => "/systemd/user",
        "SYMPHONY_LAUNCHER_PATH" => "/private/bin/symphony",
        "SYMPHONY_INSTALL_ROOT" => "/opt/user/symphony",
        "SYMPHONY_DAEMON_UNIT" => "symphony-acceptance.service"
      })

    assert paths.env_file == "/private/config/symphony.env"
    assert paths.database == "/data/symphony/tracker.sqlite3"
    assert paths.log_dir == "/state/symphony/log"
    assert paths.releases_dir == "/opt/user/symphony/releases"
    assert paths.launcher == "/private/bin/symphony"
    assert paths.unit_file == "/systemd/user/symphony-acceptance.service"
  end

  test "rejects a missing home and unsafe unit names" do
    assert_raise ArgumentError, ~r/HOME/, fn -> Paths.resolve(%{}) end

    assert_raise ArgumentError, ~r/unit name/, fn ->
      Paths.resolve(%{
        "HOME" => "/home/alice",
        "SYMPHONY_DAEMON_UNIT" => "../escape.service"
      })
    end
  end
end
