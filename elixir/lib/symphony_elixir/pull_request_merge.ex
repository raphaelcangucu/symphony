defmodule SymphonyElixir.PullRequestMerge do
  @moduledoc """
  Merges a GitHub pull request for a GitHub-backed tracker project.
  """

  alias SymphonyElixir.GitHub.{Client, PullRequests, RepoSpec}
  alias SymphonyElixir.LocalTracker.Project

  @valid_methods ~w(merge squash rebase)

  @type method :: :merge | :squash | :rebase | String.t()
  @type result :: %{
          required(:merged) => boolean(),
          required(:method) => String.t(),
          required(:bypass) => boolean(),
          optional(:sha) => String.t() | nil,
          optional(:message) => String.t() | nil
        }

  @spec merge(Project.t(), pos_integer(), method(), keyword()) :: {:ok, result()} | {:error, term()}
  def merge(%Project{} = project, number, method, opts \\ []) when is_list(opts) do
    with :ok <- validate_number(number),
         {:ok, normalized_method} <- normalize_method(method),
         {:ok, repo} <- PullRequests.resolve_repo(project),
         {:ok, {owner, name}} <- RepoSpec.split(repo) do
      do_merge(owner, name, number, normalized_method, opts)
    end
  end

  defp do_merge(owner, name, number, method, opts) do
    client = Keyword.get(opts, :client_module, default_client())
    rest_opts = Keyword.take(opts, [:request_fun])
    bypass = Keyword.get(opts, :bypass, false) == true
    path = "/repos/#{owner}/#{name}/pulls/#{number}/merge"

    case client.rest_put(path, %{merge_method: method}, rest_opts) do
      {:ok, %{body: body}} -> confirmed_result(body, method, bypass)
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  defp normalize_method(method) when is_atom(method) do
    method |> Atom.to_string() |> normalize_method()
  end

  defp normalize_method(method) when is_binary(method) do
    method
    |> String.trim()
    |> String.downcase()
    |> case do
      value when value in @valid_methods -> {:ok, value}
      _other -> {:error, :invalid_merge_method}
    end
  end

  defp normalize_method(_method), do: {:error, :invalid_merge_method}

  defp validate_number(number) when is_integer(number) and number > 0, do: :ok
  defp validate_number(_number), do: {:error, :invalid_pr_number}

  defp confirmed_result(%{"merged" => true} = body, method, bypass), do: {:ok, result(body, method, bypass)}
  defp confirmed_result(_body, _method, _bypass), do: {:error, :pull_request_not_mergeable}

  defp result(body, method, bypass) when is_map(body) do
    %{
      merged: Map.get(body, "merged") == true,
      sha: Map.get(body, "sha"),
      message: Map.get(body, "message"),
      method: method,
      bypass: bypass
    }
  end

  defp result(_body, method, bypass), do: %{merged: false, method: method, bypass: bypass}

  defp map_error({:github_api_status, 403}), do: :pull_request_merge_forbidden
  defp map_error({:github_api_status, 405}), do: :pull_request_not_mergeable
  defp map_error({:github_api_status, 409}), do: :pull_request_merge_conflict
  defp map_error({:github_api_status, 422}), do: :pull_request_merge_blocked
  defp map_error(reason), do: reason

  defp default_client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)
end
