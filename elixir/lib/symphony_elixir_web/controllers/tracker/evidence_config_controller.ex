defmodule SymphonyElixirWeb.Tracker.EvidenceConfigController do
  @moduledoc """
  Propose/save the per-repo `evidence` config for a project. `propose` scans the
  workspace repositories and returns a suggested config; `save` persists an
  (operator-reviewed) config into the project's workflow front matter.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Evidence.Proposer
  alias SymphonyElixirWeb.TrackerErrors

  @spec propose(Conn.t(), map()) :: Conn.t()
  def propose(conn, %{"project_slug" => project_slug}) do
    case Proposer.propose_for_project(project_slug) do
      {:ok, evidence} -> json(conn, %{data: present(evidence)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec save(Conn.t(), map()) :: Conn.t()
  def save(conn, %{"project_slug" => project_slug, "evidence" => %{} = evidence}) do
    case Proposer.save_for_project(project_slug, atomize_evidence(evidence)) do
      {:ok, _setup} -> json(conn, %{data: present(evidence)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  # The proposed/saved config is plain JSON-able data; reflect it back so the UI
  # can render exactly what will be written.
  defp present(evidence), do: evidence

  # Accept either string- or atom-keyed `required`; the per-repo body is passed
  # through (the proposer deep-stringifies before serializing to YAML anyway).
  defp atomize_evidence(%{} = evidence) do
    %{}
    |> maybe_put(:required, Map.get(evidence, "required", Map.get(evidence, :required)))
    |> maybe_put(:repos, Map.get(evidence, "repos", Map.get(evidence, :repos)) || %{})
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
