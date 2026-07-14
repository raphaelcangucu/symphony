defmodule SymphonyElixir.Workspace.DisplayName do
  @moduledoc """
  Persists display-only aliases for project workspace paths.

  Stored paths are absolute and normalized. This module never changes anything
  on disk; callers remain responsible for proving that a path belongs to the
  requested project before storing an alias.
  """

  use Ecto.Schema

  import Ecto.Changeset
  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Repo

  @max_project_slug_length 120
  @max_display_name_length 120

  @type t :: %__MODULE__{}
  @type error_reason ::
          :invalid_project_slug
          | :invalid_workspace_path
          | :invalid_display_name
          | :project_not_found
          | :not_found
          | Ecto.Changeset.t()

  schema "workspace_display_names" do
    belongs_to(:project, Project)
    field(:project_slug, :string)
    field(:workspace_path, :string)
    field(:display_name, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @spec list_for_project(term()) :: {:ok, [t()]} | {:error, :invalid_project_slug | :project_not_found}
  def list_for_project(project_slug) do
    with {:ok, normalized_slug} <- normalize_project_slug(project_slug),
         {:ok, project} <- Context.get_project(normalized_slug) do
      entries =
        __MODULE__
        |> where([entry], entry.project_id == ^project.id)
        |> order_by([entry], asc: entry.workspace_path, asc: entry.id)
        |> Repo.all()

      {:ok, entries}
    end
  end

  @spec map_for_project(term()) ::
          {:ok, %{optional(String.t()) => String.t()}} | {:error, :workspace_alias_lookup_failed}
  def map_for_project(project_slug) do
    case list_for_project(project_slug) do
      {:ok, entries} ->
        {:ok, Map.new(entries, &{&1.workspace_path, &1.display_name})}

      {:error, _reason} ->
        {:error, :workspace_alias_lookup_failed}
    end
  end

  @spec get(term(), term()) ::
          {:ok, t()}
          | {:error, :invalid_project_slug | :invalid_workspace_path | :project_not_found | :not_found}
  def get(project_slug, workspace_path) do
    with {:ok, normalized_slug} <- normalize_project_slug(project_slug),
         {:ok, normalized_path} <- normalize_workspace_path(workspace_path),
         {:ok, project} <- Context.get_project(normalized_slug) do
      case Repo.get_by(__MODULE__, project_id: project.id, workspace_path: normalized_path) do
        nil -> {:error, :not_found}
        %__MODULE__{} = entry -> {:ok, entry}
      end
    end
  end

  @spec put(term(), term(), term()) ::
          {:ok, t()}
          | {:error,
             :invalid_project_slug
             | :invalid_workspace_path
             | :invalid_display_name
             | :project_not_found
             | Ecto.Changeset.t()}
  def put(project_slug, workspace_path, display_name) do
    with {:ok, normalized_slug} <- normalize_project_slug(project_slug),
         {:ok, normalized_path} <- normalize_workspace_path(workspace_path),
         {:ok, normalized_name} <- validate_display_name(display_name),
         {:ok, project} <- Context.get_project(normalized_slug) do
      attributes = %{
        project_id: project.id,
        project_slug: normalized_slug,
        workspace_path: normalized_path,
        display_name: normalized_name
      }

      upsert(attributes)
    end
  end

  @spec validate_display_name(term()) :: {:ok, String.t()} | {:error, :invalid_display_name}
  def validate_display_name(display_name), do: normalize_display_name(display_name)

  @spec delete(term(), term()) ::
          :ok
          | {:error, :invalid_project_slug | :invalid_workspace_path | :project_not_found | :not_found}
  def delete(project_slug, workspace_path) do
    with {:ok, normalized_slug} <- normalize_project_slug(project_slug),
         {:ok, normalized_path} <- normalize_workspace_path(workspace_path),
         {:ok, project} <- Context.get_project(normalized_slug) do
      query =
        from(entry in __MODULE__,
          where: entry.project_id == ^project.id and entry.workspace_path == ^normalized_path
        )

      case Repo.delete_all(query) do
        {1, _entries} -> :ok
        {0, _entries} -> {:error, :not_found}
      end
    end
  end

  defp upsert(attributes) do
    now = DateTime.utc_now()

    changeset =
      %__MODULE__{}
      |> cast(attributes, [:project_id, :project_slug, :workspace_path, :display_name])
      |> validate_required([:project_id, :project_slug, :workspace_path, :display_name])
      |> foreign_key_constraint(:project_id)
      |> unique_constraint([:project_id, :workspace_path])

    Repo.insert(changeset,
      on_conflict: [
        set: [
          project_slug: attributes.project_slug,
          display_name: attributes.display_name,
          updated_at: now
        ]
      ],
      conflict_target: [:project_id, :workspace_path],
      returning: true
    )
  end

  defp normalize_project_slug(project_slug) when is_binary(project_slug) do
    normalized_slug = String.trim(project_slug)

    if normalized_slug != "" and String.length(normalized_slug) <= @max_project_slug_length do
      {:ok, normalized_slug}
    else
      {:error, :invalid_project_slug}
    end
  end

  defp normalize_project_slug(_project_slug), do: {:error, :invalid_project_slug}

  defp normalize_workspace_path(workspace_path) when is_binary(workspace_path) do
    normalized_path = String.trim(workspace_path)

    cond do
      normalized_path == "" ->
        {:error, :invalid_workspace_path}

      String.contains?(normalized_path, <<0>>) ->
        {:error, :invalid_workspace_path}

      Path.type(normalized_path) != :absolute ->
        {:error, :invalid_workspace_path}

      Path.expand(normalized_path) != normalized_path ->
        {:error, :invalid_workspace_path}

      true ->
        {:ok, normalized_path}
    end
  end

  defp normalize_workspace_path(_workspace_path), do: {:error, :invalid_workspace_path}

  defp normalize_display_name(display_name) when is_binary(display_name) do
    normalized_name = String.trim(display_name)

    if normalized_name != "" and String.length(normalized_name) <= @max_display_name_length do
      {:ok, normalized_name}
    else
      {:error, :invalid_display_name}
    end
  end

  defp normalize_display_name(_display_name), do: {:error, :invalid_display_name}
end
