defmodule SymphonyElixirWeb.Tracker.RunPromptTemplateController do
  @moduledoc "Dispatches a rendered prompt template against an issue."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.{IssueDispatch, PromptTemplates}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    with {:ok, slug} <- fetch_slug(params),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]),
         {:ok, template} <- fetch_template(slug, project_slug),
         instructions <- PromptTemplates.render(template, %{issue: TrackerPresenter.issue(issue)}),
         {:ok, result} <-
           IssueDispatch.resume(
             project,
             identifier,
             dispatch_opts(params, template, project_slug, identifier, instructions)
           ) do
      json(conn, %{data: Map.put(result, :ok, true)})
    else
      {:error, :missing_slug} ->
        TrackerErrors.validation_msg(conn, "slug is required")

      {:error, :template_not_found} ->
        TrackerErrors.render(conn, :template_not_found)

      {:error, :template_disabled} ->
        TrackerErrors.validation(conn, "prompt template is disabled")

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params), do: TrackerErrors.validation_msg(conn, "slug is required")

  defp fetch_slug(%{"slug" => slug}) when is_binary(slug) do
    case String.trim(slug) do
      "" -> {:error, :missing_slug}
      trimmed -> {:ok, trimmed}
    end
  end

  defp fetch_slug(_params), do: {:error, :missing_slug}

  defp fetch_template(slug, project_slug) do
    case PromptTemplates.get_by_slug(slug, scope: project_slug) do
      nil ->
        {:error, :template_not_found}

      %{enabled: false} ->
        {:error, :template_disabled}

      template ->
        {:ok, template}
    end
  end

  defp dispatch_opts(params, template, project_slug, identifier, instructions) do
    issue_settings = fetch_issue_settings(project_slug, identifier)

    %{
      instructions: instructions,
      agent: resolve_opt(Map.get(params, "agent"), template.agent_kind, Map.get(issue_settings, :agent_kind)),
      model: resolve_opt(Map.get(params, "model"), template.model, Map.get(issue_settings, :model)),
      effort: resolve_opt(Map.get(params, "effort"), template.effort, Map.get(issue_settings, :effort)),
      mode: resolve_opt(Map.get(params, "mode"), template.mode, Map.get(issue_settings, :mode))
    }
  end

  defp fetch_issue_settings(project_slug, identifier) do
    case Context.get_agent_settings(project_slug, identifier) do
      {:ok, settings} -> settings
      {:error, :not_found} -> %{}
    end
  end

  defp resolve_opt(primary, secondary, tertiary) do
    primary
    |> normalize_optional_string()
    |> case do
      nil ->
        secondary
        |> normalize_optional_string()
        |> case do
          nil -> normalize_optional_string(tertiary)
          value -> value
        end

      value ->
        value
    end
  end

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil
end
