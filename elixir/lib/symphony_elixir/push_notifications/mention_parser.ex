defmodule SymphonyElixir.PushNotifications.MentionParser do
  @moduledoc false

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  @mention_regex ~r/(?<!\w)@([a-zA-Z0-9_-]+)/

  @spec parse_logins(String.t()) :: [String.t()]
  def parse_logins(body) when is_binary(body) do
    @mention_regex
    |> Regex.scan(body)
    |> Enum.map(fn [_, login] -> String.downcase(login) end)
    |> Enum.uniq()
  end

  def parse_logins(_body), do: []

  @spec resolve_users(integer(), [String.t()]) :: [UserRecord.t()]
  def resolve_users(project_id, logins) when is_integer(project_id) and is_list(logins) do
    normalized = logins |> Enum.map(&String.downcase/1) |> Enum.reject(&(&1 == ""))

    if normalized == [] do
      []
    else
      UserRecord
      |> where([user], user.project_id == ^project_id)
      |> where([user], fragment("lower(?)", user.login) in ^normalized)
      |> Repo.all()
    end
  end

  @spec identity_keys_for_user(UserRecord.t() | map()) :: [String.t()]
  def identity_keys_for_user(user) do
    [Map.get(user, :login), Map.get(user, :remote_id), Map.get(user, :name)]
    |> Enum.map(&normalize/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp normalize(value) when is_binary(value) do
    trimmed = String.trim(value)

    if trimmed == "" do
      nil
    else
      String.downcase(trimmed)
    end
  end

  defp normalize(_), do: nil
end
