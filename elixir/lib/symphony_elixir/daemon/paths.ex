defmodule SymphonyElixir.Daemon.Paths do
  @moduledoc "Resolves all installed-daemon filesystem paths."

  @enforce_keys [
    :home,
    :config_dir,
    :env_file,
    :unit_file,
    :data_dir,
    :install_manifest,
    :database,
    :backup_dir,
    :state_dir,
    :log_dir,
    :install_root,
    :releases_dir,
    :current_link,
    :launcher,
    :unit_name
  ]
  defstruct @enforce_keys

  @type t :: %__MODULE__{
          home: Path.t(),
          config_dir: Path.t(),
          env_file: Path.t(),
          unit_file: Path.t(),
          data_dir: Path.t(),
          install_manifest: Path.t(),
          database: Path.t(),
          backup_dir: Path.t(),
          state_dir: Path.t(),
          log_dir: Path.t(),
          install_root: Path.t(),
          releases_dir: Path.t(),
          current_link: Path.t(),
          launcher: Path.t(),
          unit_name: String.t()
        }

  @unit_pattern ~r/\A[a-zA-Z0-9_.@-]+\.service\z/

  @spec resolve(map()) :: t()
  def resolve(env \\ System.get_env()) when is_map(env) do
    home = required_home(env)
    config_home = value(env, "XDG_CONFIG_HOME", Path.join(home, ".config"))
    data_home = value(env, "XDG_DATA_HOME", Path.join(home, ".local/share"))
    state_home = value(env, "XDG_STATE_HOME", Path.join(home, ".local/state"))
    install_root = value(env, "SYMPHONY_INSTALL_ROOT", Path.join(home, ".local/lib/symphony"))

    launcher =
      value(
        env,
        "SYMPHONY_LAUNCHER_PATH",
        Path.join([home, ".local", "bin", "symphony"])
      )

    unit_name = string_value(env, "SYMPHONY_DAEMON_UNIT", "symphony.service")

    unless Regex.match?(@unit_pattern, unit_name) do
      raise ArgumentError, "invalid daemon unit name: #{inspect(unit_name)}"
    end

    config_dir =
      value(env, "SYMPHONY_CONFIG_DIR", Path.join(config_home, "symphony"))

    systemd_user_dir =
      value(
        env,
        "SYMPHONY_SYSTEMD_USER_DIR",
        Path.join([config_home, "systemd", "user"])
      )

    data_dir = Path.join(data_home, "symphony")
    state_dir = Path.join(state_home, "symphony")

    %__MODULE__{
      home: home,
      config_dir: config_dir,
      env_file: Path.join(config_dir, "symphony.env"),
      unit_file: Path.join(systemd_user_dir, unit_name),
      data_dir: data_dir,
      install_manifest: Path.join(data_dir, "install.json"),
      database: Path.join(data_dir, "tracker.sqlite3"),
      backup_dir: Path.join(data_dir, "backups"),
      state_dir: state_dir,
      log_dir: Path.join(state_dir, "log"),
      install_root: install_root,
      releases_dir: Path.join(install_root, "releases"),
      current_link: Path.join(install_root, "current"),
      launcher: launcher,
      unit_name: unit_name
    }
  end

  defp required_home(env) do
    case Map.get(env, "HOME") do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _ -> raise ArgumentError, "HOME is required for a user daemon"
    end
  end

  defp value(env, key, default) do
    case Map.get(env, key) do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _ -> Path.expand(default)
    end
  end

  defp string_value(env, key, default) do
    case Map.get(env, key) do
      value when is_binary(value) and value != "" -> value
      _ -> default
    end
  end
end
