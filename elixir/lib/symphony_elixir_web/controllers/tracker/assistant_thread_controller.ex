defmodule SymphonyElixirWeb.Tracker.AssistantThreadController do
  @moduledoc "Lists and creates assistant chat threads (project or freeform)."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.{AgentSession, History, ProjectExploreWorkspace, Thread, TitleGenerator}
  alias SymphonyElixir.Editor
  alias SymphonyElixir.Workspace.Provision
  alias SymphonyElixir.Workspace.PathOwnership
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
      |> Keyword.put(:include_archived, include_archived?(params["include_archived"]))
      |> Keyword.put(:limit, clamp_limit(params["limit"]))

    data =
      opts
      |> History.list_threads()
      |> Enum.map(&with_preview/1)
      |> Enum.map(&TrackerPresenter.assistant_thread/1)

    json(conn, %{data: data})
  end

  @spec show(Conn.t(), map()) :: Conn.t()
  def show(conn, %{"thread_id" => raw_id}) do
    with {id, ""} <- Integer.parse(to_string(raw_id)),
         {:ok, thread} <- History.get_thread(id) do
      json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      :error -> TrackerErrors.validation_msg(conn, "thread_id must be an integer")
      {:error, :not_found} -> TrackerErrors.render(conn, :thread_not_found)
      {:error, reason} -> TrackerErrors.render(conn, reason)
    end
  end

  @spec editor(Conn.t(), map()) :: Conn.t()
  def editor(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, thread} <- History.get_thread(id),
         workspace_path when is_binary(workspace_path) and workspace_path != "" <-
           Map.get(thread, :workspace_path) do
      project_slug = Map.get(thread, :project_slug) || ""
      browser = editor_payload(Editor.workspace_path_target(project_slug, workspace_path))

      cursor =
        editor_payload(Editor.workspace_path_cursor_desktop_target(project_slug, workspace_path))

      render_editor_payload(conn, browser, cursor)
    else
      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      workspace_path when workspace_path in [nil, ""] ->
        render_workspace_missing_editor_payload(conn)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)

      _unexpected_workspace_path ->
        TrackerErrors.render(conn, :request_failed)
    end
  end

  @spec create(Conn.t(), map()) :: Conn.t()
  def create(conn, params) do
    with {:ok, request_id} <- client_request_id(conn),
         nil <- existing_request_thread(request_id) do
      do_create(conn, put_client_request_id(params, request_id))
    else
      %Thread{} = thread ->
        json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})

      {:error, :invalid_client_request_id} ->
        TrackerErrors.validation_msg(conn, "Idempotency-Key must contain 1 to 128 characters")
    end
  end

  defp do_create(conn, %{"scope" => "freeform", "workspace_path" => _workspace_path}) do
    TrackerErrors.validation_msg(conn, "workspace_path is not supported for freeform threads")
  end

  defp do_create(conn, %{"scope" => "freeform"} = params) do
    case create_freeform_with_workspace(params) do
      {:ok, thread} ->
        conn
        |> put_status(:created)
        |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  defp do_create(
         conn,
         %{"scope" => "project_session", "project_slug" => project_slug, "workspace_path" => workspace_path} = params
       ) do
    attrs = project_session_attrs(params)

    with {:ok, %{path: normalized_path}} <- PathOwnership.validate(project_slug, workspace_path),
         :ok <- maybe_ensure_project_explore_workspace(project_slug, normalized_path),
         {:ok, thread} <- History.create_workspace_session_thread(project_slug, normalized_path, attrs) do
      render_created_thread(conn, thread)
    else
      {:error, reason} -> render_create_error(conn, reason)
    end
  end

  defp do_create(conn, %{"scope" => "project_session", "project_slug" => project_slug} = params) do
    attrs = project_session_attrs(params)

    with {:ok, thread} <- History.create_project_session_thread(project_slug, attrs) do
      render_created_thread(conn, thread)
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp do_create(
         conn,
         %{
           "scope" => "issue_session",
           "project_slug" => project_slug,
           "issue_identifier" => issue_identifier,
           "workspace_path" => workspace_path
         } = params
       ) do
    with {:ok, ownership} <-
           PathOwnership.validate_issue(project_slug, workspace_path, issue_identifier),
         attrs <- Map.put(issue_session_attrs(params), :workspace_kind, ownership.workspace_kind),
         {:ok, thread} <-
           History.create_issue_workspace_session_thread(
             project_slug,
             issue_identifier,
             ownership.path,
             attrs
           ) do
      render_created_thread(conn, thread)
    else
      {:error, reason} -> render_create_error(conn, reason)
    end
  end

  defp do_create(
         conn,
         %{"scope" => "issue_session", "project_slug" => _project_slug, "workspace_path" => _workspace_path}
       ) do
    TrackerErrors.validation_msg(conn, "issue_identifier is required")
  end

  defp do_create(
         conn,
         %{
           "scope" => "issue_session",
           "project_slug" => project_slug,
           "issue_identifier" => issue_identifier
         } = params
       ) do
    attrs = issue_session_attrs(params)

    with {:ok, thread} <- History.create_issue_session_thread(project_slug, issue_identifier, attrs) do
      render_created_thread(conn, thread)
    else
      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp do_create(conn, _params) do
    TrackerErrors.validation_msg(conn, "scope must be freeform, project_session, or issue_session")
  end

  @doc """
  Resolves the freeform thread the docked Maestro host binds to on
  home/observability: reuse the most recently active freeform thread, or create
  one when none exist.
  """
  @spec ensure_active_freeform(Conn.t(), map()) :: Conn.t()
  def ensure_active_freeform(conn, _params) do
    result =
      case History.latest_freeform_thread() do
        nil -> create_freeform_with_workspace(%{"title" => "Maestro"})
        thread -> {:ok, thread}
      end

    case result do
      {:ok, thread} ->
        json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"thread_id" => raw_id} = params) do
    attrs = Map.take(params, ["title", "labels", "needs_review"])

    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, agent_kind} <- parse_optional_agent_kind(params),
         {:ok, thread} <- History.update_thread_sidebar_metadata(id, attrs),
         {:ok, thread} <- maybe_set_thread_agent(thread, agent_kind) do
      json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :invalid_agent_kind} ->
        TrackerErrors.validation_msg(
          conn,
          "agent_kind must be one of: #{Enum.join(@agent_kinds, ", ")}"
        )

      {:error, :invalid_title} ->
        TrackerErrors.validation_msg(conn, "title must be between 1 and 160 characters")

      {:error, :invalid_labels} ->
        TrackerErrors.validation_msg(conn, "labels must contain at most 12 strings of up to 40 characters")

      {:error, :invalid_needs_review} ->
        TrackerErrors.validation_msg(conn, "needs_review must be a boolean")

      {:error, :invalid_attrs} ->
        TrackerErrors.validation_msg(conn, "invalid assistant thread attributes")

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def update(conn, _params), do: TrackerErrors.validation_msg(conn, "thread id is required")

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, _thread} <- History.delete_thread(id) do
      Conn.send_resp(conn, :no_content, "")
    else
      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :unsupported_scope} ->
        TrackerErrors.validation_msg(conn, "thread scope does not support deletion")

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def delete(conn, _params), do: TrackerErrors.validation_msg(conn, "thread id is required")

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

  @spec generate_title(Conn.t(), map()) :: Conn.t()
  def generate_title(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, thread} <- TitleGenerator.generate_and_persist(id, Keyword.merge([mode: :magic], title_runner_opts())) do
      json(conn, %{data: TrackerPresenter.assistant_thread(with_preview(thread))})
    else
      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :not_enough_context} ->
        TrackerErrors.render(conn, :not_enough_context)

      {:error, :no_answer} ->
        TrackerErrors.render(conn, :no_answer)

      {:error, :invalid_title} ->
        TrackerErrors.validation_msg(conn, "title must be between 1 and 160 characters")

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  def generate_title(conn, _params), do: TrackerErrors.validation_msg(conn, "thread id is required")

  @spec provision_workspace(Conn.t(), map()) :: Conn.t()
  def provision_workspace(conn, %{"thread_id" => raw_id}) do
    with {:ok, id} <- parse_thread_id(raw_id),
         {:ok, thread} <- History.get_thread(id),
         {:ok, path} <- AgentSession.provision_thread_workspace(thread) do
      json(conn, %{data: %{workspace_path: path, status: "ready"}})
    else
      {:error, :not_found} ->
        TrackerErrors.render(conn, :thread_not_found)

      {:error, :invalid_thread_id} ->
        TrackerErrors.render(conn, :invalid_thread_id)

      {:error, :unsupported_scope} ->
        TrackerErrors.validation_msg(conn, "thread scope does not support workspace provisioning")

      {:error, reason} ->
        TrackerErrors.render(conn, Provision.classify_error(reason))
    end
  end

  def provision_workspace(conn, _params), do: TrackerErrors.validation_msg(conn, "thread id is required")

  defp parse_thread_id(id) when is_integer(id) and id > 0, do: {:ok, id}

  defp parse_thread_id(id) when is_binary(id) do
    case Integer.parse(String.trim(id)) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> {:error, :invalid_thread_id}
    end
  end

  defp parse_thread_id(_), do: {:error, :invalid_thread_id}

  defp render_editor_payload(conn, browser, cursor) do
    json(conn, %{
      data: %{
        available: browser.available,
        url: browser.url,
        reason: browser.reason,
        cursor_desktop: %{
          available: cursor.available,
          url: cursor.url,
          reason: cursor.reason
        }
      }
    })
  end

  defp render_workspace_missing_editor_payload(conn) do
    missing = editor_payload({:error, :workspace_missing})
    render_editor_payload(conn, missing, missing)
  end

  defp editor_payload({:ok, url}), do: %{available: true, url: url, reason: nil}

  defp editor_payload({:error, reason}),
    do: %{available: false, url: nil, reason: Atom.to_string(reason)}

  defp title_runner_opts do
    case Application.get_env(:symphony_elixir, :title_generator_runner) do
      runner when is_function(runner, 4) -> [runner: runner]
      _ -> []
    end
  end

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

  defp include_archived?(value), do: value in [true, "true"]

  defp normalize_agent(agent) when agent in @agent_kinds, do: agent
  defp normalize_agent(_agent), do: nil

  defp parse_optional_agent_kind(params) when is_map(params) do
    if Map.has_key?(params, "agent_kind") do
      case normalize_agent(params["agent_kind"]) do
        kind when is_binary(kind) -> {:ok, kind}
        nil -> {:error, :invalid_agent_kind}
      end
    else
      {:ok, :unchanged}
    end
  end

  defp maybe_set_thread_agent(thread, :unchanged), do: {:ok, thread}

  defp maybe_set_thread_agent(thread, agent_kind) when is_binary(agent_kind) do
    History.set_thread_agent(thread, agent_kind)
  end

  defp issue_session_attrs(params) do
    %{
      client_request_id: params["client_request_id"],
      title: params["title"],
      agent_kind: normalize_agent(params["agent_kind"]),
      execution_mode: params["execution_mode"] || params["mode"],
      model: params["model"],
      effort: params["effort"],
      isolated_workspace: params["isolated_workspace"] == true,
      use_parent_workspace: params["use_parent_workspace"] == true,
      clone_branches: params["clone_branches"],
      clone_branch: params["clone_branch"]
    }
  end

  defp project_session_attrs(params) do
    %{
      client_request_id: params["client_request_id"],
      title: params["title"],
      agent_kind: normalize_agent(params["agent_kind"]),
      model: params["model"],
      effort: params["effort"],
      execution_mode: params["execution_mode"] || params["mode"]
    }
  end

  defp maybe_ensure_project_explore_workspace(project_slug, workspace_path)
       when is_binary(project_slug) and is_binary(workspace_path) do
    explore_path = ProjectExploreWorkspace.path(project_slug)

    if Path.expand(workspace_path) == Path.expand(explore_path) do
      case ProjectExploreWorkspace.ensure(project_slug) do
        {:ok, _path} -> :ok
        {:error, reason} -> {:error, reason}
      end
    else
      :ok
    end
  end

  defp model_effort_metadata(params) when is_map(params) do
    %{}
    |> maybe_put_meta_string("model", params["model"])
    |> maybe_put_meta_string("effort", params["effort"])
  end

  defp maybe_put_meta_string(metadata, _key, nil), do: metadata

  defp maybe_put_meta_string(metadata, key, value) when is_binary(value) do
    case String.trim(value) do
      "" -> metadata
      trimmed -> Map.put(metadata, key, trimmed)
    end
  end

  defp maybe_put_meta_string(metadata, _key, _value), do: metadata

  # workspace_path is NOT NULL, but the canonical per-thread directory depends on
  # the autoincrement id we only learn after insert. Seed with the freeform root
  # as a placeholder, then immediately rewrite it to the per-thread path so the
  # document viewer scopes reads to this thread instead of the shared parent.
  defp create_freeform_with_workspace(params) do
    attrs = %{
      client_request_id: params["client_request_id"],
      title: params["title"],
      workspace_path: AgentSession.freeform_workspace_root(),
      agent_kind: normalize_agent(params["agent_kind"]),
      metadata: model_effort_metadata(params)
    }

    with {:ok, thread} <- History.create_freeform_thread(attrs),
         {:ok, thread} <-
           History.update_thread(thread, %{workspace_path: AgentSession.freeform_workspace(thread.id)}) do
      {:ok, thread}
    end
  end

  defp render_created_thread(conn, thread) do
    conn
    |> put_status(:created)
    |> json(%{data: TrackerPresenter.assistant_thread(with_preview(thread))})
  end

  defp client_request_id(conn) do
    case get_req_header(conn, "idempotency-key") do
      [] ->
        {:ok, nil}

      [value] when is_binary(value) ->
        trimmed = String.trim(value)

        if byte_size(trimmed) in 1..128,
          do: {:ok, trimmed},
          else: {:error, :invalid_client_request_id}

      _ ->
        {:error, :invalid_client_request_id}
    end
  end

  defp existing_request_thread(nil), do: nil
  defp existing_request_thread(request_id), do: History.thread_by_client_request_id(request_id)

  defp put_client_request_id(params, nil), do: params
  defp put_client_request_id(params, request_id), do: Map.put(params, "client_request_id", request_id)

  defp render_create_error(conn, {:validation, :invalid_workspace_path}) do
    TrackerErrors.validation_msg(conn, "workspace_path must be an absolute owned workspace path")
  end

  defp render_create_error(conn, {:validation, :workspace_path_not_owned}) do
    TrackerErrors.validation_msg(conn, "workspace_path does not belong to this project")
  end

  defp render_create_error(conn, {:validation, :workspace_issue_mismatch}) do
    TrackerErrors.validation_msg(conn, "workspace_path does not belong to issue_identifier")
  end

  defp render_create_error(conn, {:inventory, _reason}), do: TrackerErrors.render(conn, :request_failed)
  defp render_create_error(conn, %Ecto.Changeset{} = changeset), do: TrackerErrors.render(conn, changeset)
  defp render_create_error(conn, reason), do: TrackerErrors.render(conn, reason)

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
