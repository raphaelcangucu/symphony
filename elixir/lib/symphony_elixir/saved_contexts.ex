defmodule SymphonyElixir.SavedContexts do
  @moduledoc "CRUD boundary for saved Load Context recaps."

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts.Entry

  @spec list(String.t()) :: [Entry.t()]
  def list(project_slug) when is_binary(project_slug) do
    Entry
    |> where([entry], entry.project_slug == ^project_slug)
    |> order_by([entry], desc: entry.inserted_at, desc: entry.id)
    |> Repo.all()
  end

  @spec get_by_slug(String.t(), String.t()) :: Entry.t() | nil
  def get_by_slug(project_slug, slug) when is_binary(project_slug) and is_binary(slug) do
    Repo.get_by(Entry, project_slug: project_slug, slug: slug)
  end

  @spec create(map()) :: {:ok, Entry.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    %Entry{}
    |> Entry.changeset(attrs)
    |> Repo.insert()
  end

  @spec generate(map(), map()) :: {:error, :not_configured}
  def generate(_scope, _opts), do: {:error, :not_configured}
end
