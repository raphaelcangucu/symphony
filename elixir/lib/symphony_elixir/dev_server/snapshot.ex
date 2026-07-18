defmodule SymphonyElixir.DevServer.Snapshot do
  @moduledoc """
  Single authoritative read-model for an issue's preview.

  Combines availability, the accepted runtime (the `DevServerRecord` mirror), the
  active runtime contract (source, allowed ports, sync state), serve-step URL
  paths, and the project tunnel into one snapshot. Every consumer — REST/SSE, the
  Tracker preview dock, the `manage_preview`/`list_previews` tools, and the prompt
  — renders this same shape instead of re-deriving ports or URLs on its own.

  `local_url/2` is the *only* place preview URLs are constructed. Consumers that
  receive a raw view (e.g. injected in tests) call it directly so there is a
  single URL heuristic across the whole system.
  """

  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer.{Manager, RuntimeContractStore}
  alias SymphonyElixir.LocalTracker.{Context, DevEnv}
  alias SymphonyElixir.ProjectConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace

  @loopback "127.0.0.1"
  @admin_marker "admin"
  @default_local_path "/api/health"
  @awaiting_statuses ~w(stopped pending provisioning starting stalled)

  @type sync_state :: :in_sync | :awaiting_report | :conflict | :not_ready | :stale | nil

  @type t :: %{
          snapshot_id: String.t(),
          as_of: DateTime.t(),
          project_slug: String.t(),
          identifier: String.t(),
          available: boolean(),
          reason: nil | atom(),
          tunnel: %{enabled: boolean(), running: boolean()},
          servers: [map()]
        }

  @spec build(String.t(), String.t()) :: {:ok, t()} | {:error, :project_not_found}
  def build(project_slug, identifier) when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, project} <- Context.get_project(project_slug) do
      identifier = canonical_identifier(identifier)
      project = Repo.preload(project, :setup)
      config = ProjectConfig.resolve(project)
      serve_steps = DevEnv.list_serve_steps(project_slug)
      records = Manager.list_for_issue(project_slug, identifier)
      contracts = index_contracts(project, identifier)

      servers = Enum.map(records, &server_snapshot(&1, serve_steps, contracts))
      {available, reason} = availability(project_slug, identifier, config, serve_steps)

      {:ok,
       %{
         snapshot_id: generate_snapshot_id(),
         as_of: DateTime.utc_now(),
         project_slug: project_slug,
         identifier: identifier,
         available: available,
         reason: reason,
         tunnel: Tunnel.summary_for_project(project_slug),
         servers: servers
       }}
    end
  end

  def build(_project_slug, _identifier), do: {:error, :project_not_found}

  @doc """
  Build the canonical local preview URL for a port, honoring the serve step's
  readiness/URL paths and falling back to slug-aware defaults. Returns `nil` when
  the port is not a usable integer. This is the single URL heuristic in the
  system; every consumer routes through it.
  """
  @spec local_url(term(), map() | nil) :: String.t() | nil
  def local_url(port, step) when is_integer(port) and port > 0 do
    ready_path = fetch(step, :ready_path)
    url_path = fetch(step, :url_path)
    slug = step |> fetch(:slug) |> to_string()

    cond do
      is_binary(ready_path) and ready_path != "" ->
        "http://#{@loopback}:#{port}#{normalize_path(ready_path)}"

      is_binary(url_path) and url_path != "" ->
        "http://#{@loopback}:#{port}#{normalize_path(url_path)}"

      String.contains?(slug, @admin_marker) ->
        "http://#{@loopback}:#{port}/"

      true ->
        "http://#{@loopback}:#{port}#{@default_local_path}"
    end
  end

  def local_url(_port, _step), do: nil

  @doc "Derive the contract sync state from the accepted runtime status and port."
  @spec sync_state(term(), term(), [integer()]) :: {sync_state(), String.t() | nil}
  def sync_state(status, port, allowed_ports) when is_list(allowed_ports) do
    cond do
      status == "ready" and is_integer(port) and port in allowed_ports ->
        {:in_sync, nil}

      status == "ready" ->
        {:conflict, "actual port #{inspect(port)} is outside allowed ports #{inspect(allowed_ports)}"}

      status == "crashed" ->
        {:not_ready, nil}

      status in @awaiting_statuses ->
        {:awaiting_report, nil}

      true ->
        {:awaiting_report, nil}
    end
  end

  defp index_contracts(%{id: project_id}, identifier) when is_integer(project_id) do
    project_id
    |> RuntimeContractStore.list_for_issue(identifier)
    |> Map.new(fn record -> {record.server_slug, record} end)
  end

  defp server_snapshot(server, serve_steps, contracts) do
    slug = fetch(server, :slug)
    port = fetch(server, :port)
    status = fetch(server, :status)
    step = find_serve_step(serve_steps, server, slug)
    public_url = fetch(server, :url)

    server
    |> Map.put(:local_url, local_url(port, url_step(step, slug)))
    |> Map.put(:public_url, public_url)
    |> put_contract_fields(Map.get(contracts, slug), port, status)
  end

  defp url_step(step, slug) when is_map(step) do
    %{
      slug: slug,
      ready_path: fetch(step, :ready_path),
      url_path: fetch(step, :url_path)
    }
  end

  defp url_step(_step, slug), do: %{slug: slug}

  defp put_contract_fields(server, nil, _port, _status), do: server

  defp put_contract_fields(server, contract, port, status) do
    allowed = contract.allowed_ports || []
    {state, reason} = sync_state(status, port, allowed)

    server
    |> Map.put(:source, contract.source)
    |> Map.put(:contract_id, contract.contract_id)
    |> Map.put(:revision, contract.revision)
    |> Map.put(:preferred_port, contract.preferred_port)
    |> Map.put(:allowed_ports, allowed)
    |> Map.put(:actual_port, port)
    |> Map.put(:sync_state, state)
    |> Map.put(:sync_reason, reason)
  end

  defp availability(project_slug, identifier, config, serve_steps) do
    cond do
      not ProjectConfig.dev_server_enabled?(config) -> {false, :disabled}
      not issue_workspace_exists?(project_slug, identifier) -> {false, :workspace_missing}
      serve_steps == [] -> {false, :no_serve_step}
      true -> {true, nil}
    end
  end

  defp issue_workspace_exists?(project_slug, identifier) do
    identifier
    |> String.trim_leading("#")
    |> then(&Workspace.path_for_issue(%{identifier: &1, project_slug: project_slug}))
    |> File.dir?()
  end

  defp find_serve_step(serve_steps, server, slug) when is_list(serve_steps) do
    working_dir = fetch(server, :working_dir)

    Enum.find(serve_steps, fn step ->
      step_slug = fetch(step, :slug)
      step_dir = fetch(step, :working_dir)

      (is_binary(step_slug) and step_slug == slug) or
        (is_binary(working_dir) and working_dir != "" and step_dir == working_dir)
    end)
  end

  defp find_serve_step(_serve_steps, _server, _slug), do: nil

  defp normalize_path("/" <> _ = path), do: path
  defp normalize_path(path) when is_binary(path), do: "/" <> path
  defp normalize_path(_path), do: "/"

  defp fetch(map, key) when is_map(map) and is_atom(key) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end

  defp fetch(_map, _key), do: nil

  defp canonical_identifier(identifier) when is_binary(identifier) do
    identifier |> String.trim() |> String.trim_leading("#")
  end

  defp generate_snapshot_id do
    "snap_" <> (Ecto.UUID.generate() |> String.replace("-", ""))
  end
end
