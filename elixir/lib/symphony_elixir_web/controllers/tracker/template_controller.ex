defmodule SymphonyElixirWeb.Tracker.TemplateController do
  @moduledoc "CRUD + import/export + instantiate for workspace templates."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Templates
  alias SymphonyElixirWeb.{TemplatePresenter, TrackerErrors, TrackerPresenter}

  @save_as_template_keys ~w(name slug description dev_env_markdown)

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: Enum.map(Templates.list_templates(), &TemplatePresenter.template/1)})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    case Templates.create_template(params) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, %Ecto.Changeset{} = changeset} -> TrackerErrors.render(conn, changeset)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"slug" => slug}) do
    case Templates.get_template(slug) do
      {:ok, template} -> json(conn, %{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"slug" => slug} = params) do
    case Templates.update_template(slug, Map.delete(params, "slug")) do
      {:ok, template} -> json(conn, %{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"slug" => slug}) do
    case Templates.delete_template(slug) do
      {:ok, _} -> send_resp(conn, :no_content, "")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec import(Conn.t(), map()) :: Conn.t()
  def import(conn, %{"yaml" => yaml}) when is_binary(yaml) do
    case Templates.import_yaml(yaml) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, :invalid_yaml} -> TrackerErrors.validation_msg(conn, "Invalid YAML")
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec export(Conn.t(), map()) :: Conn.t()
  def export(conn, %{"slug" => slug}) do
    case Templates.export_yaml(slug) do
      {:ok, yaml} -> conn |> put_resp_content_type("text/yaml") |> send_resp(200, yaml)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec instantiate(Conn.t(), map()) :: Conn.t()
  def instantiate(conn, %{"template_slug" => slug} = params) do
    attrs = Map.delete(params, "template_slug")

    case Templates.instantiate_template(slug, attrs) do
      {:ok, project} ->
        Templates.start_clone_jobs(project.slug)
        conn |> put_status(:created) |> json(%{data: TrackerPresenter.project(project)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec save_as_template(Conn.t(), map()) :: Conn.t()
  def save_as_template(conn, %{"project_slug" => project_slug} = params) do
    overrides = params |> Map.take(@save_as_template_keys) |> atomize()

    case Templates.save_project_as_template(project_slug, overrides) do
      {:ok, template} -> conn |> put_status(:created) |> json(%{data: TemplatePresenter.template(template)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp atomize(map), do: Map.new(map, fn {k, v} -> {String.to_existing_atom(k), v} end)
end
