defmodule SymphonyElixir.PushNotifications.IdentityKeys do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixir.Tracker.Identity

  @spec collect() :: [String.t()]
  def collect do
    identity_keys =
      Identity.statuses()
      |> Enum.flat_map(fn
        %{connected: true, identity: identity} when not is_nil(identity) ->
          [identity.match_value, identity.login, identity.name]

        _ ->
          []
      end)

    viewer_keys =
      case Viewer.current() do
        {:ok, %{login: login}} when is_binary(login) -> [login]
        _ -> []
      end

    (identity_keys ++ viewer_keys)
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
