defmodule SymphonyElixir.AttachedContexts do
  @moduledoc "CRUD and prompt-injection helpers for composer attached contexts."

  import Ecto.Query

  alias SymphonyElixir.AttachedContexts.Attachment
  alias SymphonyElixir.ContextResolvers
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @type scope :: %{
          required(:scope) => String.t(),
          required(:project_slug) => String.t(),
          optional(:issue_identifier) => String.t() | nil,
          optional(:thread_id) => integer() | nil
        }

  @spec execution_scope(String.t(), String.t()) :: scope()
  def execution_scope(project_slug, issue_identifier) when is_binary(project_slug) and is_binary(issue_identifier) do
    %{scope: "execution", project_slug: project_slug, issue_identifier: issue_identifier, thread_id: nil}
  end

  @spec assistant_scope(String.t(), integer()) :: scope()
  def assistant_scope(project_slug, thread_id) when is_binary(project_slug) and is_integer(thread_id) do
    %{scope: "assistant", project_slug: project_slug, issue_identifier: nil, thread_id: thread_id}
  end

  @spec list(scope()) :: [Attachment.t()]
  def list(scope) when is_map(scope) do
    Attachment
    |> apply_scope(scope)
    |> order_by([attachment], asc: attachment.position, asc: attachment.inserted_at, asc: attachment.id)
    |> Repo.all()
  end

  @spec attach(scope(), map()) :: {:ok, Attachment.t()} | {:error, term()}
  def attach(scope, attrs) when is_map(scope) and is_map(attrs) do
    with {:ok, kind} <- required_string(attrs, :kind),
         {:ok, ref_key} <- required_string(attrs, :ref_key),
         {:ok, metadata} <- metadata_param(attrs),
         {:ok, project} <- Context.get_project(scope.project_slug),
         {:ok, resolved} <- ContextResolvers.resolve(project, kind, ref_key, metadata) do
      attachment_attrs =
        scope
        |> Map.merge(%{
          kind: kind,
          ref_key: ref_key,
          title: resolved.title,
          content_md: resolved.content_md,
          metadata: resolved_metadata(resolved) |> Map.merge(metadata)
        })

      upsert_attachment(scope, kind, ref_key, attachment_attrs)
    end
  end

  @spec detach(scope(), integer()) :: {:ok, Attachment.t()} | {:error, :not_found}
  def detach(scope, id) when is_map(scope) and is_integer(id) do
    case scope |> scoped_query(id) |> Repo.one() do
      %Attachment{} = attachment -> Repo.delete(attachment)
      nil -> {:error, :not_found}
    end
  end

  @spec clear(scope()) :: {non_neg_integer(), nil | [term()]}
  def clear(scope) when is_map(scope) do
    scope
    |> base_scope_query()
    |> Repo.delete_all()
  end

  @spec append_to_instructions(scope(), String.t(), keyword()) :: String.t()
  def append_to_instructions(scope, instructions, opts \\ []) when is_map(scope) and is_binary(instructions) do
    contexts = list(scope) ++ draft_contexts(scope, Keyword.get(opts, :context_refs, []))

    case contexts do
      [] ->
        instructions

      contexts ->
        loaded_context =
          contexts
          |> Enum.map_join("\n\n", &context_content/1)
          |> String.trim()

        [String.trim(instructions), "## Loaded Context", "", loaded_context]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("\n\n")
    end
  end

  defp draft_contexts(_scope, []), do: []

  defp draft_contexts(scope, context_refs) when is_list(context_refs) do
    with {:ok, project} <- Context.get_project(scope.project_slug) do
      context_refs
      |> Enum.flat_map(&resolve_context_ref(project, &1))
    else
      _ -> []
    end
  end

  defp draft_contexts(_scope, _context_refs), do: []

  defp resolve_context_ref(project, ref) when is_map(ref) do
    case ephemeral_context_ref(ref) do
      {:ok, resolved} ->
        [resolved]

      :error ->
        with {:ok, kind} <- context_ref_kind(ref),
             {:ok, ref_key} <- context_ref_id(ref),
             {:ok, resolved} <- ContextResolvers.resolve(project, kind, ref_key, %{}) do
          [resolved]
        else
          _ -> []
        end
    end
  end

  defp resolve_context_ref(_project, _ref), do: []

  defp ephemeral_context_ref(ref) do
    with {:ok, content} <- context_ref_content(ref),
         {:ok, ref_key} <- context_ref_id(ref) do
      title = context_ref_title(ref, ref_key)
      {:ok, %{title: title, content_md: content, metadata: %{"ref_key" => ref_key}}}
    else
      _ -> :error
    end
  end

  defp context_ref_content(ref) do
    case fetch_any(ref, [:content_md, :contentMd, :content]) do
      {:ok, value} when is_binary(value) ->
        case String.trim(value) do
          "" -> :error
          content -> {:ok, content}
        end

      _ ->
        :error
    end
  end

  defp context_ref_title(ref, ref_key) do
    case fetch_any(ref, [:label, :title]) do
      {:ok, value} when is_binary(value) and value != "" -> value
      _ -> ref_key
    end
  end

  defp context_ref_kind(ref) do
    case fetch_any(ref, [:kind, :type]) do
      {:ok, "issue"} -> {:ok, "board_issue"}
      {:ok, "board_issue"} -> {:ok, "board_issue"}
      {:ok, "saved"} -> {:ok, "saved"}
      {:ok, "session"} -> {:ok, "session"}
      {:ok, "pr"} -> {:ok, "pr"}
      {:ok, "security"} -> {:ok, "security_alert"}
      {:ok, "security_alert"} -> {:ok, "security_alert"}
      {:ok, "advisory"} -> {:ok, "advisory"}
      {:ok, "github_issue"} -> {:ok, "github_issue"}
      _ -> {:error, :invalid_context_ref}
    end
  end

  defp context_ref_id(ref) do
    case fetch_any(ref, [:ref_key, :id]) do
      {:ok, value} when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, :invalid_context_ref}
    end
  end

  defp fetch_any(map, keys) do
    Enum.find_value(keys, :error, fn key ->
      case fetch_param(map, key) do
        {:ok, value} -> {:ok, value}
        :error -> nil
      end
    end)
  end

  defp context_content(%Attachment{} = attachment), do: attachment.content_md
  defp context_content(%{content_md: content}) when is_binary(content), do: content
  defp context_content(%{"content_md" => content}) when is_binary(content), do: content
  defp context_content(_context), do: ""

  defp upsert_attachment(scope, kind, ref_key, attrs) do
    case find(scope, kind, ref_key) do
      %Attachment{} = attachment ->
        attachment
        |> Attachment.changeset(attrs)
        |> Repo.update()

      nil ->
        %Attachment{}
        |> Attachment.changeset(attrs)
        |> Repo.insert()
        |> recover_unique_conflict(scope, kind, ref_key, attrs)
    end
  end

  defp recover_unique_conflict({:ok, %Attachment{}} = result, _scope, _kind, _ref_key, _attrs), do: result

  defp recover_unique_conflict({:error, %Ecto.Changeset{} = changeset} = error, scope, kind, ref_key, attrs) do
    if Keyword.has_key?(changeset.errors, :ref_key) do
      case find(scope, kind, ref_key) do
        %Attachment{} = attachment ->
          attachment
          |> Attachment.changeset(attrs)
          |> Repo.update()

        nil ->
          error
      end
    else
      error
    end
  end

  defp find(scope, kind, ref_key) do
    scope
    |> base_scope_query()
    |> where([attachment], attachment.kind == ^kind and attachment.ref_key == ^ref_key)
    |> Repo.one()
  end

  defp scoped_query(scope, id) do
    scope
    |> base_scope_query()
    |> where([attachment], attachment.id == ^id)
  end

  defp apply_scope(query, scope), do: base_scope_query(scope, query)

  defp base_scope_query(scope, query \\ Attachment)

  defp base_scope_query(%{scope: "execution", project_slug: project_slug, issue_identifier: issue_identifier}, query) do
    where(
      query,
      [attachment],
      attachment.scope == "execution" and
        attachment.project_slug == ^project_slug and
        attachment.issue_identifier == ^issue_identifier
    )
  end

  defp base_scope_query(%{scope: "assistant", project_slug: project_slug, thread_id: thread_id}, query) do
    where(
      query,
      [attachment],
      attachment.scope == "assistant" and
        attachment.project_slug == ^project_slug and
        attachment.thread_id == ^thread_id
    )
  end

  defp required_string(attrs, key) do
    case fetch_param(attrs, key) do
      {:ok, value} when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, {:invalid_params, key}}
    end
  end

  defp fetch_param(attrs, key) do
    case Map.fetch(attrs, key) do
      {:ok, value} -> {:ok, value}
      :error -> Map.fetch(attrs, Atom.to_string(key))
    end
  end

  defp metadata_param(attrs) do
    case fetch_param(attrs, :metadata) do
      {:ok, metadata} when is_map(metadata) -> {:ok, metadata}
      {:ok, nil} -> {:ok, %{}}
      {:ok, _metadata} -> {:error, {:invalid_params, :metadata}}
      :error -> {:ok, %{}}
    end
  end

  defp resolved_metadata(%{metadata: metadata}) when is_map(metadata), do: metadata
  defp resolved_metadata(_resolved), do: %{}
end
