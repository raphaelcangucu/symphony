defmodule SymphonyElixir.PushNotifications.MentionNotifierTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Comment, Context}
  alias SymphonyElixir.PushNotifications.MentionNotifier
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  setup do
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    {:ok, issue} = Context.create_issue("mm", %{title: "Do the thing", status: "Todo"})
    %{project: project, issue: issue}
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  test "deliver_if_needed skips workpad comments", %{issue: issue} do
    comment =
      %Comment{}
      |> Comment.changeset(%{
        issue_id: issue.id,
        body: "@raphael",
        kind: "workpad",
        author: "bob",
        sync_status: "synced"
      })
      |> Repo.insert!()

    assert :ok = MentionNotifier.deliver_if_needed(comment, :after_remote_sync)
  end

  test "deliver_if_needed delivers for synced comment with mention", %{project: project, issue: issue} do
    %UserRecord{}
    |> UserRecord.changeset(%{project_id: project.id, login: "raphael", remote_id: "U1"})
    |> Repo.insert!()

    {:ok, _} =
      SymphonyElixir.PushNotifications.Subscriptions.upsert(%{
        endpoint: "https://push.example/raphael",
        p256dh: "k",
        auth: "a",
        identity_keys: ["raphael"]
      })

    comment =
      %Comment{}
      |> Comment.changeset(%{
        issue_id: issue.id,
        body: "Please review @raphael",
        kind: "comment",
        author: "bob",
        sync_status: "synced"
      })
      |> Repo.insert!()

    assert :ok = MentionNotifier.deliver_if_needed(comment, :after_remote_sync)
  end
end
