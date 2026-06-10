defmodule SymphonyElixir.Settings.Credentials do
  @moduledoc """
  Operator-editable provider credentials, stored encrypted in the `settings`
  table under the `credentials` group.

  Unlike the generic `SymphonyElixir.Settings` groups, credentials are NOT
  exposed through `Settings.all/0` — secrets must never flow through the generic
  settings endpoint. Reads decrypt on demand; writes encrypt via
  `SymphonyElixir.Settings.Vault`. A blank value clears the stored credential so
  the provider falls back to its environment variable.
  """

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.Setting
  alias SymphonyElixir.Settings.Vault

  @group "credentials"

  @fields %{
    "github" => [
      %{key: "token", label: "Personal access token", secret: true}
    ],
    "jira" => [
      %{key: "base_url", label: "Base URL", secret: false},
      %{key: "email", label: "Account email", secret: false},
      %{key: "api_token", label: "API token", secret: true}
    ],
    "linear" => [
      %{key: "api_key", label: "API key", secret: true}
    ]
  }

  @spec group() :: String.t()
  def group, do: @group

  @spec providers() :: [String.t()]
  def providers, do: Map.keys(@fields)

  @spec fields(String.t()) :: [map()]
  def fields(provider), do: Map.get(@fields, provider, [])

  @spec field?(String.t(), String.t()) :: boolean()
  def field?(provider, key) do
    provider |> fields() |> Enum.any?(&(&1.key == key))
  end

  @spec secret_field?(String.t(), String.t()) :: boolean()
  def secret_field?(provider, key) do
    provider
    |> fields()
    |> Enum.find(&(&1.key == key))
    |> case do
      %{secret: secret} -> secret
      _ -> false
    end
  end

  @doc "Returns the stored (decrypted) credential, or nil when unset/undecryptable."
  @spec get(String.t(), String.t()) :: String.t() | nil
  def get(provider, key) when is_binary(provider) and is_binary(key) do
    case stored_blob(provider, key) do
      blob when is_binary(blob) ->
        case Vault.decrypt(blob) do
          {:ok, plaintext} -> blank_to_nil(plaintext)
          :error -> nil
        end

      _ ->
        nil
    end
  rescue
    # Settings table may not exist yet (migrations pending); fall back to env.
    _ -> nil
  end

  @doc "Whether a credential is stored in the DB for this provider/field."
  @spec configured?(String.t(), String.t()) :: boolean()
  def configured?(provider, key), do: is_binary(get(provider, key))

  @doc """
  Stores (or, for a blank value, clears) a credential. Validates the provider
  and field against the known schema.
  """
  @spec put(String.t(), String.t(), String.t() | nil) ::
          {:ok, :stored | :cleared} | {:error, :unknown_credential | Ecto.Changeset.t()}
  def put(provider, key, value) when is_binary(provider) and is_binary(key) do
    cond do
      not field?(provider, key) ->
        {:error, :unknown_credential}

      blank?(value) ->
        clear(provider, key)
        {:ok, :cleared}

      true ->
        store(provider, key, String.trim(value))
    end
  end

  @doc "Removes a stored credential (provider falls back to its env var)."
  @spec clear(String.t(), String.t()) :: :ok
  def clear(provider, key) when is_binary(provider) and is_binary(key) do
    Repo.delete_all(from(s in Setting, where: s.group == ^@group and s.name == ^name(provider, key)))
    :ok
  rescue
    _ -> :ok
  end

  defp store(provider, key, plaintext) do
    %Setting{}
    |> Setting.changeset(%{
      group: @group,
      name: name(provider, key),
      payload: %{"value" => Vault.encrypt(plaintext)}
    })
    |> Repo.insert(
      on_conflict: {:replace, [:payload, :updated_at]},
      conflict_target: [:group, :name]
    )
    |> case do
      {:ok, _setting} -> {:ok, :stored}
      {:error, changeset} -> {:error, changeset}
    end
  end

  defp stored_blob(provider, key) do
    query = from(s in Setting, where: s.group == ^@group and s.name == ^name(provider, key))

    case Repo.one(query) do
      %Setting{payload: %{"value" => value}} when is_binary(value) -> value
      _ -> nil
    end
  end

  defp name(provider, key), do: provider <> "." <> key

  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: true

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      _ -> value
    end
  end

  defp blank_to_nil(_value), do: nil
end
