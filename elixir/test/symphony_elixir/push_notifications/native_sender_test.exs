defmodule SymphonyElixir.PushNotifications.NativeSenderTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PushNotifications.{MobileSubscription, MobileSubscriptions, NativeSender}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(MobileSubscription)
    parent = self()
    previous_request = Application.get_env(:symphony_elixir, :native_push_request)

    Application.put_env(:symphony_elixir, :native_push_request, fn endpoint, messages ->
      send(parent, {:native_push_request, endpoint, messages})
      {:ok, %{}}
    end)

    on_exit(fn ->
      if previous_request do
        Application.put_env(:symphony_elixir, :native_push_request, previous_request)
      else
        Application.delete_env(:symphony_elixir, :native_push_request)
      end
    end)

    :ok
  end

  test "includes the owning host profile in each notification destination" do
    for {profile_id, device_id, token} <- [
          {"host-a", "phone", "ExponentPushToken[phone]"},
          {"host-b", "tablet", "ExponentPushToken[tablet]"}
        ] do
      assert {:ok, _subscription} =
               MobileSubscriptions.upsert(%{
                 profile_id: profile_id,
                 device_id: device_id,
                 platform: "ios",
                 token: token
               })
    end

    assert :ok =
             NativeSender.deliver_all("assistant_turn", %{
               title: "Ready",
               url: "/tracker/projects/symphony/workspaces/42"
             })

    assert_receive {:native_push_request, _endpoint, messages}
    assert Enum.map(messages, & &1.data["host_id"]) |> Enum.sort() == ["host-a", "host-b"]
    assert Enum.all?(messages, &(&1.data["profile_id"] == &1.data["host_id"]))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
