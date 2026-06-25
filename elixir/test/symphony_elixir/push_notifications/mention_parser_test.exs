defmodule SymphonyElixir.PushNotifications.MentionParserTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.PushNotifications.MentionParser
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  setup do
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  test "parse_logins/1 extracts @mentions" do
    assert ["raphael", "bob"] = MentionParser.parse_logins("Hi @raphael and @bob")
    assert [] = MentionParser.parse_logins("email@domain.com")
  end

  test "identity_keys_for_user/1 returns normalized keys" do
    user = %{login: "Raphael", remote_id: "U1", name: "Raphael C"}

    assert MapSet.new(["raphael", "u1", "raphael c"]) ==
             MapSet.new(MentionParser.identity_keys_for_user(user))
  end

  test "resolve_users/2 matches project users by login", %{project: project} do
    %UserRecord{}
    |> UserRecord.changeset(%{project_id: project.id, login: "raphael", remote_id: "U1"})
    |> Repo.insert!()

    assert [%UserRecord{login: "raphael"}] = MentionParser.resolve_users(project.id, ["raphael", "missing"])
  end
end
