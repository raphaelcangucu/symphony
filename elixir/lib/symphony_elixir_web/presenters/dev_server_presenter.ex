defmodule SymphonyElixirWeb.DevServerPresenter do
  @moduledoc "JSON DTOs for per-issue dev servers."

  @spec view(map()) :: map()
  def view(%{available: available, reason: reason, servers: servers}) when is_list(servers) do
    %{
      available: available,
      reason: reason(reason),
      servers: Enum.map(servers, &server/1)
    }
  end

  def view(%{"available" => available, "reason" => reason, "servers" => servers}) when is_list(servers) do
    %{
      available: available,
      reason: reason(reason),
      servers: Enum.map(servers, &server/1)
    }
  end

  @spec server(map()) :: map()
  def server(server) when is_map(server) do
    %{
      id: field(server, :id),
      slug: field(server, :slug),
      working_dir: field(server, :working_dir),
      port: field(server, :port),
      url: field(server, :url),
      status: field(server, :status),
      primary: field(server, :primary),
      session_name: field(server, :session_name)
    }
  end

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
