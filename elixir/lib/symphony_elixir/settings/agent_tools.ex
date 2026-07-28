defmodule SymphonyElixir.Settings.AgentTools do
  @moduledoc """
  Composes the per-agent settings payload the Tracker Settings UI renders as
  "CLI" pages (status/source/install/model), mirroring the layout of a
  product-grade agent settings panel.

  It joins three sources:
  - `AgentLifecycle.Resolver` for managed/PATH status and explicit fallback.
  - `AgentModels` for the curated model catalog and the operator's selection.
  - `AgentLifecycle.Catalog` for provider lifecycle metadata.
  """

  alias SymphonyElixir.AgentLifecycle.{Catalog, Installer, Resolver}
  alias SymphonyElixir.Settings.AgentModels

  @spec list() :: [map()]
  def list do
    Enum.map(Catalog.kinds(), &present/1)
  end

  defp present(agent) do
    resolution = Resolver.resolve(agent)
    catalog = Catalog.fetch!(agent)

    %{
      id: agent,
      kind: agent,
      status: status(resolution, catalog),
      source: source(resolution),
      install: %{
        available: managed_install_available?(resolution),
        strategy: Atom.to_string(catalog.release.type),
        pending_version: pending_version(agent)
      },
      model: %{
        options: AgentModels.options(agent),
        selected: AgentModels.selected(agent)
      }
    }
  end

  defp status({:ok, resolution}, catalog) do
    %{
      installed: true,
      version: resolution.version,
      path: resolution.executable_path,
      command: catalog.executable
    }
  end

  defp status({:error, reasons}, catalog) do
    %{
      installed: false,
      version: nil,
      path: nil,
      command: catalog.executable,
      detail: reasons
    }
  end

  defp source({:ok, resolution}) do
    %{
      value: Atom.to_string(resolution.effective_source),
      preferred: Atom.to_string(resolution.preferred_source),
      managed: resolution.effective_source == :managed,
      detail: resolution.executable_path,
      fallback_reason: resolution.fallback_reason
    }
  end

  defp source({:error, reasons}) do
    %{
      value: "none",
      preferred: Atom.to_string(reasons.preferred_source),
      managed: false,
      detail: nil,
      fallback_reason: reasons
    }
  end

  defp managed_install_available?({:ok, %{effective_source: :managed}}), do: false
  defp managed_install_available?(_resolution), do: true

  defp pending_version(agent) do
    case Installer.pending(agent) do
      {:ok, %{"version" => version}} -> version
      _ -> nil
    end
  end
end
