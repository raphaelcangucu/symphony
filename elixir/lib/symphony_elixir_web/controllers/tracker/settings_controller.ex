defmodule SymphonyElixirWeb.Tracker.SettingsController do
  @moduledoc "Operator settings (spatie-style groups) + agent availability probe."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.AgentAvailability
  alias SymphonyElixir.Settings
  alias SymphonyElixirWeb.TrackerErrors

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params), do: json(conn, %{data: Settings.all()})

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"group" => group} = params) do
    attrs = Map.drop(params, ["group"])

    case put_all(group, attrs) do
      :ok ->
        json(conn, %{data: Settings.get_group(group)})

      {:error, :unknown_group} ->
        conn
        |> Conn.put_status(:not_found)
        |> json(%{error: %{code: "not_found", message: "unknown settings group"}})

      {:error, _name, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, name, reason} ->
        TrackerErrors.validation(conn, "invalid setting #{name}: #{format_reason(reason)}")
    end
  end

  @spec availability(Conn.t(), map()) :: Conn.t()
  def availability(conn, _params) do
    json(conn, %{data: AgentAvailability.probe()})
  end

  # Keys are applied independently (each an immediate upsert); on failure the
  # loop halts and earlier keys REMAIN persisted (no rollback). Deliberate
  # while groups are effectively single-key — revisit if multi-key groups grow.
  defp put_all(group, attrs) do
    Enum.reduce_while(attrs, :ok, fn {name, value}, :ok ->
      case Settings.put(group, name, value) do
        {:ok, _} -> {:cont, :ok}
        {:error, :unknown_group} -> {:halt, {:error, :unknown_group}}
        {:error, reason} -> {:halt, {:error, name, reason}}
      end
    end)
  end

  defp format_reason(reason) when is_atom(reason), do: to_string(reason)
  defp format_reason(reason), do: inspect(reason)
end
