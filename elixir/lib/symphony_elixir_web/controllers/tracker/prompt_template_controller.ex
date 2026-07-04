defmodule SymphonyElixirWeb.Tracker.PromptTemplateController do
  @moduledoc "Lists prompt templates for tracker consumers."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.PromptTemplates
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @global_scope "global"

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params), do: render_templates(conn, @global_scope)

  @spec project_index(Conn.t(), map()) :: Conn.t()
  def project_index(conn, %{"project_slug" => project_slug}) do
    case normalize_scope(project_slug) do
      {:ok, scope} -> render_templates(conn, scope)
      {:error, message} -> TrackerErrors.validation_msg(conn, message)
    end
  end

  def project_index(conn, _params), do: TrackerErrors.validation_msg(conn, "project_slug is required")

  defp render_templates(conn, scope) do
    data =
      PromptTemplates.list(scope: scope)
      |> Enum.filter(& &1.enabled)
      |> Enum.map(&TrackerPresenter.prompt_template/1)

    json(conn, %{data: data})
  end

  defp normalize_scope(scope) when is_binary(scope) do
    case String.trim(scope) do
      "" -> {:error, "project_slug is required"}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_scope(_scope), do: {:error, "project_slug is required"}
end
