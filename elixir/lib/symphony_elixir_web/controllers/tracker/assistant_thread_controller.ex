defmodule SymphonyElixirWeb.Tracker.AssistantThreadController do
  @moduledoc "Lists and creates assistant chat threads (project or freeform)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.{AgentSession, History}
  alias SymphonyElixirWeb.{TrackerErrors, TrackerPresenter}

  @default_limit 50
  @max_limit 100
  @min_limit 1
  # Compile-time copy of the canonical list so it can be used in guards.
  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, params) do
    opts =
      []
      |> put_opt(:scope, params["scope"])
      |> put_opt(:scopes, parse_scopes(params["scopes"]))
      |> put_opt(:project_slug, params["project_slug"])
      |> put_opt(:issue_identifier, params["issue_identifier"])
      |> Keyword.put(:limit, clamp_limit(params["limit"]))

    data =
      opts
      |> History.list_threads()
      |> Enum.map(&with_preview/1)
      |> Enum.map(&TrackerPresenter.assistant_thread/1)

    json(conn, %{data: data})
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, %{"scope" => "freeform"} = params) do
    # workspace_path is NOT NULL, but the canonical per-thread directory depends on
    # the autoincrement id we only learn after insert. Seed with the freeform root
    # as a placeholder, then immediately rewrite it to the per-thread path so the
    # document viewer scopes reads to this thread instead of the shared parent.
    attrs = %{title: params["title"], workspace_path: AgentSession.freeform_workspace_root()}

    with {:ok, thread} <- History.create_freeform_thread(attrs),
         {:ok, thread} <-
           History.update_thread(thread, %{workspace_path: AgentSession.freeform_workspace(thread.id)}) do
      conn
      |> put_status(:created)
      |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  def create(conn, %{"scope" => "project_session", "project_slug" => project_slug} = params) do
    attrs = %{
      title: params["title"],
      agent_kind: normalize_agent(params["agent_kind"])
    }

    with {:ok, thread} <- History.create_project_session_thread(project_slug, attrs) do
      conn
      |> put_status(:created)
      |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, %{"scope" => "issue_session", "project_slug" => project_slug, "issue_identifier" => issue_identifier} = params) do
    attrs = %{
      title: params["title"],
      agent_kind: normalize_agent(params["agent_kind"]),
      execution_mode: params["execution_mode"] || params["mode"],
      isolated_workspace: params["isolated_workspace"] == true
    }

    with {:ok, thread} <- History.create_issue_session_thread(project_slug, issue_identifier, attrs) do
      conn
      |> put_status(:created)
      |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def create(conn, _params) do
    TrackerErrors.validation_msg(conn, "scope must be freeform, project_session, or issue_session")
  end

  @spec archive(Conn.t(), map()) :: Conn.t()
  def archive(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, thread} <- History.archive_thread(id) do
      json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)
    end
  end

  def archive(conn, _params) do
    TrackerErrors.validation_msg(conn, "thread id is required")
  end

  defp parse_thread_id(id) when is_integer(id) and id > 0, do: {:ok, id}

  defp parse_thread_id(id) when is_binary(id) do
    case Integer.parse(String.trim(id)) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_thread_id}
    end
  end

  defp parse_thread_id(_), do: {:error, :invalid_thread_id}

  defp put_opt(opts, _key, nil), do: opts
  defp put_opt(opts, _key, ""), do: opts
  defp put_opt(opts, key, value), do: Keyword.put(opts, key, value)

  defp parse_scopes(nil), do: nil
  defp parse_scopes(""), do: nil

  defp parse_scopes(value) when is_binary(value) do
    value
    |> String.split(",", trim: true)
    |> Enum.reject(&(&1 == ""))
    |> case do
      [] -> nil
      scopes -> scopes
    end
  end

  defp parse_scopes(scopes) when is_list(scopes), do: scopes
  defp parse_scopes(_), do: nil

  defp normalize_agent(agent) when agent in @agent_kinds, do: agent
  defp normalize_agent(_agent), do: nil

  defp clamp_limit(nil), do: @default_limit

  defp clamp_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n |> min(@max_limit) |> max(@min_limit)
      :error -> @default_limit
    end
  end

  defp clamp_limit(_), do: @default_limit

  defp with_preview(thread) do
    thread
    |> Map.from_struct()
    |> Map.put(:preview, preview_text(History.latest_message(thread.id)))
  end

  defp preview_text(nil), do: nil
  defp preview_text(%{content: content}), do: content
end
