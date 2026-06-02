defmodule SymphonyElixir.Jira.Config do
  @moduledoc """
  JIRA Cloud configuration read from the `jira:` YAML section in WORKFLOW.md.

  Secrets (`api_token`) and the `assignee` filter support `$ENV_NAME` references
  and fall back to environment variables, mirroring `SymphonyElixir.Linear.Config`.
  """

  @behaviour SymphonyElixir.TrackerConfig

  @spec base_url() :: String.t() | nil
  def base_url do
    section_value("base_url")
    |> resolve_env_value(System.get_env("JIRA_BASE_URL"))
    |> normalize_url()
  end

  @spec email() :: String.t() | nil
  def email do
    section_value("email")
    |> resolve_env_value(System.get_env("JIRA_EMAIL"))
    |> normalize_secret()
  end

  @spec api_token() :: String.t() | nil
  def api_token do
    section_value("api_token")
    |> resolve_env_value(System.get_env("JIRA_API_TOKEN"))
    |> normalize_secret()
  end

  @spec project_key() :: String.t() | nil
  def project_key do
    case section_value("project_key") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  @spec assignee() :: String.t() | nil
  def assignee do
    section_value("assignee")
    |> resolve_env_value(System.get_env("JIRA_ASSIGNEE"))
    |> normalize_secret()
  end

  @impl SymphonyElixir.TrackerConfig
  def validate! do
    cond do
      !is_binary(base_url()) ->
        {:error, "JIRA base URL missing — set jira.base_url in WORKFLOW.md or JIRA_BASE_URL env var"}

      !is_binary(email()) ->
        {:error, "JIRA email missing — set jira.email in WORKFLOW.md or JIRA_EMAIL env var"}

      !is_binary(api_token()) ->
        {:error, "JIRA API token missing — set jira.api_token in WORKFLOW.md or JIRA_API_TOKEN env var"}

      !is_binary(project_key()) ->
        {:error, "JIRA project key missing — set jira.project_key in WORKFLOW.md"}

      true ->
        :ok
    end
  end

  defp section_value(key) do
    Map.get(SymphonyElixir.Config.section("jira"), key)
  end

  defp resolve_env_value(nil, fallback), do: fallback

  defp resolve_env_value(value, fallback) when is_binary(value) do
    trimmed = String.trim(value)

    case env_reference_name(trimmed) do
      {:ok, env_name} ->
        case System.get_env(env_name) do
          nil -> fallback
          "" -> nil
          env_value -> env_value
        end

      :error ->
        trimmed
    end
  end

  defp resolve_env_value(_value, fallback), do: fallback

  defp env_reference_name("$" <> env_name) do
    if String.match?(env_name, ~r/^[A-Za-z_][A-Za-z0-9_]*$/) do
      {:ok, env_name}
    else
      :error
    end
  end

  defp env_reference_name(_value), do: :error

  defp normalize_secret(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_secret(_value), do: nil

  defp normalize_url(value) when is_binary(value) do
    case value |> String.trim() |> String.trim_trailing("/") do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_url(_value), do: nil
end
