defmodule SymphonyElixir.GitHub.SecurityAdvisories do
  @moduledoc """
  Project-scoped GitHub security context sources for Load Context.

  Includes Dependabot alerts and repository advisories. All network access goes
  through the injectable REST getter used by nearby GitHub helper modules.
  """

  alias SymphonyElixir.GitHub.{Client, RepoSpec}

  require Logger

  @per_repo_limit 100

  @type dependabot_alert :: %{
          number: integer(),
          repo: String.t(),
          state: String.t() | nil,
          url: String.t() | nil,
          package: String.t() | nil,
          ghsa_id: String.t() | nil,
          summary: String.t() | nil,
          severity: String.t() | nil,
          updated_at: String.t() | nil
        }

  @type advisory :: %{
          ghsa_id: String.t(),
          repo: String.t(),
          state: String.t() | nil,
          url: String.t() | nil,
          summary: String.t() | nil,
          severity: String.t() | nil,
          updated_at: String.t() | nil
        }

  @spec list_for_project([String.t()], keyword()) :: %{
          supported: boolean(),
          dependabot: [dependabot_alert()],
          advisories: [advisory()]
        }
  def list_for_project(repos, opts \\ [])

  def list_for_project([], _opts), do: %{supported: false, dependabot: [], advisories: []}

  def list_for_project(repos, opts) when is_list(repos) do
    %{
      supported: true,
      dependabot: repos |> Enum.flat_map(&list_dependabot_repo(&1, opts)) |> Enum.sort_by(&(&1.updated_at || ""), &>=/2),
      advisories: repos |> Enum.flat_map(&list_advisory_repo(&1, opts)) |> Enum.sort_by(&(&1.updated_at || ""), &>=/2)
    }
  end

  @spec alert_markdown(dependabot_alert()) :: String.t()
  def alert_markdown(alert) when is_map(alert) do
    [
      "### Security alert #{alert.repo}##{alert.number}",
      "",
      "- Package: #{alert.package || "unknown"}",
      "- Severity: #{alert.severity || "unknown"}",
      "- State: #{alert.state || "unknown"}",
      optional_line("- GHSA: ", alert.ghsa_id),
      optional_line("- URL: ", alert.url),
      "",
      alert.summary || "_No summary._"
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  @spec advisory_markdown(advisory()) :: String.t()
  def advisory_markdown(advisory) when is_map(advisory) do
    [
      "### Repository advisory #{advisory.ghsa_id}",
      "",
      "- Repository: #{advisory.repo}",
      "- Severity: #{advisory.severity || "unknown"}",
      "- State: #{advisory.state || "unknown"}",
      optional_line("- URL: ", advisory.url),
      "",
      advisory.summary || "_No summary._"
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp list_dependabot_repo(repo, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         params = %{"state" => dependabot_state(Keyword.get(opts, :state, "open")), "per_page" => "#{@per_repo_limit}"},
         path = "/repos/#{owner}/#{name}/dependabot/alerts?" <> URI.encode_query(params),
         {:ok, %{body: alerts}} when is_list(alerts) <- rest_get(path, opts) do
      Enum.flat_map(alerts, &normalize_alert(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("SecurityAdvisories dependabot list failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp list_advisory_repo(repo, opts) do
    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         params = advisory_params(Keyword.get(opts, :advisory_state, "published")),
         path = "/repos/#{owner}/#{name}/security-advisories?" <> URI.encode_query(params),
         {:ok, %{body: advisories}} when is_list(advisories) <- rest_get(path, opts) do
      Enum.flat_map(advisories, &normalize_advisory(&1, repo))
    else
      {:error, reason} ->
        Logger.debug("SecurityAdvisories advisory list failed repo=#{repo} reason=#{inspect(reason)}")
        []

      _ ->
        []
    end
  end

  defp normalize_alert(%{"number" => number} = alert, repo) when is_integer(number) and number > 0 do
    advisory = Map.get(alert, "security_advisory", %{})

    [
      %{
        number: number,
        repo: repo,
        state: string_or_nil(alert["state"]),
        url: string_or_nil(alert["html_url"]),
        package: get_in(alert, ["dependency", "package", "name"]),
        ghsa_id: string_or_nil(advisory["ghsa_id"]),
        summary: string_or_nil(advisory["summary"]),
        severity: string_or_nil(advisory["severity"]),
        updated_at: string_or_nil(alert["updated_at"])
      }
    ]
  end

  defp normalize_alert(_alert, _repo), do: []

  defp normalize_advisory(%{"ghsa_id" => ghsa_id} = advisory, repo) when is_binary(ghsa_id) and ghsa_id != "" do
    [
      %{
        ghsa_id: ghsa_id,
        repo: repo,
        state: string_or_nil(advisory["state"]),
        url: string_or_nil(advisory["html_url"]),
        summary: string_or_nil(advisory["summary"]),
        severity: string_or_nil(advisory["severity"]),
        updated_at: string_or_nil(advisory["updated_at"])
      }
    ]
  end

  defp normalize_advisory(_advisory, _repo), do: []

  defp dependabot_state("all"), do: "open,dismissed,fixed,auto_dismissed"
  defp dependabot_state(state), do: state

  defp advisory_params("all"), do: %{"per_page" => "#{@per_repo_limit}"}
  defp advisory_params(state), do: %{"state" => state, "per_page" => "#{@per_repo_limit}"}

  defp rest_get(path, opts) do
    case Keyword.get(opts, :rest_get_fun) do
      fun when is_function(fun, 2) -> fun.(path, [])
      _ -> client_module(opts).rest_get(path, [])
    end
  end

  defp client_module(opts) do
    case Keyword.get(opts, :client_module) do
      module when is_atom(module) and not is_nil(module) -> module
      _ -> Application.get_env(:symphony_elixir, :github_client_module, Client)
    end
  end

  defp optional_line(_prefix, nil), do: nil
  defp optional_line(_prefix, ""), do: nil
  defp optional_line(prefix, value), do: prefix <> to_string(value)

  defp string_or_nil(value) when is_binary(value) and value != "", do: value
  defp string_or_nil(_value), do: nil
end
