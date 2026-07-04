defmodule SymphonyElixir.PromptTemplates do
  @moduledoc """
  CRUD, rendering, and built-in seeding for prompt templates.
  """

  import Ecto.Query

  alias SymphonyElixir.PromptTemplates.{Builtin, Template}
  alias SymphonyElixir.Repo

  @render_opts [strict_filters: true]
  @global_scope "global"

  @type scope :: String.t()

  @spec list(keyword()) :: [Template.t()]
  def list(opts \\ []) when is_list(opts) do
    case fetch_scope(opts) do
      @global_scope -> list_scope(@global_scope)
      project_scope -> merge_scopes(project_scope)
    end
  end

  @spec get_by_slug(String.t(), keyword()) :: Template.t() | nil
  def get_by_slug(slug, opts \\ [])

  def get_by_slug(slug, opts) when is_binary(slug) and is_list(opts) do
    normalized_slug = normalize_required_string(slug, "slug")

    case fetch_scope(opts) do
      @global_scope ->
        get_by_slug_and_scope(normalized_slug, @global_scope)

      project_scope ->
        get_by_slug_and_scope(normalized_slug, project_scope) ||
          get_by_slug_and_scope(normalized_slug, @global_scope)
    end
  end

  def get_by_slug(_slug, _opts), do: raise(ArgumentError, "slug must be a non-empty string")

  @spec create(map()) :: {:ok, Template.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    %Template{}
    |> Template.changeset(attrs)
    |> Repo.insert()
  end

  def create(_attrs), do: raise(ArgumentError, "template attrs must be a map")

  @spec update(Template.t(), map()) :: {:ok, Template.t()} | {:error, Ecto.Changeset.t()}
  def update(%Template{} = template, attrs) when is_map(attrs) do
    template
    |> Template.changeset(attrs)
    |> Repo.update()
  end

  def update(%Template{}, _attrs), do: raise(ArgumentError, "template attrs must be a map")
  def update(_template, _attrs), do: raise(ArgumentError, "template must be a PromptTemplates.Template struct")

  @spec delete(Template.t()) :: {:ok, Template.t()} | {:error, :built_in_template | Ecto.Changeset.t()}
  def delete(%Template{built_in: true}), do: {:error, :built_in_template}
  def delete(%Template{} = template), do: Repo.delete(template)
  def delete(_template), do: raise(ArgumentError, "template must be a PromptTemplates.Template struct")

  @spec render(Template.t(), map()) :: String.t()
  def render(%Template{body: body}, context) when is_binary(body) and is_map(context) do
    body
    |> parse_template!()
    |> Solid.render!(to_solid_map(context), @render_opts)
    |> IO.iodata_to_binary()
    |> ensure_utf8()
  end

  def render(%Template{}, _context), do: raise(ArgumentError, "render context must be a map")
  def render(_template, _context), do: raise(ArgumentError, "template must be a PromptTemplates.Template struct")

  @spec ensure_builtins() :: :ok
  def ensure_builtins do
    Repo.transaction(fn ->
      Enum.each(Builtin.all(), &upsert_builtin!/1)
    end)

    :ok
  end

  defp merge_scopes(project_scope) do
    globals = list_scope(@global_scope)
    project_templates = list_scope(project_scope)
    project_slugs = MapSet.new(Enum.map(project_templates, & &1.slug))

    globals
    |> Enum.reject(&MapSet.member?(project_slugs, &1.slug))
    |> Kernel.++(project_templates)
    |> sort_templates()
  end

  defp list_scope(scope) do
    Template
    |> where([template], template.scope == ^scope)
    |> order_by([template], asc: template.position, asc: template.slug, asc: template.id)
    |> Repo.all()
  end

  defp sort_templates(templates) do
    Enum.sort_by(templates, fn template ->
      {template.position || 0, template.slug || "", template.id || 0}
    end)
  end

  defp get_by_slug_and_scope(slug, scope), do: Repo.get_by(Template, slug: slug, scope: scope)

  defp upsert_builtin!(attrs) when is_map(attrs) do
    scope = normalize_required_string(Map.get(attrs, :scope), "built-in scope")
    slug = normalize_required_string(Map.get(attrs, :slug), "built-in slug")

    case Repo.get_by(Template, scope: scope, slug: slug) do
      nil ->
        %Template{}
        |> Template.changeset(attrs)
        |> Repo.insert!()

      %Template{built_in: true} = existing ->
        existing
        |> Template.changeset(attrs)
        |> Repo.update!()

      %Template{} ->
        :ok
    end
  end

  defp parse_template!(prompt) when is_binary(prompt) do
    Solid.parse!(prompt)
  rescue
    error ->
      reraise %RuntimeError{
                message: "template_parse_error: #{Exception.message(error)} template=#{inspect(prompt)}"
              },
              __STACKTRACE__
  end

  defp fetch_scope(opts) do
    opts
    |> Keyword.get(:scope, @global_scope)
    |> normalize_required_string("scope")
  end

  defp normalize_required_string(value, field_name) when is_binary(value) do
    case String.trim(value) do
      "" -> raise(ArgumentError, "#{field_name} must be a non-empty string")
      trimmed -> trimmed
    end
  end

  defp normalize_required_string(_value, field_name), do: raise(ArgumentError, "#{field_name} must be a non-empty string")

  defp to_solid_map(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), to_solid_value(value)} end)
  end

  defp to_solid_value(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp to_solid_value(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp to_solid_value(%Date{} = value), do: Date.to_iso8601(value)
  defp to_solid_value(%Time{} = value), do: Time.to_iso8601(value)
  defp to_solid_value(%_{} = value), do: value |> Map.from_struct() |> to_solid_map()
  defp to_solid_value(value) when is_map(value), do: to_solid_map(value)
  defp to_solid_value(value) when is_list(value), do: Enum.map(value, &to_solid_value/1)
  defp to_solid_value(value), do: value

  defp ensure_utf8(binary) when is_binary(binary) do
    if String.valid?(binary) do
      binary
    else
      binary
      |> :unicode.characters_to_binary(:latin1, :utf8)
      |> case do
        result when is_binary(result) -> result
        _ -> String.replace(binary, ~r/[^\x00-\x7F]/, "\uFFFD")
      end
    end
  end
end
