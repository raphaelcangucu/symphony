defmodule SymphonyElixir.GitHub.IssueAdapter do
  @moduledoc "GitHub Project v2 implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  import Ecto.Query, only: [from: 2]

  alias SymphonyElixir.GitHub.AttachmentRewriter
  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.GitHub.IssueComments
  alias SymphonyElixir.GitHub.IssueCreateRepo
  alias SymphonyElixir.GitHub.IssueRepo
  alias SymphonyElixir.GitHub.RepoSpec
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.{IssueDTO, RemoteError}
  alias SymphonyElixir.Tracker.Sync.UserRecord

  @page_size 50
  # Compile-time copy of the canonical list so it can be used in guards.
  @agent_kinds SymphonyElixir.Settings.Agents.agent_kinds()

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, _filters) do
    %{project_id: project_id, status_field: status_field} = config(project)

    case fetch_all_items(project_id, nil, []) do
      {:ok, nodes} ->
        issues =
          nodes
          |> Enum.map(&Query.normalize_item(&1, status_field, project.slug))
          |> Enum.reject(&is_nil/1)
          |> restore_attachment_urls(project.slug)

        {:ok, issues}

      error ->
        {:error, map_error(error)}
    end
  end

  # Walks every page of the project's items (the board can exceed one `@page_size`
  # page). A single page is the common case and costs one request, so this does
  # not add calls to the hot path; it only follows the cursor when there is more.
  defp fetch_all_items(project_id, after_cursor, acc) do
    variables = %{"projectId" => project_id, "first" => @page_size, "after" => after_cursor}

    case client().graphql(Query.list_items_query(), variables, []) do
      {:ok, response} ->
        nodes = response |> get_in(["data", "node", "items", "nodes"]) |> List.wrap()

        case get_in(response, ["data", "node", "items", "pageInfo"]) do
          %{"hasNextPage" => true, "endCursor" => cursor} when is_binary(cursor) and cursor != "" ->
            fetch_all_items(project_id, cursor, acc ++ nodes)

          _ ->
            {:ok, acc ++ nodes}
        end

      error ->
        error
    end
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    with {:ok, issues} <- list_issues(project, []) do
      case find_issue_dto(issues, identifier) do
        {:ok, dto} ->
          {:ok, dto}

        :not_found ->
          find_issue_dto_by_local_mirror(project, issues, identifier)
      end
    end
  end

  @impl true
  def list_statuses(%Project{} = project) do
    %{project_id: project_id} = config(project)

    case client().graphql(Query.status_options_query(), %{"projectId" => project_id}, []) do
      {:ok, response} -> {:ok, Query.status_options(response)}
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def list_labels(%Project{} = project) do
    with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
         {:ok, %{labels: labels}} <- fetch_repo_metadata(owner, name) do
      {:ok, labels}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_assignable_users(%Project{} = project) do
    with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
         {:ok, response} <-
           client().graphql(Query.assignable_users_query(), %{"owner" => owner, "name" => name}, []) do
      {:ok, Query.assignable_users(response)}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def create_issue(%Project{} = project, attrs) when is_map(attrs) do
    with {:ok, _preferred} <- IssueCreateRepo.resolve(project, attrs) do
      case IssueCreateRepo.candidates(project, attrs) do
        [] ->
          {:error, map_error({:invalid_repository, "repository is required — pass repository on create_issue or set tracker.config.repo"})}

        repos ->
          create_issue_across_repos(project, attrs, repos)
      end
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  # Prefer the resolved repo; when GitHub rejects create because Issues are
  # disabled on that repository, retry remaining linked candidates so local
  # drafts still land on the project board.
  defp create_issue_across_repos(project, attrs, [repo | rest]) do
    case create_issue_in_repo(project, attrs, repo) do
      {:ok, _} = ok ->
        ok

      {:error, reason} ->
        mapped = map_error(reason)

        if rest != [] and issues_disabled_error?(mapped) do
          create_issue_across_repos(project, attrs, rest)
        else
          {:error, mapped}
        end
    end
  end

  defp create_issue_in_repo(%Project{} = project, attrs, repo) do
    cfg = config(project)

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, title} <- require_title(attrs),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         label_ids = resolve_label_ids(meta.labels, attrs),
         {:ok, status_target} <- resolve_status_target(cfg, status_name(attrs)),
         remote_body = AttachmentRewriter.rewrite(body(attrs), owner, name, project.slug),
         {:ok, issue} <- create_remote_issue(project, meta.repo_id, title, attrs, label_ids, remote_body),
         {:ok, item_id} <- add_to_project(cfg.project_id, issue["id"]),
         :ok <- apply_status_target(cfg, item_id, status_target) do
      {:ok, build_created_dto(issue, project, attrs, meta.labels, label_ids)}
    end
  end

  defp issues_disabled_error?({:remote_validation, %{errors: errors}}) when is_list(errors) do
    Enum.any?(errors, &issues_disabled_message?/1)
  end

  defp issues_disabled_error?(_reason), do: false

  defp issues_disabled_message?(message) when is_binary(message) do
    String.contains?(String.downcase(message), "issues has been disabled")
  end

  defp issues_disabled_message?(_message), do: false

  @impl true
  def update_issue(%Project{} = project, identifier, attrs) when is_map(attrs) do
    with {:ok, repo} <- resolve_issue_repo(project, identifier),
         {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- resolve_issue_number(project, identifier),
         {:ok, issue} <- fetch_issue_details(owner, name, number),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         {:ok, _} <- maybe_update_issue_content(project, owner, name, issue, attrs),
         :ok <- maybe_sync_issue_labels(issue, meta.labels, attrs) do
      get_issue(project, to_string(number))
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    %{project_id: project_id, status_field: status_field} = config(project)
    target_status = Map.get(attrs, "status") || Map.get(attrs, "state") || Map.get(attrs, :status)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, attrs),
         {:ok, fields_response} <-
           client().graphql(Query.status_options_query(), %{"projectId" => project_id}, []),
         {:ok, field_id, option_id} <-
           Query.resolve_field_and_option(fields_response, status_field, target_status),
         {:ok, _} <-
           client().graphql(
             Query.update_field_value_mutation(),
             %{
               "projectId" => project_id,
               "itemId" => item_id,
               "fieldId" => field_id,
               "optionId" => option_id
             },
             []
           ),
         :ok <- maybe_apply_agent_routing_label(project, identifier, attrs) do
      {:ok,
       IssueDTO.build(%{
         identifier: identifier,
         title: target_status,
         status: %{
           name: target_status,
           category: Query.category_for(target_status),
           position: nil,
           is_terminal: false
         },
         project_slug: project.slug
       })}
    else
      {:error, :status_not_found} -> {:error, :status_not_found}
      error -> {:error, map_error(error)}
    end
  end

  @spec archive_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def archive_issue(%Project{} = project, identifier) do
    archive_project_item(project, identifier, Query.archive_project_item_mutation())
  end

  @spec restore_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def restore_issue(%Project{} = project, identifier) do
    archive_project_item(project, identifier, Query.unarchive_project_item_mutation())
  end

  @spec delete_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def delete_issue(%Project{} = project, identifier) do
    %{project_id: project_id} = config(project)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, %{}),
         {:ok, response} <-
           client().graphql(
             Query.delete_project_item_mutation(),
             %{"projectId" => project_id, "itemId" => item_id},
             []
           ),
         {:ok, deleted_id} <- Query.deleted_project_item_id(response) do
      {:ok, deleted_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @doc """
  Links `child_identifier` as a GitHub sub-issue of `parent_identifier` via
  `addSubIssue`. Supports cross-repository links within the same owner.
  """
  @spec link_sub_issue(Project.t(), String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def link_sub_issue(%Project{} = project, parent_identifier, child_identifier) do
    with {:ok, parent_node_id} <- issue_graphql_node_id(project, parent_identifier),
         {:ok, child_node_id} <- issue_graphql_node_id(project, child_identifier),
         {:ok, response} <-
           client().graphql(
             Query.add_sub_issue_mutation(),
             %{
               "input" => %{
                 "issueId" => parent_node_id,
                 "subIssueId" => child_node_id,
                 "replaceParent" => true
               }
             },
             []
           ),
         {:ok, sub_issue_id} <- Query.linked_sub_issue_id(response) do
      {:ok, sub_issue_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @doc """
  Removes the parent link for `child_identifier` on GitHub via `removeSubIssue`.
  """
  @spec unlink_sub_issue(Project.t(), String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def unlink_sub_issue(%Project{} = project, parent_identifier, child_identifier) do
    with {:ok, parent_node_id} <- issue_graphql_node_id(project, parent_identifier),
         {:ok, child_node_id} <- issue_graphql_node_id(project, child_identifier),
         {:ok, response} <-
           client().graphql(
             Query.remove_sub_issue_mutation(),
             %{
               "input" => %{
                 "issueId" => parent_node_id,
                 "subIssueId" => child_node_id
               }
             },
             []
           ),
         {:ok, sub_issue_id} <- Query.unlinked_sub_issue_id(response) do
      {:ok, sub_issue_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  defp archive_project_item(%Project{} = project, identifier, mutation) do
    %{project_id: project_id} = config(project)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, %{}),
         {:ok, response} <-
           client().graphql(
             mutation,
             %{"projectId" => project_id, "itemId" => item_id},
             []
           ),
         {:ok, archived_id} <- Query.archived_project_item_id(response) do
      {:ok, archived_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_comments(%Project{} = project, identifier) do
    with {:ok, repo} <- resolve_issue_repo(project, identifier),
         {:ok, number} <- resolve_issue_number(project, identifier) do
      case IssueComments.for_issue(repo, Integer.to_string(number)) do
        {:ok, comments} -> {:ok, comments}
        {:error, {:invalid_issue_identifier, _}} -> {:ok, []}
        error -> {:error, map_error(error)}
      end
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def add_comment(%Project{} = project, identifier, body, attrs) do
    body = maybe_rewrite_comment_body(project, identifier, body)

    case issue_remote_id(project, identifier, attrs || %{}) do
      node_id when is_binary(node_id) and node_id != "" -> create_comment_by_node(node_id, body)
      _no_node_id -> create_comment_by_identifier(project, identifier, body)
    end
  end

  # Preferred path: the issue's GraphQL node id is known (local store), so we can
  # post even when the tracker identifier is non-numeric (e.g. `GAM-5`) or the
  # issue lives outside the configured repo.
  defp create_comment_by_node(node_id, body) do
    case IssueComments.create_for_subject(node_id, body) do
      {:ok, comment} -> {:ok, comment}
      error -> {:error, map_error(error)}
    end
  end

  # Legacy fallback when no node id is stored: resolve repo + numeric number.
  defp create_comment_by_identifier(project, identifier, body) do
    case resolve_issue_repo(project, identifier) do
      {:ok, repo} -> create_comment_in_repo(repo, identifier, body)
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  defp create_comment_in_repo(repo, identifier, body) do
    case IssueComments.create(repo, identifier, body) do
      {:ok, comment} -> {:ok, comment}
      error -> {:error, map_error(error)}
    end
  end

  @doc """
  Edits an existing issue comment in place (workpad updates). `remote_id` is the
  comment id returned when it was created (GraphQL node id or REST numeric id).
  """
  @impl true
  @spec update_comment(Project.t(), String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def update_comment(%Project{} = project, identifier, remote_id, body) do
    case resolve_issue_repo(project, identifier) do
      {:ok, repo} ->
        body = rewrite_body_for_repo(project, repo, body)

        case IssueComments.update(repo, remote_id, body) do
          {:ok, comment} -> {:ok, comment}
          error -> {:error, map_error(error)}
        end

      {:error, reason} ->
        {:error, map_error(reason)}
    end
  end

  @impl true
  @spec delete_comment(Project.t(), String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def delete_comment(%Project{} = project, identifier, remote_id) do
    case resolve_issue_repo(project, identifier) do
      {:ok, repo} ->
        case IssueComments.delete(repo, remote_id) do
          :ok -> {:ok, %{id: remote_id}}
          error -> {:error, map_error(error)}
        end

      {:error, reason} ->
        {:error, map_error(reason)}
    end
  end

  # Comments take the bare body string, so attachment rewriting happens here
  # rather than threaded through `attrs`. Repo resolution is skipped unless the
  # body actually references a local attachment to keep the common path cheap.
  defp maybe_rewrite_comment_body(%Project{slug: slug} = project, identifier, body)
       when is_binary(body) and is_binary(slug) do
    if AttachmentRewriter.contains_attachment?(body, slug) do
      case resolve_issue_repo(project, identifier) do
        {:ok, repo} -> rewrite_body_for_repo(project, repo, body)
        _ -> body
      end
    else
      body
    end
  end

  defp maybe_rewrite_comment_body(_project, _identifier, body), do: body

  defp rewrite_body_for_repo(%Project{slug: slug}, repo, body)
       when is_binary(body) and is_binary(slug) do
    with true <- AttachmentRewriter.contains_attachment?(body, slug),
         {:ok, {owner, name}} <- RepoSpec.split(repo) do
      AttachmentRewriter.rewrite(body, owner, name, slug)
    else
      _ -> body
    end
  end

  defp rewrite_body_for_repo(_project, _repo, body), do: body

  # Sync reads remote bodies that may carry Symphony-managed GitHub asset URLs
  # (written by the outgoing rewrite). Map them back to local attachment URLs so
  # the local store stays local-first and the tracker renders via its own
  # authenticated endpoint. The uploads index is built once per call and only
  # when a managed URL is present.
  defp restore_attachment_urls(issues, slug) when is_binary(slug) do
    if Enum.any?(issues, fn issue -> AttachmentRewriter.has_managed_asset?(Map.get(issue, :description)) end) do
      index = AttachmentRewriter.build_index(slug)

      Enum.map(issues, fn issue ->
        %{issue | description: AttachmentRewriter.restore(issue.description, slug, index: index)}
      end)
    else
      issues
    end
  end

  defp restore_attachment_urls(issues, _slug), do: issues

  defp config(%Project{tracker_config: cfg}) do
    %{
      project_id: Map.fetch!(cfg, "project_id"),
      repo: Map.get(cfg, "repo"),
      status_field: Map.get(cfg, "status_field", "Status")
    }
  end

  defp fetch_repo_metadata(owner, name) do
    case client().graphql(Query.repo_metadata_query(), %{"owner" => owner, "name" => name}, []) do
      {:ok, response} ->
        case Query.repository_id(response) do
          {:ok, repo_id} -> {:ok, %{repo_id: repo_id, labels: Query.labels(response)}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp require_title(attrs) do
    case attrs |> Map.get("title") |> trim_string() do
      "" -> {:error, {:remote_validation, %{title: ["is required"]}}}
      title -> {:ok, title}
    end
  end

  defp resolve_label_ids(labels, attrs) do
    by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label.id} end)

    (string_list(Map.get(attrs, "label_ids")) ++
       agent_label_ids(by_name, Map.get(attrs, "agent")) ++
       priority_label_ids(by_name, Map.get(attrs, "priority")))
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp agent_label_ids(by_name, agent) when agent in @agent_kinds do
    case Map.get(by_name, "symphony:" <> agent) do
      id when is_binary(id) -> [id]
      _ -> []
    end
  end

  defp agent_label_ids(_by_name, _agent), do: []

  # Applies the `symphony:<agent>` routing label so the orchestrator admits the
  # issue and resolves the coding agent. GitHub `move_issue` only updates the
  # Status field, so without this an assistant dispatch never enters observability.
  defp maybe_apply_agent_routing_label(%Project{} = project, identifier, attrs) do
    case normalize_agent_kind(Map.get(attrs, "agent") || Map.get(attrs, :agent)) do
      nil -> :ok
      agent -> apply_agent_routing_label(project, identifier, agent)
    end
  end

  defp apply_agent_routing_label(%Project{} = project, identifier, agent) do
    label_name = "symphony:" <> agent

    with {:ok, repo} <- resolve_issue_repo(project, identifier),
         {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- resolve_issue_number(project, identifier),
         {:ok, issue_node_id} <- fetch_issue_node_id(owner, name, number),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         {:ok, label_id} <- find_label_id(meta.labels, label_name),
         {:ok, _} <- add_labels(issue_node_id, [label_id]) do
      :ok
    end
  end

  defp normalize_agent_kind(agent) when is_binary(agent) do
    case agent |> String.trim() |> String.downcase() do
      normalized when normalized in @agent_kinds -> normalized
      _ -> nil
    end
  end

  defp normalize_agent_kind(_agent), do: nil

  defp find_label_id(labels, label_name) when is_list(labels) do
    target = String.downcase(label_name)

    labels
    |> Enum.find(fn label -> String.downcase(label.name || "") == target end)
    |> case do
      %{id: id} when is_binary(id) -> {:ok, id}
      _ -> {:error, {:agent_label_missing, label_name}}
    end
  end

  defp add_labels(labelable_id, label_ids) do
    variables = %{"labelableId" => labelable_id, "labelIds" => label_ids}

    case client().graphql(Query.add_labels_mutation(), variables, []) do
      {:ok, response} -> {:ok, response}
      {:error, _} = error -> error
    end
  end

  defp priority_label_ids(by_name, priority) do
    case normalize_priority(priority) do
      nil ->
        []

      value ->
        case Map.get(by_name, "priority:" <> Integer.to_string(value)) do
          id when is_binary(id) -> [id]
          _ -> []
        end
    end
  end

  defp normalize_priority(value) when is_integer(value) and value in 0..4, do: value

  defp normalize_priority(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed in 0..4 -> parsed
      _ -> nil
    end
  end

  defp normalize_priority(_value), do: nil

  defp resolve_status_target(_cfg, status) when status in [nil, ""], do: {:ok, nil}

  defp resolve_status_target(cfg, status) do
    case client().graphql(Query.status_options_query(), %{"projectId" => cfg.project_id}, []) do
      {:ok, response} ->
        case Query.resolve_field_and_option(response, cfg.status_field, status) do
          {:ok, field_id, option_id} -> {:ok, {field_id, option_id}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp create_remote_issue(%Project{} = project, repo_id, title, attrs, label_ids, remote_body) do
    assignee_ids =
      case assignee_ids_attr(attrs) do
        :skip -> []
        ids -> resolve_github_assignee_ids(project, ids)
      end

    input =
      %{"repositoryId" => repo_id, "title" => title, "body" => remote_body}
      |> put_when_present("labelIds", label_ids)
      |> put_when_present("assigneeIds", assignee_ids)

    case client().graphql(Query.create_issue_mutation(), %{"input" => input}, []) do
      {:ok, response} -> Query.created_issue(response)
      {:error, _} = error -> error
    end
  end

  defp add_to_project(project_id, content_id) do
    variables = %{"projectId" => project_id, "contentId" => content_id}

    case client().graphql(Query.add_project_item_mutation(), variables, []) do
      {:ok, response} -> Query.project_item_id(response)
      {:error, _} = error -> error
    end
  end

  defp resolve_move_item_id(%Project{} = project, project_id, identifier, attrs) do
    case Map.get(attrs, "item_id") || Map.get(attrs, :item_id) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        cond do
          project_item_id?(identifier) ->
            {:ok, identifier}

          true ->
            case resolve_move_item_id_from_remote_id(project, project_id, identifier, attrs) do
              {:ok, item_id} -> {:ok, item_id}
              :skip -> resolve_move_item_id_from_issue_number(project, project_id, identifier)
            end
        end
    end
  end

  defp project_item_id?(id) when is_binary(id), do: String.starts_with?(id, "PVTI_")
  defp project_item_id?(_), do: false

  defp resolve_move_item_id_from_remote_id(%Project{} = project, project_id, identifier, attrs) do
    case issue_remote_id(project, identifier, attrs) do
      id when is_binary(id) and id != "" ->
        case fetch_project_item_id(id, project_id) do
          {:ok, _} = ok -> ok
          _ -> :skip
        end

      _ ->
        :skip
    end
  end

  defp resolve_move_item_id_from_issue_number(%Project{} = project, project_id, identifier) do
    with {:ok, number} <- parse_issue_number(identifier),
         {:ok, issue_node_id} <- resolve_issue_node_id(project, identifier, number) do
      fetch_project_item_id(issue_node_id, project_id)
    end
  end

  defp resolve_issue_repo(%Project{} = project, identifier) do
    IssueRepo.resolve(project, identifier)
  end

  defp resolve_issue_node_id(%Project{} = project, identifier, number) do
    IssueRepo.candidate_repos(project, identifier)
    |> Enum.reduce_while({:error, :issue_not_found}, fn repo, _acc ->
      with {:ok, {owner, name}} <- RepoSpec.split(repo),
           {:ok, node_id} <- fetch_issue_node_id(owner, name, number) do
        {:halt, {:ok, node_id}}
      else
        _ -> {:cont, {:error, :issue_not_found}}
      end
    end)
  end

  defp issue_remote_id(%Project{} = project, identifier, attrs) do
    remote_id_from_attrs(attrs) || local_issue_remote_id(project, identifier)
  end

  defp remote_id_from_attrs(attrs) do
    Map.get(attrs, "remote_id") || Map.get(attrs, :remote_id)
  end

  defp local_issue_remote_id(%Project{slug: slug}, identifier) when is_binary(slug) do
    case Context.get_issue(slug, identifier) do
      {:ok, %{remote_id: id}} when is_binary(id) and id != "" -> id
      _ -> nil
    end
  end

  defp local_issue_remote_id(_, _), do: nil

  defp issue_graphql_node_id(%Project{} = project, identifier) do
    case local_issue_remote_id(project, identifier) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        with {:ok, number} <- resolve_issue_number(project, identifier),
             {:ok, repo} <- resolve_issue_repo(project, identifier),
             {:ok, {owner, name}} <- RepoSpec.split(repo),
             {:ok, node_id} <- fetch_issue_node_id(owner, name, number) do
          {:ok, node_id}
        end
    end
  end

  defp fetch_issue_node_id(owner, name, number) do
    case fetch_issue_details(owner, name, number) do
      {:ok, %{"id" => id}} when is_binary(id) -> {:ok, id}
      error -> error
    end
  end

  defp fetch_issue_details(owner, name, number) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client().graphql(Query.issue_node_id_query(), variables, []) do
      {:ok, response} -> Query.issue_details(response)
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_update_issue_content(%Project{} = project, owner, name, %{"id" => issue_id}, attrs) do
    remote_body = AttachmentRewriter.rewrite(description_attr(attrs), owner, name, project.slug)

    fields =
      %{}
      |> maybe_put_issue_field("title", title_attr(attrs))
      |> maybe_put_issue_field("body", remote_body)
      |> maybe_put_assignee_ids(project, attrs)

    if fields == %{} do
      {:ok, nil}
    else
      input = Map.put(fields, "id", issue_id)

      case client().graphql(Query.update_issue_mutation(), %{"input" => input}, []) do
        {:ok, response} -> Query.updated_issue(response)
        {:error, _} = error -> error
      end
    end
  end

  defp maybe_put_issue_field(map, _key, nil), do: map
  defp maybe_put_issue_field(map, key, value), do: Map.put(map, key, value)

  defp maybe_put_assignee_ids(map, project, attrs) do
    case assignee_ids_attr(attrs) do
      :skip -> map
      ids -> Map.put(map, "assigneeIds", resolve_github_assignee_ids(project, ids))
    end
  end

  defp resolve_github_assignee_ids(_project, []), do: []

  # Resolve logins/ids to GitHub user node ids. Prefer live assignable users, then
  # the local `tracker_users` cache. Never pass unresolved logins through — GraphQL
  # treats them as node ids and fails create/update with remote_validation.
  defp resolve_github_assignee_ids(%Project{} = project, requested) do
    remote_users =
      case list_assignable_users(project) do
        {:ok, users} when is_list(users) -> users
        _ -> []
      end

    by_id = Map.new(remote_users, fn user -> {user.id, user.id} end)
    by_login = Map.new(remote_users, fn user -> {String.downcase(user.login || ""), user.id} end)
    local_by_login = local_assignee_ids_by_login(project)

    requested
    |> Enum.map(&resolve_one_github_assignee(&1, by_id, by_login, local_by_login))
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp resolve_one_github_assignee(value, by_id, by_login, local_by_login) when is_binary(value) do
    trimmed = String.trim(value)
    login = String.downcase(trimmed)

    cond do
      trimmed == "" -> nil
      Map.has_key?(by_id, trimmed) -> trimmed
      Map.has_key?(by_login, login) -> Map.fetch!(by_login, login)
      Map.has_key?(local_by_login, login) -> Map.fetch!(local_by_login, login)
      github_user_node_id?(trimmed) -> trimmed
      true -> nil
    end
  end

  defp resolve_one_github_assignee(_value, _by_id, _by_login, _local_by_login), do: nil

  defp local_assignee_ids_by_login(%Project{id: project_id}) when is_integer(project_id) do
    from(user in UserRecord,
      where: user.project_id == ^project_id and not is_nil(user.remote_id) and user.remote_id != "",
      select: {user.login, user.remote_id}
    )
    |> Repo.all()
    |> Map.new(fn {login, remote_id} -> {String.downcase(login || ""), remote_id} end)
  end

  defp local_assignee_ids_by_login(_project), do: %{}

  defp github_user_node_id?(value) when is_binary(value) do
    String.starts_with?(value, "U_") or String.starts_with?(value, "MDQ6VXNlc")
  end

  defp github_user_node_id?(_value), do: false

  defp maybe_sync_issue_labels(issue, repo_labels, attrs) do
    label_change? = Map.has_key?(attrs, "label_ids") or Map.has_key?(attrs, "labels")
    priority_change? = Map.has_key?(attrs, "priority") or Map.has_key?(attrs, :priority)
    agent_change? = Map.has_key?(attrs, "agent") or Map.has_key?(attrs, :agent)

    if not label_change? and not priority_change? and not agent_change? do
      :ok
    else
      issue_id = Map.fetch!(issue, "id")
      current = current_label_nodes(issue)
      by_name = Map.new(repo_labels, fn label -> {String.downcase(label.name || ""), label.id} end)
      requested_system_ids = requested_system_label_ids(repo_labels, label_ids_attr(attrs))

      system_ids =
        cond do
          agent_change? ->
            agent_label_ids(by_name, Map.get(attrs, "agent") || Map.get(attrs, :agent))

          requested_system_ids != [] ->
            requested_system_ids

          true ->
            system_label_ids(current)
        end

      user_ids =
        case label_ids_attr(attrs) do
          nil ->
            current
            |> Enum.reject(fn node ->
              name = Map.get(node, "name")
              system_label_name?(name) or priority_label_name?(name)
            end)
            |> Enum.map(& &1["id"])
            |> Enum.reject(&is_nil/1)

          requested ->
            resolve_requested_label_ids(repo_labels, requested)
        end

      priority_ids =
        if priority_change? do
          priority_label_ids(by_name, Map.get(attrs, "priority") || Map.get(attrs, :priority))
        else
          current
          |> Enum.filter(fn node -> priority_label_name?(Map.get(node, "name")) end)
          |> Enum.map(& &1["id"])
          |> Enum.reject(&is_nil/1)
        end

      label_ids = Enum.uniq(system_ids ++ user_ids ++ priority_ids)

      case client().graphql(Query.update_issue_mutation(), %{"input" => %{"id" => issue_id, "labelIds" => label_ids}}, []) do
        {:ok, _} -> :ok
        {:error, _} = error -> error
      end
    end
  end

  defp current_label_nodes(%{"labels" => %{"nodes" => nodes}}) when is_list(nodes), do: nodes
  defp current_label_nodes(_issue), do: []

  defp system_label_ids(nodes) do
    nodes
    |> Enum.filter(fn node -> system_label_name?(Map.get(node, "name")) end)
    |> Enum.map(& &1["id"])
    |> Enum.reject(&is_nil/1)
  end

  defp system_label_name?(name) when is_binary(name) do
    String.match?(String.downcase(String.trim(name)), ~r/^symphony(?::.*)?$/)
  end

  defp system_label_name?(_name), do: false

  defp priority_label_name?(name) when is_binary(name) do
    String.match?(String.downcase(String.trim(name)), ~r/^priority:\d$/)
  end

  defp priority_label_name?(_name), do: false

  defp resolve_requested_label_ids(labels, requested) do
    labels_by_id = Map.new(labels, fn label -> {label.id, label} end)
    labels_by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label} end)

    requested
    |> Enum.map(fn value ->
      cond do
        is_binary(value) and Map.has_key?(labels_by_id, value) -> reject_reserved_label_id(labels_by_id[value])
        is_binary(value) -> labels_by_name |> Map.get(String.downcase(String.trim(value))) |> reject_reserved_label_id()
        true -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp requested_system_label_ids(_labels, nil), do: []

  defp requested_system_label_ids(labels, requested) do
    labels_by_id = Map.new(labels, fn label -> {label.id, label} end)
    labels_by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label} end)

    requested
    |> List.wrap()
    |> Enum.map(fn value ->
      cond do
        is_binary(value) and Map.has_key?(labels_by_id, value) -> system_label_id(labels_by_id[value])
        is_binary(value) -> labels_by_name |> Map.get(String.downcase(String.trim(value))) |> system_label_id()
        true -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp reject_reserved_label_id(%{id: id, name: name}) when is_binary(id) do
    if system_label_name?(name) or priority_label_name?(name), do: nil, else: id
  end

  defp reject_reserved_label_id(_label), do: nil

  defp system_label_id(%{id: id, name: name}) when is_binary(id) do
    if system_label_name?(name), do: id, else: nil
  end

  defp system_label_id(_label), do: nil

  defp title_attr(attrs) do
    case attrs |> Map.get("title") |> trim_string() do
      "" -> nil
      value -> value
    end
  end

  defp description_attr(attrs) do
    if Map.has_key?(attrs, "description") or Map.has_key?(attrs, :description) do
      case attrs |> Map.get("description") |> trim_string() do
        "" -> ""
        value -> value
      end
    else
      nil
    end
  end

  defp label_ids_attr(attrs) do
    cond do
      Map.has_key?(attrs, "label_ids") ->
        values = string_list(Map.get(attrs, "label_ids")) |> Enum.uniq()
        if values == [], do: [], else: values

      Map.has_key?(attrs, "labels") ->
        values = string_list(Map.get(attrs, "labels")) |> Enum.uniq()
        if values == [], do: [], else: values

      true ->
        nil
    end
  end

  defp assignee_ids_attr(attrs) do
    cond do
      Map.has_key?(attrs, "assignee_ids") ->
        string_list(Map.get(attrs, "assignee_ids"))

      Map.has_key?(attrs, :assignee_ids) ->
        string_list(Map.get(attrs, :assignee_ids))

      Map.has_key?(attrs, "assignee_id") ->
        case Map.get(attrs, "assignee_id") do
          value when is_binary(value) and value != "" -> [value]
          _ -> []
        end

      true ->
        :skip
    end
  end

  defp fetch_project_item_id(issue_node_id, project_id) do
    variables = %{"issueId" => issue_node_id, "first" => 50}

    case client().graphql(Query.resolve_project_item_query(), variables, []) do
      {:ok, %{"data" => %{"node" => %{"projectItems" => %{"nodes" => nodes}}}}} when is_list(nodes) ->
        case find_project_item_id(nodes, project_id) do
          id when is_binary(id) -> {:ok, id}
          _ -> {:error, :issue_not_found}
        end

      {:ok, %{"data" => %{"node" => nil}}} ->
        {:error, :issue_not_found}

      {:ok, _payload} ->
        {:error, :issue_not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp find_project_item_id(nodes, project_id) do
    nodes
    |> List.wrap()
    |> Enum.find_value(fn
      %{"id" => id, "project" => %{"id" => ^project_id}} -> id
      _ -> nil
    end)
  end

  defp parse_issue_number(identifier) when is_binary(identifier) do
    trimmed = String.trim(identifier)

    case trimmed do
      "#" <> rest -> parse_issue_digits(rest)
      digits -> parse_issue_digits(digits)
    end
  end

  defp parse_issue_number(_identifier), do: {:error, :invalid_issue_identifier}

  defp find_issue_dto(issues, identifier) do
    case Enum.find(issues, &(&1.identifier == identifier)) do
      nil -> :not_found
      dto -> {:ok, dto}
    end
  end

  defp find_issue_dto_by_local_mirror(%Project{} = project, issues, identifier) do
    with {:ok, number} <- resolve_issue_number(project, identifier),
         {:ok, repo} <- mirror_repo(project, identifier) do
      remote_identifier = Query.repo_scoped_identifier(repo, number)

      case Enum.find(issues, &issue_dto_matches_remote?(&1, repo, number, remote_identifier)) do
        %IssueDTO{} = dto -> {:ok, dto}
        _ -> {:error, :issue_not_found}
      end
    else
      _ -> {:error, :issue_not_found}
    end
  end

  defp mirror_repo(%Project{slug: slug} = project, identifier) when is_binary(slug) do
    case Context.get_issue(slug, identifier) do
      {:ok, %{remote_url: url}} when is_binary(url) and url != "" ->
        case IssueRepo.repo_from_issue_url(url) do
          {:ok, repo} -> {:ok, repo}
          :error -> IssueRepo.resolve(project, identifier)
        end

      _ ->
        IssueRepo.resolve(project, identifier)
    end
  end

  defp issue_dto_matches_remote?(dto, repo, number, remote_identifier) do
    dto.identifier == remote_identifier or
      dto.identifier == to_string(number) or
      (is_binary(dto.url) and String.ends_with?(dto.url, "/issues/#{number}") and
         (dto.repository_full_name == repo or is_nil(dto.repository_full_name)))
  end

  defp resolve_issue_number(%Project{} = project, identifier) do
    case parse_issue_number(identifier) do
      {:ok, number} -> {:ok, number}
      {:error, _reason} -> local_issue_remote_number(project, identifier)
    end
  end

  defp local_issue_remote_number(%Project{slug: slug}, identifier) when is_binary(slug) do
    case Context.get_issue(slug, identifier) do
      {:ok, %{remote_number: number}} when is_integer(number) and number > 0 -> {:ok, number}
      _ -> {:error, :invalid_issue_identifier}
    end
  end

  defp local_issue_remote_number(_project, _identifier), do: {:error, :invalid_issue_identifier}

  defp parse_issue_digits(digits) do
    case Integer.parse(String.trim(digits)) do
      {number, ""} when number > 0 -> {:ok, number}
      _ -> {:error, :invalid_issue_identifier}
    end
  end

  defp apply_status_target(_cfg, _item_id, nil), do: :ok

  defp apply_status_target(cfg, item_id, {field_id, option_id}) do
    variables = %{
      "projectId" => cfg.project_id,
      "itemId" => item_id,
      "fieldId" => field_id,
      "optionId" => option_id
    }

    case client().graphql(Query.update_field_value_mutation(), variables, []) do
      {:ok, _response} -> :ok
      {:error, _} = error -> error
    end
  end

  defp build_created_dto(issue, %Project{} = project, attrs, labels, label_ids) do
    IssueDTO.build(%{
      id: issue["id"],
      identifier: to_string(issue["number"]),
      title: issue["title"] || Map.get(attrs, "title"),
      description: body(attrs),
      url: issue["url"],
      labels: label_names(labels, label_ids),
      status: status_dto(status_name(attrs)),
      project_slug: project.slug
    })
  end

  defp label_names(labels, label_ids) do
    by_id = Map.new(labels, fn label -> {label.id, label.name} end)

    label_ids
    |> Enum.map(&Map.get(by_id, &1))
    |> Enum.reject(&is_nil/1)
  end

  defp status_dto(status) when status in [nil, ""], do: nil

  defp status_dto(status) do
    category = Query.category_for(status)
    %{name: status, category: category, position: nil, is_terminal: category in ["completed", "canceled"]}
  end

  defp status_name(attrs), do: attrs |> Map.get("status") |> trim_string()

  defp body(attrs) do
    case attrs |> Map.get("description") |> trim_string() do
      "" -> nil
      value -> value
    end
  end

  defp put_when_present(map, _key, []), do: map
  defp put_when_present(map, key, value), do: Map.put(map, key, value)

  defp string_list(value) when is_list(value), do: Enum.filter(value, &(is_binary(&1) and &1 != ""))
  defp string_list(_value), do: []

  defp trim_string(value) when is_binary(value), do: String.trim(value)
  defp trim_string(_value), do: ""

  defp client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:invalid_repository, message}), do: {:remote_validation, %{repository: [message]}}
  defp map_error(:issue_not_found), do: :issue_not_found
  defp map_error(:pending_remote_id), do: :pending_remote_id
  defp map_error({:invalid_issue_identifier, _identifier}), do: :issue_not_found
  defp map_error(:status_not_found), do: :status_not_found
  defp map_error(:missing_github_token), do: :missing_credentials

  defp map_error({:agent_label_missing, label_name}),
    do:
      {:remote_validation,
       %{
         agent_label: [
           "repository is missing the \"#{label_name}\" label required to route this issue to the agent"
         ]
       }}

  defp map_error({:github_graphql_errors, errors}),
    do: {:remote_validation, %{errors: summarize_graphql_errors(errors)}}

  defp map_error({:rate_limited, info}) when is_map(info), do: {:rate_limited, info}
  defp map_error(reason), do: RemoteError.normalize(reason, :github_api_status)

  defp summarize_graphql_errors(errors) when is_list(errors) do
    Enum.flat_map(errors, fn
      %{"message" => message} when is_binary(message) -> [message]
      _ -> []
    end)
  end

  defp summarize_graphql_errors(_errors), do: []
end
