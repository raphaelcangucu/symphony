defmodule SymphonyElixir.Assistant.HistoryLatestFreeformTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  defp create_freeform(title) do
    {:ok, thread} =
      History.create_freeform_thread(%{
        title: title,
        workspace_path: "/tmp/assistant/freeform"
      })

    thread
  end

  describe "latest_freeform_thread/0" do
    test "returns nil when no freeform threads exist" do
      assert History.latest_freeform_thread() == nil
    end

    test "returns the most recently updated freeform thread" do
      older = create_freeform("older")
      newer = create_freeform("newer")

      {:ok, _touched} = History.update_thread(newer, %{title: "newer-updated"})

      latest = History.latest_freeform_thread()
      assert latest.id == newer.id
      refute latest.id == older.id
    end
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
