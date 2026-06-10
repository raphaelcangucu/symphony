defmodule SymphonyElixir.Linear.Comments do
  @moduledoc """
  Linear comment mutations used by the sync driver. Unlike
  `Linear.Tracker.create_comment/2` (success-only), these return the remote
  comment id so the outbox can link it for in-place workpad updates.
  """

  alias SymphonyElixir.Linear.Client

  @create_mutation """
  mutation SymphonyCommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: {issueId: $issueId, body: $body}) {
      success
      comment { id }
    }
  }
  """

  @update_mutation """
  mutation SymphonyCommentUpdate($id: String!, $body: String!) {
    commentUpdate(id: $id, input: {body: $body}) {
      success
      comment { id }
    }
  }
  """

  @spec create(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def create(issue_remote_id, body, opts \\ []) do
    client = Keyword.get(opts, :client, &Client.graphql/3)

    case client.(@create_mutation, %{issueId: issue_remote_id, body: body}, []) do
      {:ok, %{"data" => %{"commentCreate" => %{"success" => true, "comment" => %{"id" => id}}}}} ->
        {:ok, id}

      {:ok, response} ->
        {:error, {:linear_comment_create_failed, response}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec update(String.t(), String.t(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def update(comment_remote_id, body, opts \\ []) do
    client = Keyword.get(opts, :client, &Client.graphql/3)

    case client.(@update_mutation, %{id: comment_remote_id, body: body}, []) do
      {:ok, %{"data" => %{"commentUpdate" => %{"success" => true, "comment" => %{"id" => id}}}}} ->
        {:ok, id}

      {:ok, response} ->
        {:error, {:linear_comment_update_failed, response}}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
