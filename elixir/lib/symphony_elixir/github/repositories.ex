defmodule SymphonyElixir.GitHub.Repositories do
  @moduledoc """
  Finds or creates a repository in the authenticated user's personal account.
  Used to provision the private `symphony-kb` knowledge base repository.
  """

  alias SymphonyElixir.GitHub.{Client, Viewer}

  @type repo :: %{
          full_name: String.t(),
          clone_url: String.t(),
          default_branch: String.t(),
          created: boolean()
        }

  @spec ensure(String.t(), keyword()) :: {:ok, repo()} | {:error, term()}
  def ensure(name, opts \\ []) when is_binary(name) do
    client = Keyword.get(opts, :client, Client)

    with {:ok, login} <- resolve_login(opts) do
      case client.rest_get("/repos/#{login}/#{name}", []) do
        {:ok, %{status: 200, body: body}} -> {:ok, to_repo(body, false)}
        {:ok, %{status: 404}} -> create(client, name)
        {:ok, %{status: s}} -> {:error, {:github_api_status, s}}
        error -> error
      end
    end
  end

  defp create(client, name) do
    payload = %{
      "name" => name,
      "private" => true,
      "auto_init" => true,
      "description" => "Symphony knowledge base"
    }

    case client.rest_post("/user/repos", payload, []) do
      {:ok, %{status: s, body: body}} when s in 200..299 -> {:ok, to_repo(body, true)}
      {:ok, %{status: s}} -> {:error, {:kb_repo_create_failed, s}}
      error -> error
    end
  end

  defp resolve_login(opts) do
    case Keyword.get(opts, :login) do
      login when is_binary(login) and login != "" -> {:ok, login}
      _ -> Viewer.resolve_login(opts)
    end
  end

  defp to_repo(body, created) do
    %{
      full_name: body["full_name"],
      clone_url: body["clone_url"],
      default_branch: body["default_branch"] || "main",
      created: created
    }
  end
end
