defmodule SymphonyElixir.Assistant.ListPreviewTools do
  @moduledoc false

  alias SymphonyElixir.Cloudflare.Tunnel
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.{Manager, Snapshot}

  @tool "list_previews"
  @unhealthy_statuses ~w(crashed pending provisioning starting stopped unknown)
  @next_steps "Inspect unhealthy entries with manage_preview status/output, then restart or fix via manage_dev_env. Do not invent ports or fall back to unmanaged vibe/Compose bring-up outside a fresh manage_preview prepare; cite only in_sync URLs."

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec()]

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    %{
      "name" => @tool,
      "description" =>
        "List active issue previews for the current project (leased Preview dock status, ports, URLs, tunnel). Use manage_preview to act; cite only in_sync ports — do not invent ports or bypass the lease.",
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }
    }
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts)
      when is_binary(project_slug) and is_map(arguments) and is_list(opts) do
    running_issue_keys = Keyword.get(opts, :running_issue_keys, &Manager.running_issue_keys/0)
    issue_targets = Keyword.get(opts, :issue_targets, &DevServer.issue_targets/2)
    tunnel_summary = Keyword.get(opts, :tunnel_summary, &Tunnel.summary_for_project/1)

    previews =
      running_issue_keys.()
      |> Enum.filter(&current_project_key?(&1, project_slug))
      |> Enum.map(fn {_slug, identifier} ->
        preview_entry(project_slug, identifier, issue_targets, tunnel_summary)
      end)

    {:ok,
     %{
       tool: @tool,
       message: "Found #{length(previews)} preview(s) for #{project_slug}.",
       data: %{
         previews: previews,
         next_steps: next_steps(previews)
       }
     }}
  end

  def execute(_project_slug, _arguments, _opts) do
    {:error, {:invalid_list_previews_arguments, "project_slug must be a string, arguments must be a map, and opts must be a keyword list"}}
  end

  defp current_project_key?({project_slug, identifier}, project_slug)
       when is_binary(project_slug) and is_binary(identifier),
       do: true

  defp current_project_key?(_key, _project_slug), do: false

  defp preview_entry(project_slug, identifier, issue_targets, tunnel_summary) do
    case issue_targets.(project_slug, identifier) do
      {:ok, view} when is_map(view) ->
        %{
          identifier: identifier,
          available: map_field(view, :available),
          reason: stringify_reason(map_field(view, :reason)),
          servers: normalize_servers(map_field(view, :servers)),
          tunnel: normalize_tunnel(map_field(view, :tunnel) || tunnel_summary.(project_slug))
        }

      {:ok, _invalid_view} ->
        error_entry(identifier, :invalid_preview_view, tunnel_summary.(project_slug))

      {:error, reason} ->
        error_entry(identifier, reason, tunnel_summary.(project_slug))

      other ->
        error_entry(identifier, {:unexpected_preview_result, other}, tunnel_summary.(project_slug))
    end
  end

  defp error_entry(identifier, reason, tunnel) do
    %{
      identifier: identifier,
      available: false,
      reason: stringify_reason(reason),
      servers: [],
      tunnel: normalize_tunnel(tunnel)
    }
  end

  defp next_steps(previews) do
    if Enum.any?(previews, &unhealthy?/1), do: @next_steps
  end

  defp unhealthy?(%{available: false}), do: true

  defp unhealthy?(%{servers: servers}) when is_list(servers) do
    Enum.any?(servers, fn server -> Map.get(server, :status) in @unhealthy_statuses end)
  end

  defp unhealthy?(_preview), do: false

  defp normalize_servers(servers) when is_list(servers), do: Enum.map(servers, &normalize_server/1)
  defp normalize_servers(_servers), do: []

  defp normalize_server(server) when is_map(server) do
    port = map_field(server, :port)
    slug = map_field(server, :slug)

    %{
      id: normalize_id(map_field(server, :id)),
      slug: stringify_optional(slug),
      status: stringify_reason(map_field(server, :status) || "unknown"),
      port: port,
      primary: map_field(server, :primary) == true,
      local_url: map_field(server, :local_url) || Snapshot.local_url(port, %{slug: slug}),
      public_url: map_field(server, :public_url) || map_field(server, :url)
    }
  end

  defp normalize_server(_server) do
    %{
      id: nil,
      slug: nil,
      status: "unknown",
      port: nil,
      primary: false,
      local_url: nil,
      public_url: nil
    }
  end

  defp normalize_tunnel(tunnel) when is_map(tunnel) do
    %{
      enabled: map_field(tunnel, :enabled) == true,
      running: map_field(tunnel, :running) == true
    }
  end

  defp normalize_tunnel(_tunnel), do: %{enabled: false, running: false}

  defp normalize_id(id) when is_integer(id), do: id

  defp normalize_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {parsed, ""} -> parsed
      _invalid -> nil
    end
  end

  defp normalize_id(_id), do: nil

  defp map_field(map, key) when is_map(map) and is_atom(key) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end

  defp stringify_reason(nil), do: nil
  defp stringify_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp stringify_reason(reason) when is_binary(reason), do: reason
  defp stringify_reason(reason), do: inspect(reason)

  defp stringify_optional(nil), do: nil
  defp stringify_optional(value), do: stringify_reason(value)
end
