defmodule SymphonyElixirWeb.DevServerPresenter do
  @moduledoc "JSON DTOs for per-issue dev servers, rendered from a PreviewSnapshot."

  @spec view(map()) :: map()
  def view(snapshot) when is_map(snapshot) do
    servers = field(snapshot, :servers) || []

    base = %{
      available: field(snapshot, :available),
      reason: reason(field(snapshot, :reason)),
      servers: Enum.map(servers, &server/1)
    }

    base
    |> maybe_put(:snapshot_id, field(snapshot, :snapshot_id))
    |> maybe_put(:as_of, as_of(field(snapshot, :as_of)))
    |> maybe_put(:tunnel, tunnel(field(snapshot, :tunnel)))
  end

  @spec server(map()) :: map()
  def server(server) when is_map(server) do
    %{
      id: field(server, :id),
      slug: field(server, :slug),
      working_dir: field(server, :working_dir),
      port: field(server, :port),
      url: field(server, :url),
      local_url: field(server, :local_url),
      public_url: field(server, :public_url),
      status: field(server, :status),
      primary: field(server, :primary),
      session_name: field(server, :session_name),
      source: reason(field(server, :source)),
      sync_state: reason(field(server, :sync_state)),
      sync_reason: field(server, :sync_reason),
      preferred_port: field(server, :preferred_port),
      allowed_ports: field(server, :allowed_ports),
      actual_port: field(server, :actual_port),
      contract_id: field(server, :contract_id),
      revision: field(server, :revision)
    }
  end

  defp tunnel(nil), do: nil

  defp tunnel(tunnel) when is_map(tunnel) do
    %{enabled: field(tunnel, :enabled) == true, running: field(tunnel, :running) == true}
  end

  defp as_of(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp as_of(value) when is_binary(value), do: value
  defp as_of(_value), do: nil

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp reason(nil), do: nil
  defp reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp reason(reason) when is_binary(reason), do: reason
  defp reason(reason), do: inspect(reason)

  defp field(server, key) do
    string_key = Atom.to_string(key)

    cond do
      Map.has_key?(server, key) -> Map.get(server, key)
      Map.has_key?(server, string_key) -> Map.get(server, string_key)
      true -> nil
    end
  end
end
