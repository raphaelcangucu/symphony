defmodule SymphonyElixirWeb.Tracker.CredentialsController do
  @moduledoc """
  Operator-editable provider credentials (tokens) for GitHub, Jira, and Linear.

  Secrets are never returned in clear text: the index reports only whether each
  credential is configured, where it resolves from (DB override vs environment),
  and a masked hint. Writes store an encrypted override in the local settings
  table; a blank value clears the override so the provider falls back to its
  environment variable.
  """

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.Jira.Config, as: JiraConfig
  alias SymphonyElixir.Linear.Config, as: LinearConfig
  alias SymphonyElixir.Notion.Config, as: NotionConfig
  alias SymphonyElixir.Settings.Credentials
  alias SymphonyElixir.Tracker.Identity
  alias SymphonyElixirWeb.TrackerErrors

  @provider_labels %{
    "github" => "GitHub",
    "jira" => "Jira",
    "linear" => "Linear",
    "notion" => "Notion"
  }

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    json(conn, %{data: %{providers: Enum.map(Credentials.providers(), &provider_summary/1)}})
  end

  @spec update(Conn.t(), map()) :: Conn.t()
  def update(conn, %{"provider" => provider, "key" => key} = params) do
    value = Map.get(params, "value", "")

    case Credentials.put(provider, key, value) do
      {:ok, _result} ->
        Identity.invalidate(provider)
        json(conn, %{data: provider_summary(provider)})

      {:error, :unknown_credential} ->
        TrackerErrors.render(conn, :unknown_credential)

      {:error, %Ecto.Changeset{} = changeset} ->
        TrackerErrors.render(conn, changeset)
    end
  end

  def update(conn, _params) do
    TrackerErrors.validation_msg(conn, "provider and key are required")
  end

  @spec delete(Conn.t(), map()) :: Conn.t()
  def delete(conn, %{"provider" => provider, "key" => key}) do
    if Credentials.field?(provider, key) do
      Credentials.clear(provider, key)
      Identity.invalidate(provider)
      json(conn, %{data: provider_summary(provider)})
    else
      TrackerErrors.render(conn, :unknown_credential)
    end
  end

  defp provider_summary(provider) do
    %{
      provider: provider,
      label: Map.get(@provider_labels, provider, provider),
      fields: Enum.map(Credentials.fields(provider), &field_summary(provider, &1))
    }
  end

  defp field_summary(provider, %{key: key, label: label, secret: secret}) do
    effective = effective_value(provider, key)
    stored? = Credentials.configured?(provider, key)

    base = %{
      key: key,
      label: label,
      secret: secret,
      configured: is_binary(effective),
      source: source(stored?, effective)
    }

    if secret do
      Map.put(base, :hint, mask(effective))
    else
      Map.put(base, :value, effective)
    end
  end

  defp source(true, _effective), do: "db"
  defp source(false, effective) when is_binary(effective), do: "env"
  defp source(false, _effective), do: "none"

  defp effective_value("github", "token"), do: GitHubConfig.token()
  defp effective_value("jira", "base_url"), do: JiraConfig.base_url()
  defp effective_value("jira", "email"), do: JiraConfig.email()
  defp effective_value("jira", "api_token"), do: JiraConfig.api_token()
  defp effective_value("linear", "api_key"), do: LinearConfig.api_key()
  defp effective_value("notion", "api_key"), do: NotionConfig.api_key()
  defp effective_value(_provider, _key), do: nil

  defp mask(value) when is_binary(value) do
    visible = String.slice(value, -4, 4)

    case visible do
      "" -> "••••"
      tail -> "••••" <> tail
    end
  end

  defp mask(_value), do: nil
end
