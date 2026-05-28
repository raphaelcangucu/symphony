defmodule SymphonyElixirWeb.Tracker.IssueController do
  @moduledoc "Issue endpoints for the local tracker JSON API."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixirWeb.TrackerErrors
  alias SymphonyElixirWeb.TrackerPresenter

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, %{"project_slug" => project_slug} = params) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, filters} <- build_filters(params) do
      issues = Context.list_issues(project_slug, filters)
      json(conn, %{data: Enum.map(issues, &TrackerPresenter.issue/1)})
    else
      {:error, :project_not_found} ->
        TrackerErrors.render(conn, :project_not_found)

      {:error, viewer_error} ->
        TrackerErrors.render(conn, viewer_error)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"project_slug" => project_slug} = params) do
    attrs =
      params
      |> Map.delete("project_slug")
      |> maybe_inject_creator()

    case Context.create_issue(project_slug, attrs) do
      {:ok, issue} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.issue(issue)})

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"project_slug" => project_slug, "id" => identifier}) do
    case Context.get_issue(project_slug, identifier) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"project_slug" => project_slug, "id" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "id"])

    case Context.update_issue(project_slug, identifier, attrs) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec move(Conn.t(), map()) :: Conn.t()
  def move(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    attrs = Map.drop(params, ["project_slug", "identifier"])

    case Context.move_issue(project_slug, identifier, attrs) do
      {:ok, issue} -> json(conn, %{data: TrackerPresenter.issue(issue)})
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  defp build_filters(params) do
    with {:ok, assignee} <- resolve_me(Map.get(params, "assignee")),
         {:ok, creator} <- resolve_me(Map.get(params, "creator")) do
      filters =
        []
        |> put_filter(:search, trim_or_nil(Map.get(params, "q")))
        |> put_filter(:assignee, assignee)
        |> put_filter(:creator, creator)

      {:ok, filters}
    end
  end

  defp put_filter(opts, _key, nil), do: opts
  defp put_filter(opts, _key, ""), do: opts
  defp put_filter(opts, key, value), do: Keyword.put(opts, key, value)

  defp resolve_me(nil), do: {:ok, nil}
  defp resolve_me(""), do: {:ok, nil}

  defp resolve_me("me") do
    case Viewer.current() do
      {:ok, %{login: login}} -> {:ok, login}
      {:error, _reason} = error -> error
    end
  end

  defp resolve_me(value) when is_binary(value), do: {:ok, value}

  defp maybe_inject_creator(attrs) do
    case Viewer.current() do
      {:ok, %{login: login}} -> Map.put_new(attrs, "creator", login)
      {:error, _reason} -> attrs
    end
  end

  defp trim_or_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_or_nil(_), do: nil
end
