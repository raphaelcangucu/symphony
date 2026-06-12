defmodule SymphonyElixir.PushNotifications.Config do
  @moduledoc "VAPID configuration for browser Web Push."

  @default_subject "mailto:symphony@localhost"

  @spec enabled?() :: boolean()
  def enabled? do
    vapid_public_key() != nil and vapid_private_key() != nil
  end

  @spec vapid_public_key() :: String.t() | nil
  def vapid_public_key do
    Application.get_env(:ex_nudge, :vapid_public_key) ||
      Application.get_env(:symphony_elixir, :vapid_public_key)
  end

  @spec vapid_private_key() :: String.t() | nil
  def vapid_private_key do
    Application.get_env(:ex_nudge, :vapid_private_key) ||
      Application.get_env(:symphony_elixir, :vapid_private_key)
  end

  @spec vapid_subject() :: String.t()
  def vapid_subject do
    Application.get_env(:ex_nudge, :vapid_subject) ||
      Application.get_env(:symphony_elixir, :vapid_subject) ||
      @default_subject
  end
end
