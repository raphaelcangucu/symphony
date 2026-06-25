defmodule SymphonyElixir.PushNotifications.SubscriptionsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PushNotifications.Subscriptions
  alias SymphonyElixir.Repo

  setup do
    Repo.delete_all(SymphonyElixir.PushNotifications.Subscription)
    :ok
  end

  test "list_for_identities/1 returns subscriptions with overlapping keys" do
    {:ok, _} =
      Subscriptions.upsert(%{
        endpoint: "https://push.example/a",
        p256dh: "k1",
        auth: "a1",
        identity_keys: ["raphael", "u1"]
      })

    {:ok, _} =
      Subscriptions.upsert(%{
        endpoint: "https://push.example/b",
        p256dh: "k2",
        auth: "a2",
        identity_keys: ["bob"]
      })

    assert [%{endpoint: "https://push.example/a"}] =
             Subscriptions.list_for_identities(["raphael"])

    assert [] = Subscriptions.list_for_identities([])
  end
end
