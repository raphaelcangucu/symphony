defmodule SymphonyElixir.Tracker.Sync.LocalStore do
  @moduledoc """
  Upserts remote tracker data (issues, comments, labels, pull requests) into the
  local SQLite store, keyed by `(project_id, remote_id)`.

  Insert path creates a fully mirrored issue. Update path applies field-level
  last-writer-wins via `Tracker.Sync.Merge`, preserving pending local edits
  (`dirty_fields`). All functions are idempotent.
  """

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Comment, Context, IssueLabel, IssueRecord, Label, Project, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Merge, PullRequestRecord, UserRecord}

  # Fields subject to LWW merge on update (untouched-locally take remote).
  @syncable_fields ~w(title description priority assignee_id)a

  @spec upsert_remote_issue(Project.t(), map()) ::
          {:ok, IssueRecord.t()} | {:error, term()}
  def upsert_remote_issue(%Project{} = project, %{remote_id: remote_id} = remote)
      when is_binary(remote_id) do
    Repo.transaction(fn -> do_upsert_remote_issue(project, remote) end)
  end

  @doc """
  Upserts many remote issues (with their labels/comments) in a **single
  transaction**, so a full pull commits once instead of once per issue. This
  collapses SQLite write-lock acquisitions and WAL fsyncs from O(issues) to O(1)
  per pull, which is the main source of `Database busy` contention.

  No network is performed here: callers must pre-fetch any per-issue remote data
  (e.g. comments) and attach it to each map first, so the write lock is never
  held across I/O. Returns the count of issues processed.
  """
  @spec upsert_remote_issues(Project.t(), [map()]) :: {:ok, non_neg_integer()} | {:error, term()}
  def upsert_remote_issues(%Project{} = project, remotes) when is_list(remotes) do
    Repo.transaction(fn ->
      Enum.reduce(remotes, 0, fn
        %{remote_id: remote_id} = remote, acc when is_binary(remote_id) ->
          do_upsert_remote_issue(project, remote)
          acc + 1

        _invalid, acc ->
          acc
      end)
    end)
  end

  defp do_upsert_remote_issue(project, %{remote_id: remote_id} = remote) do
    status_id = resolve_status_id(project.id, remote[:state])

    issue =
      case existing_issue(project.id, remote_id) do
        nil -> insert_issue!(project, remote, status_id)
        %IssueRecord{} = current -> update_issue!(current, remote, status_id)
      end

    :ok = maybe_upsert_labels!(project, issue, Map.get(remote, :labels, []))
    :ok = upsert_comments!(issue, Map.get(remote, :comments, []))

    Repo.preload(issue, [:status, :labels, :comments], force: true)
  end

  @doc """
  Upserts a project's workflow statuses from the remote (idempotent on
  `(project_id, name)`). Must run before seeding issues so each issue's status
  name resolves to a `status_id`; without it, issue inserts fail with a blank
  `status_id`.
  """
  @spec upsert_statuses(Project.t(), [map()]) :: :ok
  def upsert_statuses(%Project{} = project, statuses) when is_list(statuses) do
    statuses
    |> Enum.with_index()
    |> Enum.each(fn {status, index} ->
      name = status_attr(status, :name)

      if is_binary(name) and name != "" do
        upsert_status!(project.id, %{
          project_id: project.id,
          name: name,
          category: status_attr(status, :category) || "active",
          position: status_attr(status, :position) || index,
          is_terminal: status_attr(status, :is_terminal) || false
        })
      end
    end)

    :ok
  end

  @doc """
  Upserts assignable users from the remote tracker into `tracker_users` (idempotent
  on `(project_id, login)`). Used during sync so form options and assignee
  resolution work offline after the first pull.
  """
  @spec upsert_users(Project.t(), [map()]) :: :ok
  def upsert_users(%Project{} = project, users) when is_list(users) do
    users
    |> Enum.each(fn user ->
      login = user_attr(user, :login)

      if is_binary(login) and login != "" do
        upsert_user!(project.id, %{
          project_id: project.id,
          remote_id: user_attr(user, :id),
          login: login,
          name: user_attr(user, :name),
          avatar_url: user_attr(user, :avatar_url)
        })
      end
    end)

    :ok
  end

  defp user_attr(user, key) when is_map(user) do
    Map.get(user, key, Map.get(user, Atom.to_string(key)))
  end

  defp upsert_user!(project_id, %{login: login} = attrs) do
    case Repo.get_by(UserRecord, project_id: project_id, login: login) do
      nil -> %UserRecord{}
      %UserRecord{} = existing -> existing
    end
    |> UserRecord.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  defp status_attr(status, key) when is_map(status) do
    Map.get(status, key, Map.get(status, Atom.to_string(key)))
  end

  defp upsert_status!(project_id, %{name: name} = attrs) do
    case Repo.get_by(WorkflowStatus, project_id: project_id, name: name) do
      nil -> %WorkflowStatus{}
      %WorkflowStatus{} = existing -> existing
    end
    |> WorkflowStatus.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  @doc """
  Marks `fields` as locally-edited on an issue (so a later remote pull respects
  LWW) and flips its `sync_status` to `pending`.
  """
  @spec mark_dirty(String.t(), String.t(), [atom()]) :: {:ok, IssueRecord.t()} | {:error, term()}
  def mark_dirty(identifier, project_slug, fields) when is_list(fields) do
    with {:ok, issue} <- Context.get_issue(project_slug, identifier) do
      now_iso = DateTime.to_iso8601(DateTime.utc_now())
      dirty = Enum.reduce(fields, issue.dirty_fields || %{}, fn field, acc -> Map.put(acc, Atom.to_string(field), now_iso) end)

      issue
      |> IssueRecord.changeset(%{dirty_fields: dirty, sync_status: "pending"})
      |> Repo.update()
    end
  end

  @doc """
  Drops pushed fields from `dirty_fields` after a successful outbox write so later
  remote pulls can reconcile them again.
  """
  @spec clear_dirty_fields(String.t(), String.t(), [atom() | String.t()]) ::
          {:ok, IssueRecord.t()} | {:error, term()}
  def clear_dirty_fields(identifier, project_slug, fields) when is_list(fields) do
    with {:ok, issue} <- Context.get_issue(project_slug, identifier),
         cleared_keys when cleared_keys != [] <- Enum.map(fields, &to_string/1) do
      dirty =
        Enum.reduce(cleared_keys, issue.dirty_fields || %{}, fn field, acc ->
          Map.delete(acc, field)
        end)

      sync_status = if dirty == %{}, do: "synced", else: issue.sync_status

      issue
      |> IssueRecord.changeset(%{dirty_fields: dirty, sync_status: sync_status})
      |> Repo.update()
    else
      [] -> {:error, :no_fields}
      {:error, _} = error -> error
    end
  end

  @doc """
  Upserts PRs mirrored by the local-first sync engine. Keyed by
  `(project_id, issue_identifier, remote_id)`; also records `issue_id`.
  """
  @spec upsert_pull_requests(IssueRecord.t(), [map()]) :: :ok
  def upsert_pull_requests(%IssueRecord{} = issue, prs) when is_list(prs) do
    Enum.each(prs, fn pr ->
      upsert_one!(issue.project_id, issue.identifier, Map.put(pr, :issue_id, issue.id))
    end)

    :ok
  end

  @doc """
  Upserts PRs discovered live for an issue (live tracker mode; no local issue
  row required). Defaults `origin` to `"auto"`.
  """
  @spec upsert_discovered_pull_requests(integer(), String.t(), [map()]) :: :ok
  def upsert_discovered_pull_requests(project_id, identifier, prs)
      when is_integer(project_id) and is_list(prs) do
    Enum.each(prs, fn pr ->
      upsert_one!(project_id, identifier, Map.put(pr, :origin, pr[:origin] || "auto"))
    end)

    :ok
  end

  @doc """
  Links a pull request to an issue from a manual user action (e.g. pasting a
  cross-repo PR URL). Uses the URL as `remote_id` so the link survives even when
  GitHub cannot be queried (no App access / 404). Keyed by
  `(project_id, issue_identifier, url)` so it works in live tracker mode.
  """
  @spec link_manual_pull_request(integer(), String.t(), map()) ::
          {:ok, PullRequestRecord.t()} | {:error, Ecto.Changeset.t()}
  def link_manual_pull_request(project_id, identifier, %{url: url} = attrs)
      when is_integer(project_id) and is_binary(url) do
    identifier = normalize_identifier(identifier)

    base = %{
      project_id: project_id,
      issue_identifier: identifier,
      remote_id: url,
      url: url,
      number: Map.get(attrs, :number),
      repo: Map.get(attrs, :repo),
      title: Map.get(attrs, :title) || manual_title(Map.get(attrs, :number)),
      state: Map.get(attrs, :state) || "unknown",
      origin: "manual",
      last_synced_at: DateTime.utc_now()
    }

    case Repo.get_by(PullRequestRecord,
           project_id: project_id,
           issue_identifier: identifier,
           remote_id: url
         ) do
      nil -> %PullRequestRecord{}
      %PullRequestRecord{} = existing -> existing
    end
    |> PullRequestRecord.changeset(base)
    |> Repo.insert_or_update()
  end

  @doc """
  Links a pull request verified or created by the orchestrator's run contract
  (publish gate / finalizer). Keyed by URL like manual links so the association
  is deterministic and survives GitHub discovery gaps (e.g. non-numeric tracker
  identifiers such as GAM-5). Origin `"agent"` distinguishes it in the UI.
  """
  @spec upsert_run_pull_request(integer(), String.t(), %{required(:url) => String.t(), optional(atom()) => term()}) ::
          {:ok, PullRequestRecord.t()} | {:error, Ecto.Changeset.t()}
  def upsert_run_pull_request(project_id, identifier, %{url: url} = attrs)
      when is_integer(project_id) and is_binary(url) do
    identifier = normalize_identifier(identifier)

    base = %{
      project_id: project_id,
      issue_identifier: identifier,
      remote_id: url,
      url: url,
      number: Map.get(attrs, :number),
      repo: Map.get(attrs, :repo),
      title: Map.get(attrs, :title) || manual_title(Map.get(attrs, :number)),
      state: normalize_pr_state(Map.get(attrs, :state)),
      origin: "agent",
      last_synced_at: DateTime.utc_now()
    }

    case Repo.get_by(PullRequestRecord,
           project_id: project_id,
           issue_identifier: identifier,
           remote_id: url
         ) do
      nil -> %PullRequestRecord{}
      %PullRequestRecord{} = existing -> existing
    end
    |> PullRequestRecord.changeset(base)
    |> Repo.insert_or_update()
  end

  @doc """
  Removes a manual pull request association (by `url`) from an issue.
  """
  @spec unlink_pull_request(integer(), String.t(), String.t()) :: :ok
  def unlink_pull_request(project_id, identifier, url)
      when is_integer(project_id) and is_binary(url) do
    identifier = normalize_identifier(identifier)

    Repo.delete_all(
      from(pr in PullRequestRecord,
        where:
          pr.project_id == ^project_id and pr.issue_identifier == ^identifier and
            pr.remote_id == ^url
      )
    )

    :ok
  end

  defp upsert_one!(project_id, identifier, %{remote_id: remote_id} = attrs)
       when is_binary(remote_id) do
    identifier = normalize_identifier(identifier)

    base =
      attrs
      |> Map.put(:project_id, project_id)
      |> Map.put(:issue_identifier, identifier)
      |> Map.put_new(:last_synced_at, DateTime.utc_now())

    case Repo.get_by(PullRequestRecord,
           project_id: project_id,
           issue_identifier: identifier,
           remote_id: remote_id
         ) do
      nil -> %PullRequestRecord{}
      %PullRequestRecord{} = existing -> existing
    end
    |> PullRequestRecord.changeset(base)
    |> Repo.insert_or_update!()
  end

  @doc """
  Sets a local comment's sync status. Locally authored comments start
  `"pending"` and flip to `"synced"` once the outbox push succeeds (or
  `"error"` when push attempts are exhausted).
  """
  @spec mark_comment_sync_status(integer(), String.t()) ::
          {:ok, SymphonyElixir.LocalTracker.Comment.t()} | {:error, :not_found | Ecto.Changeset.t()}
  def mark_comment_sync_status(comment_id, status)
      when is_integer(comment_id) and status in ["synced", "pending", "conflict", "error", "archived"] do
    case Repo.get(SymphonyElixir.LocalTracker.Comment, comment_id) do
      nil ->
        {:error, :not_found}

      comment ->
        comment
        |> Ecto.Changeset.change(%{sync_status: status, last_synced_at: sync_timestamp(status)})
        |> Repo.update()
    end
  end

  defp sync_timestamp("synced"), do: DateTime.utc_now()
  defp sync_timestamp(_status), do: nil

  defp normalize_identifier(identifier) when is_binary(identifier) do
    identifier |> String.trim() |> String.trim_leading("#")
  end

  defp manual_title(number) when is_integer(number), do: "##{number}"
  defp manual_title(_number), do: nil

  # `gh` reports PR states uppercase (OPEN/MERGED/CLOSED); the schema stores
  # them lowercase.
  defp normalize_pr_state(state) when is_binary(state) do
    case String.downcase(state) do
      s when s in ~w(open closed merged draft) -> s
      _other -> "unknown"
    end
  end

  defp normalize_pr_state(_state), do: "unknown"

  # -- issue insert/update -----------------------------------------------------

  defp insert_issue!(project, remote, status_id) do
    %IssueRecord{}
    |> IssueRecord.changeset(%{
      project_id: project.id,
      status_id: status_id,
      identifier: to_string(remote[:identifier]),
      title: remote[:title],
      description: remote[:description],
      priority: remote[:priority],
      position: remote[:position] || 0,
      assignee_id: remote[:assignee_id],
      assignee_remote_id: remote[:assignee_remote_id],
      creator: remote[:creator],
      branch_name: remote[:branch_name],
      url: remote[:remote_url],
      remote_id: remote[:remote_id],
      remote_number: remote[:remote_number],
      remote_url: remote[:remote_url],
      sync_status: "synced",
      remote_updated_at: remote[:remote_updated_at],
      last_synced_at: DateTime.utc_now(),
      dirty_fields: %{}
    })
    |> Repo.insert!()
  end

  defp update_issue!(%IssueRecord{} = current, remote, status_id) do
    merged =
      Merge.merge_fields(
        Map.from_struct(current),
        current.dirty_fields || %{},
        Map.take(remote, @syncable_fields),
        remote[:remote_updated_at],
        @syncable_fields
      )

    desired =
      %{
        remote_number: remote[:remote_number],
        url: remote[:remote_url],
        remote_url: remote[:remote_url],
        branch_name: remote[:branch_name],
        # Provider-canonical assignee id is remote-authoritative (never edited
        # locally), so it always takes the remote value rather than LWW-merging.
        assignee_remote_id: remote[:assignee_remote_id],
        remote_updated_at: remote[:remote_updated_at],
        dirty_fields: merged.dirty_fields,
        sync_status: if(merged.conflict?, do: "conflict", else: "synced")
      }
      # Only move status when the local `state` is not a pending local edit.
      |> maybe_put_status_id(merged.dirty_fields, status_id)
      |> Map.merge(merged.attrs)

    # Skip the write entirely when the pull changes nothing. The mirror is
    # rewritten on every poll, so without this guard an idle board issues one
    # UPDATE per issue per cycle (the bulk of the SQLite write contention).
    # `last_synced_at` is deliberately excluded from the comparison so it does
    # not force a write on every otherwise-identical pull.
    if issue_unchanged?(current, desired) do
      current
    else
      current
      |> IssueRecord.changeset(Map.put(desired, :last_synced_at, DateTime.utc_now()))
      |> Repo.update!()
    end
  end

  defp maybe_put_status_id(attrs, dirty_fields, status_id) do
    if Map.has_key?(dirty_fields, "state"), do: attrs, else: Map.put(attrs, :status_id, status_id)
  end

  defp issue_unchanged?(%IssueRecord{} = current, desired) do
    Enum.all?(desired, fn {field, value} -> field_equal?(Map.get(current, field), value) end)
  end

  defp field_equal?(%DateTime{} = a, %DateTime{} = b), do: DateTime.compare(a, b) == :eq
  defp field_equal?(a, b), do: a == b

  defp existing_issue(project_id, remote_id) do
    IssueRecord
    |> where([i], i.project_id == ^project_id and i.remote_id == ^remote_id)
    |> Repo.one()
  end

  defp resolve_status_id(project_id, state_name) when is_binary(state_name) and state_name != "" do
    case Repo.get_by(WorkflowStatus, project_id: project_id, name: state_name) do
      %WorkflowStatus{id: id} -> id
      nil -> create_status_id!(project_id, state_name)
    end
  end

  defp resolve_status_id(project_id, _state) do
    first_status_id(project_id) || create_status_id!(project_id, "Todo")
  end

  defp first_status_id(project_id) do
    WorkflowStatus
    |> where([s], s.project_id == ^project_id)
    |> order_by([s], asc: s.position, asc: s.id)
    |> limit(1)
    |> select([s], s.id)
    |> Repo.one()
  end

  # Safety net: a status name on a remote issue that isn't in the seeded status
  # set still needs a row so the issue insert can succeed.
  defp create_status_id!(project_id, name) do
    next_position =
      (Repo.aggregate(
         from(s in WorkflowStatus, where: s.project_id == ^project_id),
         :max,
         :position
       ) || -1) + 1

    %WorkflowStatus{}
    |> WorkflowStatus.changeset(%{
      project_id: project_id,
      name: name,
      category: "active",
      position: next_position
    })
    |> Repo.insert!()
    |> Map.get(:id)
  end

  # -- labels ------------------------------------------------------------------

  defp maybe_upsert_labels!(project, %IssueRecord{} = issue, labels) when is_list(labels) do
    if labels_dirty?(issue), do: :ok, else: upsert_labels!(project, issue, labels)
  end

  defp labels_dirty?(%IssueRecord{dirty_fields: %{} = dirty}), do: Map.has_key?(dirty, "labels")
  defp labels_dirty?(_issue), do: false

  defp upsert_labels!(project, issue, labels) when is_list(labels) do
    desired_ids =
      labels
      |> Enum.map(fn label -> ensure_label!(project.id, label).id end)
      |> Enum.uniq()

    # Only rewrite the link set when it actually differs from what is stored, so
    # an unchanged label set on a routine pull issues no DELETE/INSERT at all.
    if MapSet.new(desired_ids) == MapSet.new(current_label_link_ids(issue.id)) do
      :ok
    else
      # Replace the remote-origin label set: clear current links, re-link in a
      # single bulk insert instead of one statement per label.
      Repo.delete_all(from(il in IssueLabel, where: il.issue_id == ^issue.id))

      if desired_ids != [] do
        rows = Enum.map(desired_ids, fn label_id -> %{issue_id: issue.id, label_id: label_id} end)
        Repo.insert_all(IssueLabel, rows, on_conflict: :nothing)
      end

      :ok
    end
  end

  defp current_label_link_ids(issue_id) do
    IssueLabel
    |> where([il], il.issue_id == ^issue_id)
    |> select([il], il.label_id)
    |> Repo.all()
  end

  defp ensure_label!(project_id, %{name: name} = label) do
    found =
      find_label_by_remote_id(project_id, label[:remote_id]) ||
        Repo.get_by(Label, project_id: project_id, name: name)

    attrs = %{project_id: project_id, name: name, color: label[:color], remote_id: label[:remote_id]}

    (found || %Label{})
    |> Label.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  defp find_label_by_remote_id(project_id, remote_id) when is_binary(remote_id),
    do: Repo.get_by(Label, project_id: project_id, remote_id: remote_id)

  defp find_label_by_remote_id(_project_id, _remote_id), do: nil

  # -- comments ----------------------------------------------------------------

  @doc """
  Records the remote id on a locally authored comment after the outbox push
  succeeds, so a later remote pull recognises it (by `remote_id`) instead of
  re-inserting a duplicate. No-op when the id is unknown, the comment is gone, or
  it already carries a remote id. Conflicts (a remote twin already adopted the id
  during a pull) are swallowed — the local comment stays unlinked and the pull's
  body-based adoption reconciles it.
  """
  @spec link_comment_remote_id(term(), term()) :: :ok
  def link_comment_remote_id(nil, _remote_id), do: :ok
  def link_comment_remote_id(_comment_id, remote_id) when not is_binary(remote_id), do: :ok

  def link_comment_remote_id(comment_id, remote_id) do
    case Repo.get(Comment, comment_id) do
      nil ->
        :ok

      %Comment{remote_id: existing} when is_binary(existing) ->
        :ok

      %Comment{} = comment ->
        comment
        |> Comment.changeset(%{remote_id: remote_id, sync_status: "synced", last_synced_at: DateTime.utc_now()})
        |> Repo.update()
        |> case do
          {:ok, _updated} -> :ok
          {:error, _changeset} -> :ok
        end
    end
  end

  @doc """
  Records the remote id on a locally drafted issue after its outbox `create` push
  succeeds, so a later remote pull recognises it (by `remote_id`) and updates it
  in place instead of inserting a duplicate row. Without this link the draft keeps
  a `nil` `remote_id`, the pull's `(project_id, remote_id)` lookup misses, and a
  second mirror row appears on the board.

  No-op when the id is unknown, the issue row is gone, or it already carries a
  remote id (idempotent re-push). Only `remote_id`/`last_synced_at` are touched so
  pending local edits (`dirty_fields`/`sync_status`) survive for the pull's LWW
  merge.
  """
  @spec link_issue_remote_id(term(), term()) :: :ok
  def link_issue_remote_id(nil, _remote_id), do: :ok
  def link_issue_remote_id(_issue_id, remote_id) when not is_binary(remote_id) or remote_id == "", do: :ok

  def link_issue_remote_id(issue_id, remote_id) do
    case Repo.get(IssueRecord, issue_id) do
      nil ->
        :ok

      %IssueRecord{remote_id: existing} when is_binary(existing) and existing != "" ->
        :ok

      %IssueRecord{} = issue ->
        issue
        |> IssueRecord.changeset(%{remote_id: remote_id, last_synced_at: DateTime.utc_now()})
        |> Repo.update()
        |> case do
          {:ok, _updated} -> :ok
          {:error, _changeset} -> :ok
        end
    end
  end

  defp upsert_comments!(issue, comments) when is_list(comments) do
    Enum.each(comments, fn comment ->
      remote_id = comment[:remote_id] || comment[:id]
      existing = find_comment_for_upsert(issue.id, remote_id, comment[:body])

      # Skip the write when the matched row already mirrors this remote comment.
      # Without this guard every enrich rewrites every comment (the changeset
      # always carried a fresh `last_synced_at`), churning the comments table.
      unless comment_unchanged?(existing, comment, remote_id) do
        attrs = %{
          issue_id: issue.id,
          kind: comment[:kind] || "comment",
          body: comment[:body],
          author: comment[:author] || "remote",
          remote_id: remote_id,
          remote_updated_at: comment[:remote_updated_at],
          last_synced_at: DateTime.utc_now(),
          sync_status: "synced"
        }

        existing
        |> Comment.changeset(attrs)
        |> Repo.insert_or_update!()
      end
    end)

    :ok
  end

  defp comment_unchanged?(%Comment{id: id} = existing, comment, remote_id) when not is_nil(id) do
    existing.remote_id == remote_id and
      existing.body == comment[:body] and
      existing.kind == (comment[:kind] || "comment") and
      existing.author == (comment[:author] || "remote") and
      existing.sync_status == "synced" and
      field_equal?(existing.remote_updated_at, comment[:remote_updated_at])
  end

  defp comment_unchanged?(_existing, _comment, _remote_id), do: false

  # Reconcile an incoming remote comment with an existing local row so a pull
  # never duplicates a comment that already exists locally:
  #   1. Prefer the row already linked to this remote_id (idempotent re-sync).
  #   2. Otherwise adopt a local-only comment (remote_id is nil) whose body is
  #      identical — the locally authored comment that was pushed to the remote
  #      but never had its remote_id recorded. Adopting it in place avoids the
  #      duplicate that previously appeared after a remote pull.
  #   3. Fall back to inserting a brand new row.
  defp find_comment_for_upsert(issue_id, remote_id, body) do
    comment_by_remote_id(issue_id, remote_id) ||
      orphan_comment_with_body(issue_id, body) ||
      %Comment{}
  end

  defp comment_by_remote_id(_issue_id, nil), do: nil

  defp comment_by_remote_id(issue_id, remote_id),
    do: Repo.get_by(Comment, issue_id: issue_id, remote_id: remote_id)

  defp orphan_comment_with_body(_issue_id, nil), do: nil
  defp orphan_comment_with_body(_issue_id, ""), do: nil

  defp orphan_comment_with_body(issue_id, body) do
    Repo.one(
      from(c in Comment,
        where: c.issue_id == ^issue_id and is_nil(c.remote_id) and c.body == ^body,
        order_by: [asc: c.id],
        limit: 1
      )
    )
  end
end
