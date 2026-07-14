defmodule SymphonyElixirWeb.Tracker.WorkspaceProvisionController do
  @moduledoc """
  Idempotent (re)provisioning of an issue's workspace.

  POSTing joins the active single-flight in `Workspace.Provision` when one
  is already in progress for this path, and starts a fresh attempt when the
  workspace is missing or was left incomplete by a previous failed attempt.
  Safe to call repeatedly, including concurrently, from a "Try again"
  affordance in the tracker UI.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace
  alias SymphonyElixir.Workspace.Provision
  alias SymphonyElixirWeb.TrackerErrors

  @ensure_fun_env :workspace_provision_ensure_fun

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier})
      when is_binary(project_slug) and is_binary(identifier) do
    with {:ok, _issue} <- Context.get_issue(project_slug, identifier) do
      issue_ref = issue_workspace_ref(project_slug, identifier)
      workspace = Workspace.path_for_issue(issue_ref)

      case ensure_fun().(workspace, issue_ref) do
        {:ok, path} ->
          json(conn, %{data: %{workspace_path: path, status: "ready"}})

        {:error, reason} ->
          TrackerErrors.render(conn, Provision.classify_error(reason))
      end
    else
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params) do
    TrackerErrors.validation_msg(conn, "project_slug and identifier are required")
  end

  defp issue_workspace_ref(project_slug, identifier) do
    %{id: nil, identifier: identifier, project_slug: project_slug}
  end

  # Overridable in tests (see @ensure_fun_env) so the structured-error mapping
  # can be exercised without depending on real disk/hook side effects.
  defp ensure_fun do
    Application.get_env(:symphony_elixir, @ensure_fun_env, &Workspace.ensure_at/2)
  end
end
