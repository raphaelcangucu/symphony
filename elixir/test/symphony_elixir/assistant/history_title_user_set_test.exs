defmodule SymphonyElixir.Assistant.HistoryTitleUserSetTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "update_thread_sidebar_metadata sets title_user_set when title changes" do
    {:ok, thread} =
      History.create_freeform_thread(%{title: "Chat", workspace_path: "/tmp/title-user-set"})

    assert {:ok, updated} = History.update_thread_sidebar_metadata(thread.id, %{title: "Renamed"})
    assert updated.title == "Renamed"
    assert updated.metadata["title_user_set"] == true
  end

  test "update_thread_sidebar_metadata skips title_user_set when mark_user_title is false" do
    {:ok, thread} =
      History.create_freeform_thread(%{title: "Chat", workspace_path: "/tmp/title-auto-set"})

    assert {:ok, updated} =
             History.update_thread_sidebar_metadata(thread.id, %{title: "Auto title"},
               mark_user_title: false
             )

    assert updated.title == "Auto title"
    refute updated.metadata["title_user_set"] == true
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- ["assistant_messages", "assistant_threads"] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
