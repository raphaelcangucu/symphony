defmodule SymphonyElixirWeb.Tracker.AttachedContextController do
  @moduledoc "Attached Load Context endpoints for execution and assistant composer scopes."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.AttachedContexts
  alias SymphonyElixirWeb.TrackerErrors

  @spec index_execution(Conn.t(), map()) :: Conn.t()
  def index_execution(conn, %{"project_slug" => project_slug, "identifier" => identifier}) do
    scope = AttachedContexts.execution_scope(project_slug, identifier)
    json(conn, %{data: Enum.map(AttachedContexts.list(scope), &present/1)})
  end

  @spec create_execution(Conn.t(), map()) :: Conn.t()
  def create_execution(conn, %{"project_slug" => project_slug, "identifier" => identifier} = params) do
    scope = AttachedContexts.execution_scope(project_slug, identifier)
    create_context(conn, scope, attach_params(params, ["project_slug", "identifier"]))
  end

  @spec delete_execution(Conn.t(), map()) :: Conn.t()
  def delete_execution(conn, %{"project_slug" => project_slug, "identifier" => identifier, "id" => id}) do
    scope = AttachedContexts.execution_scope(project_slug, identifier)
    delete_context(conn, scope, id)
  end

  @spec index_assistant(Conn.t(), map()) :: Conn.t()
  def index_assistant(conn, %{"thread_id" => thread_id}) do
    with {:ok, thread_id} <- parse_id(thread_id),
         {:ok, thread} <- History.get_thread(thread_id) do
      scope = AttachedContexts.assistant_scope(thread.project_slug, thread.id)
      json(conn, %{data: Enum.map(AttachedContexts.list(scope), &present/1)})
    else
      {:error, :invalid_id} -> TrackerErrors.validation_msg(conn, "invalid thread id")
      {:error, :not_found} -> TrackerErrors.render(conn, :thread_not_found)
    end
  end

  @spec create_assistant(Conn.t(), map()) :: Conn.t()
  def create_assistant(conn, %{"thread_id" => thread_id} = params) do
    with {:ok, thread_id} <- parse_id(thread_id),
         {:ok, thread} <- History.get_thread(thread_id),
         {:ok, project_slug} <- assistant_project_slug(thread.project_slug, params) do
      scope = AttachedContexts.assistant_scope(project_slug, thread.id)
      create_context(conn, scope, attach_params(params, ["thread_id", "project_slug"]))
    else
      {:error, :invalid_id} -> TrackerErrors.validation_msg(conn, "invalid thread id")
      {:error, :missing_project_slug} -> TrackerErrors.validation_msg(conn, "project_slug is required")
      {:error, :not_found} -> TrackerErrors.render(conn, :thread_not_found)
    end
  end

  @spec delete_assistant(Conn.t(), map()) :: Conn.t()
  def delete_assistant(conn, %{"thread_id" => thread_id, "id" => id}) do
    with {:ok, thread_id} <- parse_id(thread_id),
         {:ok, context_id} <- parse_id(id),
         {:ok, thread} <- History.get_thread(thread_id) do
      scope = AttachedContexts.assistant_scope(thread.project_slug, thread.id)
      delete_context(conn, scope, context_id)
    else
      {:error, :invalid_id} -> TrackerErrors.validation_msg(conn, "invalid id")
      {:error, :not_found} -> TrackerErrors.render(conn, :thread_not_found)
    end
  end

  defp create_context(conn, scope, params) do
    case AttachedContexts.attach(scope, params) do
      {:ok, attachment} ->
        conn
        |> put_status(:created)
        |> json(%{data: present(attachment)})

      {:error, {:invalid_params, _field}} ->
        context_param_error(conn)

      {:error, reason} ->
        TrackerErrors.render(conn, reason)
    end
  end

  defp delete_context(conn, scope, id) when is_integer(id) do
    case AttachedContexts.detach(scope, id) do
      {:ok, _attachment} -> send_resp(conn, :no_content, "")
      {:error, :not_found} -> TrackerErrors.render(conn, :context_not_found)
    end
  end

  defp delete_context(conn, scope, id) do
    with {:ok, id} <- parse_id(id) do
      delete_context(conn, scope, id)
    else
      {:error, :invalid_id} -> TrackerErrors.validation_msg(conn, "invalid context id")
    end
  end

  defp attach_params(params, drop_keys), do: Map.drop(params, drop_keys)

  defp assistant_project_slug(project_slug, _params) when is_binary(project_slug) and project_slug != "" do
    {:ok, project_slug}
  end

  defp assistant_project_slug(_project_slug, %{"project_slug" => project_slug})
       when is_binary(project_slug) and project_slug != "" do
    {:ok, project_slug}
  end

  defp assistant_project_slug(_project_slug, _params), do: {:error, :missing_project_slug}

  defp parse_id(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_id(value) when is_binary(value) do
    case Integer.parse(value) do
      {id, ""} when id > 0 -> {:ok, id}
      _ -> {:error, :invalid_id}
    end
  end

  defp parse_id(_value), do: {:error, :invalid_id}

  defp context_param_error(conn) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: %{
        code: "invalid_context_params",
        message: "kind and ref_key are required"
      }
    })
  end

  defp present(attachment) do
    %{
      id: attachment.id,
      scope: attachment.scope,
      project_slug: attachment.project_slug,
      issue_identifier: attachment.issue_identifier,
      thread_id: attachment.thread_id,
      kind: attachment.kind,
      ref_key: attachment.ref_key,
      title: attachment.title,
      content_md: attachment.content_md,
      metadata: attachment.metadata || %{},
      position: attachment.position || 0,
      inserted_at: iso8601(attachment.inserted_at),
      updated_at: iso8601(attachment.updated_at)
    }
  end

  defp iso8601(nil), do: nil
  defp iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp iso8601(%NaiveDateTime{} = value), do: value |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_iso8601()
end
