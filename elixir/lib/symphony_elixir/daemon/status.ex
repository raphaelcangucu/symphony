defmodule SymphonyElixir.Daemon.Status do
  @moduledoc "Composes service, listener, health, and configuration drift."

  alias SymphonyElixir.Daemon.{
    HealthProbe,
    Listener,
    Manifest,
    Paths,
    Systemd,
    Systemd.Unit
  }

  @type state :: :healthy | :unhealthy | :inactive | :uninstalled

  @type t :: %{
          state: state(),
          installed?: boolean(),
          enabled?: boolean(),
          active?: boolean(),
          listening?: boolean(),
          healthy?: boolean(),
          main_pid: non_neg_integer() | nil,
          restart_count: non_neg_integer(),
          health: map() | nil,
          drift: [atom()],
          linger?: boolean(),
          service: map()
        }

  @spec inspect(Paths.t(), keyword()) :: {:ok, t()}
  def inspect(%Paths{} = paths, opts \\ []) do
    host = Keyword.get(opts, :host, "127.0.0.1")
    port = Keyword.get(opts, :port, 4_000)
    deps = Map.merge(default_deps(opts), Map.new(Keyword.get(opts, :deps, %{})))

    manifest = result_map(deps.manifest.(paths.install_manifest))
    installed_unit = result_value(deps.unit_contents.(paths.unit_file))
    expected_unit = deps.expected_unit.(paths)
    service = result_map(deps.service.(paths.unit_name)) || %{}
    main_pid = positive_integer(service["MainPID"])
    restart_count = non_negative_integer(service["NRestarts"])
    listener_pids = listener_pids(deps.listener.(port))
    health = result_map(deps.health.(host, port))
    linger? = deps.linger.() == {:ok, true}

    installed? = not is_nil(manifest) or service["LoadState"] == "loaded"
    enabled? = service["UnitFileState"] == "enabled"
    active? = service["ActiveState"] == "active"
    listening? = listener_pids != []

    drift =
      []
      |> maybe_drift(installed_unit != expected_unit, :unit)
      |> maybe_drift(listener_pids != [] and main_pid not in listener_pids, :foreign_listener)
      |> maybe_drift(value(health, "version") != value(manifest, "version"), :version)
      |> maybe_drift(commit_drift?(health, manifest), :commit)
      |> Enum.reverse()

    healthy? =
      active? and is_integer(main_pid) and main_pid in listener_pids and
        value(health, "status") == "ok" and
        Enum.all?([:unit, :foreign_listener, :version, :commit], &(&1 not in drift))

    state =
      cond do
        not installed? -> :uninstalled
        not active? -> :inactive
        healthy? -> :healthy
        true -> :unhealthy
      end

    {:ok,
     %{
       state: state,
       installed?: installed?,
       enabled?: enabled?,
       active?: active?,
       listening?: listening?,
       healthy?: healthy?,
       main_pid: main_pid,
       restart_count: restart_count,
       health: health,
       drift: drift,
       linger?: linger?,
       service: service
     }}
  end

  defp default_deps(opts) do
    systemd_opts = Keyword.get(opts, :systemd_opts, [])
    listener_opts = Keyword.get(opts, :listener_opts, [])
    health_timeout = Keyword.get(opts, :health_timeout, 2_000)
    user = System.get_env("USER") || ""

    %{
      manifest: &Manifest.read/1,
      unit_contents: &File.read/1,
      expected_unit: &Unit.render/1,
      service: &Systemd.show(&1, systemd_opts),
      listener: &Listener.probe(&1, listener_opts),
      health: &HealthProbe.get(&1, &2, health_timeout),
      linger: fn -> Systemd.linger(user, systemd_opts) end
    }
  end

  defp result_map({:ok, %{} = value}), do: value
  defp result_map(_result), do: nil

  defp result_value({:ok, value}) when is_binary(value), do: value
  defp result_value(_result), do: nil

  defp listener_pids({:owned, pids}) when is_list(pids), do: pids
  defp listener_pids(_result), do: []

  defp positive_integer(value) do
    case Integer.parse(to_string(value || "")) do
      {integer, ""} when integer > 0 -> integer
      _ -> nil
    end
  end

  defp non_negative_integer(value) do
    case Integer.parse(to_string(value || "")) do
      {integer, ""} when integer >= 0 -> integer
      _ -> 0
    end
  end

  defp value(%{} = map, key), do: map[key]
  defp value(_map, _key), do: nil

  defp commit_drift?(health, manifest) do
    health_commit = value(health, "git_commit")
    manifest_commit = value(manifest, "git_commit")

    health_commit not in [nil, "unknown"] and
      manifest_commit not in [nil, "unknown"] and
      health_commit != manifest_commit
  end

  defp maybe_drift(drift, true, name), do: [name | drift]
  defp maybe_drift(drift, false, _name), do: drift
end
