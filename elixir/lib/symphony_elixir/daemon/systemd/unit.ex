defmodule SymphonyElixir.Daemon.Systemd.Unit do
  @moduledoc "Pure renderer for the Symphony user service."

  alias SymphonyElixir.Daemon.Paths

  @spec render(Paths.t()) :: String.t()
  def render(%Paths{} = paths) do
    """
    [Unit]
    Description=Symphony daemon
    Wants=network-online.target
    After=network-online.target
    StartLimitIntervalSec=60
    StartLimitBurst=5

    [Service]
    Type=simple
    EnvironmentFile=#{escape(paths.env_file)}
    WorkingDirectory=#{escape(paths.data_dir)}
    ExecStart=#{escape(Path.join(paths.current_link, "bin/symphony-service"))}
    Restart=always
    RestartSec=5
    RestartPreventExitStatus=78
    SuccessExitStatus=0 143
    TimeoutStopSec=330
    KillMode=control-group
    OOMPolicy=continue

    [Install]
    WantedBy=default.target
    """
  end

  defp escape(path) do
    if String.contains?(path, ["\n", "\r", "\0"]) do
      raise ArgumentError, "unsafe systemd path"
    end

    String.replace(path, " ", "\\x20")
  end
end
