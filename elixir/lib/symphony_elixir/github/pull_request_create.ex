defmodule SymphonyElixir.GitHub.PullRequestCreate do
  @moduledoc """
  Finds the open pull request for a head branch, or creates one targeting the
  repository default branch. Uses the GitHub REST API via `GitHub.Client`.
  """

  @default_client SymphonyElixir.GitHub.Client
  @title "docs: knowledge base updates"
  @body "Automated documentation updates from the Symphony knowledge base."

  @type result :: %{number: pos_integer(), url: String.t(), created: boolean()}

  @spec ensure(String.t(), String.t(), keyword()) :: {:ok, result()} | {:error, term()}
  def ensure(repo, head_branch, opts \\ []) when is_binary(repo) and is_binary(head_branch) do
    client = Keyword.get(opts, :client, @default_client)
    {owner, name} = split_repo(repo)

    with {:ok, default_branch} <- default_branch(client, owner, name),
         {:ok, existing} <- find_open_pr(client, owner, name, head_branch) do
      case existing do
        nil -> create(client, owner, name, head_branch, default_branch, opts)
        pr -> {:ok, %{number: pr["number"], url: pr["html_url"], created: false}}
      end
    end
  end

  defp default_branch(client, owner, name) do
    case client.rest_get("/repos/#{owner}/#{name}", []) do
      {:ok, %{status: s, body: %{"default_branch" => b}}} when s in 200..299 and is_binary(b) ->
        {:ok, b}

      {:ok, %{status: s}} ->
        {:error, {:github_api_status, s}}

      error ->
        error
    end
  end

  defp find_open_pr(client, owner, name, head_branch) do
    query = "?state=open&head=#{owner}:#{head_branch}"

    case client.rest_get("/repos/#{owner}/#{name}/pulls#{query}", []) do
      {:ok, %{status: s, body: [pr | _]}} when s in 200..299 -> {:ok, pr}
      {:ok, %{status: s, body: _}} when s in 200..299 -> {:ok, nil}
      {:ok, %{status: s}} -> {:error, {:github_api_status, s}}
      error -> error
    end
  end

  defp create(client, owner, name, head, base, opts) do
    payload = %{
      "title" => Keyword.get(opts, :title, @title),
      "head" => head,
      "base" => base,
      "body" => Keyword.get(opts, :body, @body)
    }

    case client.rest_post("/repos/#{owner}/#{name}/pulls", payload, []) do
      {:ok, %{status: s, body: %{"number" => n, "html_url" => url}}} when s in 200..299 ->
        {:ok, %{number: n, url: url, created: true}}

      {:ok, %{status: 422}} ->
        # Race: a PR was created concurrently; re-resolve the open PR.
        case find_open_pr(client, owner, name, head) do
          {:ok, %{"number" => n, "html_url" => url}} -> {:ok, %{number: n, url: url, created: false}}
          _ -> {:error, :pull_request_create_conflict}
        end

      {:ok, %{status: s}} ->
        {:error, {:github_api_status, s}}

      error ->
        error
    end
  end

  defp split_repo(repo) do
    case String.split(repo, "/", parts: 2) do
      [owner, name] -> {owner, name}
      _ -> {repo, repo}
    end
  end
end
