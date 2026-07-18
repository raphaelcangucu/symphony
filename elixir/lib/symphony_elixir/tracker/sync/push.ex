defmodule SymphonyElixir.Tracker.Sync.Push do
  @moduledoc """
  Shared push helpers for `Tracker.Sync.Driver` implementations.

  GitHub and JIRA drivers push through an issue-adapter module with identical
  result shapes; these helpers capture the common state-move and comment
  create/update/delete clauses so each driver only supplies its adapter (and,
  for JIRA, an artifact-rewriting callback). Linear shares the state-move
  portion only — its comment push goes through `Linear.Comments`, not the
  adapter, so it stays in the Linear driver.
  """

  alias SymphonyElixir.LocalTracker.Project

  @typedoc "Rewrites a comment body before push, given `(body, issue_identifier)`."
  @type body_rewriter :: (String.t() | nil, String.t() | nil -> String.t() | nil)

  @doc """
  Pushes a `state`/`move` outbox entry via `adapter.move_issue/3`.
  """
  @spec push_state_move(module(), Project.t(), map()) :: {:ok, String.t() | nil} | {:error, term()}
  def push_state_move(adapter, %Project{} = project, payload) do
    case adapter.move_issue(project, payload["identifier"], %{"status" => payload["state"]}) do
      {:ok, dto} -> {:ok, dto.id}
      error -> error
    end
  end

  @doc """
  Pushes an `issue`/`create` outbox entry via `adapter.create_issue/2`.

  Options:

  - `:adopt_identifier` — when true, returns the created issue's identity map
    (`remote_id` + tracker-issued `identifier`/`url`) so the sync engine can
    adopt the REMOTE key as the local identifier. Trackers that issue their own
    issue keys (JIRA `CDE-123`, Linear `ENG-42`) need this: keeping the local
    placeholder identifier makes every later sync call 404 against the remote.
  """
  @spec push_issue_create(module(), Project.t(), map(), keyword()) ::
          {:ok, String.t() | nil | map()} | {:error, term()}
  def push_issue_create(adapter, %Project{} = project, payload, opts \\ []) do
    case adapter.create_issue(project, payload) do
      {:ok, dto} ->
        if Keyword.get(opts, :adopt_identifier, false) do
          {:ok, %{remote_id: dto.id, identifier: Map.get(dto, :identifier), url: Map.get(dto, :url)}}
        else
          {:ok, dto.id}
        end

      error ->
        error
    end
  end

  @doc """
  Pushes a `comment`/`create` outbox entry via `adapter.add_comment/4`.

  The created comment's remote id is linked so later edits (workpad/evidence)
  flow as in-place `comment:update`: adapters may return it under `:remote_id`
  or — like the real GitHub adapter — as a GraphQL node id under `:id`.

  Options:

  - `:rewrite_body` — optional `t:body_rewriter/0` applied before push (JIRA
    uses this to attach evidence artifacts natively and swap in hosted URLs).
  """
  @spec push_comment_create(module(), Project.t(), map(), keyword()) ::
          {:ok, String.t() | nil} | {:error, term()}
  def push_comment_create(adapter, %Project{} = project, payload, opts \\ []) do
    body = rewrite_body(opts, payload["body"], payload["identifier"])

    case adapter.add_comment(project, payload["identifier"], body, %{}) do
      {:ok, %{remote_id: remote_id}} when is_binary(remote_id) -> {:ok, remote_id}
      {:ok, %{id: id}} when is_binary(id) -> {:ok, id}
      {:ok, _other} -> {:ok, nil}
      error -> error
    end
  end

  @doc """
  Pushes a `comment`/`update` outbox entry via `adapter.update_comment/4`.

  When the payload carries no `remote_id` (workpad updated before its create
  was pushed), degrades to `push_comment_create/4` so the content still
  reaches the remote. Accepts the same `:rewrite_body` option as
  `push_comment_create/4`.
  """
  @spec push_comment_update(module(), Project.t(), map(), keyword()) ::
          {:ok, String.t() | nil} | {:error, term()}
  def push_comment_update(adapter, %Project{} = project, payload, opts \\ []) do
    case payload["remote_id"] do
      remote_id when is_binary(remote_id) and remote_id != "" ->
        body = rewrite_body(opts, payload["body"], payload["identifier"])

        case adapter.update_comment(project, payload["identifier"], remote_id, body) do
          {:ok, %{remote_id: updated_id}} -> {:ok, updated_id || remote_id}
          {:ok, _other} -> {:ok, remote_id}
          error -> error
        end

      _missing ->
        push_comment_create(adapter, project, payload, opts)
    end
  end

  @doc """
  Pushes a `comment`/`delete` outbox entry via `adapter.delete_comment/3`.

  A payload without a `remote_id` means the comment never reached the remote;
  there is nothing to delete, so it succeeds with `nil`.
  """
  @spec push_comment_delete(module(), Project.t(), map()) :: {:ok, String.t() | nil} | {:error, term()}
  def push_comment_delete(adapter, %Project{} = project, payload) do
    case payload["remote_id"] do
      remote_id when is_binary(remote_id) and remote_id != "" ->
        case adapter.delete_comment(project, payload["identifier"], remote_id) do
          {:ok, %{id: id}} -> {:ok, id}
          {:ok, _other} -> {:ok, remote_id}
          error -> error
        end

      _missing ->
        {:ok, nil}
    end
  end

  defp rewrite_body(opts, body, identifier) do
    case Keyword.get(opts, :rewrite_body) do
      rewriter when is_function(rewriter, 2) -> rewriter.(body, identifier)
      nil -> body
    end
  end
end
