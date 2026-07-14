defmodule SymphonyElixir.Workspace.DisplayNameTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace.DisplayName

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    {:ok, _demo} = Context.ensure_project(%{name: "Demo", slug: "demo"})
    {:ok, _other} = Context.ensure_project(%{name: "Other", slug: "other"})
    :ok
  end

  test "put trims values and upserts the same row" do
    assert {:ok, first} = DisplayName.put(" demo ", " /tmp/demo/ws ", " Feature A ")
    assert first.project_slug == "demo"
    assert first.workspace_path == "/tmp/demo/ws"
    assert first.display_name == "Feature A"

    assert {:ok, second} = DisplayName.put("demo", "/tmp/demo/ws", "Feature B")
    assert second.id == first.id
    assert second.display_name == "Feature B"
    assert second.updated_at >= first.updated_at
  end

  test "list and get are deterministic" do
    assert {:ok, second} = DisplayName.put("demo", "/tmp/demo/z", "Zulu")
    assert {:ok, first} = DisplayName.put("demo", "/tmp/demo/a", "Alpha")
    assert {:ok, _other} = DisplayName.put("other", "/tmp/other/a", "Other")

    assert {:ok, [^first, ^second]} = DisplayName.list_for_project("demo")

    assert {:ok, %{"/tmp/demo/a" => "Alpha", "/tmp/demo/z" => "Zulu"}} =
             DisplayName.map_for_project("demo")

    assert {:ok, ^second} = DisplayName.get("demo", "/tmp/demo/z")
    assert {:error, :not_found} = DisplayName.get("demo", "/tmp/demo/missing")
  end

  test "map returns one stable alias lookup error" do
    assert {:error, :workspace_alias_lookup_failed} = DisplayName.map_for_project(" ")
    assert {:error, :workspace_alias_lookup_failed} = DisplayName.map_for_project("missing")
  end

  test "invalid project slugs return tagged errors" do
    assert {:error, :invalid_project_slug} = DisplayName.list_for_project(" ")
    assert {:error, :invalid_project_slug} = DisplayName.get(String.duplicate("a", 121), "/tmp/demo/ws")
    assert {:error, :invalid_project_slug} = DisplayName.put(nil, "/tmp/demo/ws", "Feature")
    assert {:error, :invalid_project_slug} = DisplayName.delete(%{}, "/tmp/demo/ws")
  end

  test "project slug accepts exactly 120 graphemes" do
    project_slug = String.duplicate("a", 120)
    {:ok, _project} = Context.ensure_project(%{name: "Long slug", slug: project_slug})

    assert {:ok, entry} = DisplayName.put(project_slug, "/tmp/demo/ws", "Feature")
    assert entry.project_slug == project_slug
  end

  test "invalid workspace paths return tagged errors" do
    for path <- ["relative/ws", "/tmp/demo/\0ws", "/tmp/demo/../other", "/tmp//demo/ws", nil] do
      assert {:error, :invalid_workspace_path} = DisplayName.put("demo", path, "Feature")
    end
  end

  test "blank and overlong display names return tagged errors" do
    assert {:error, :invalid_display_name} = DisplayName.put("demo", "/tmp/demo/ws", " ")
    assert {:error, :invalid_display_name} = DisplayName.put("demo", "/tmp/demo/ws", String.duplicate("é", 121))
    assert {:error, :invalid_display_name} = DisplayName.put("demo", "/tmp/demo/ws", nil)
  end

  test "display name accepts exactly 120 graphemes" do
    display_name = String.duplicate("👩‍💻", 120)

    assert {:ok, entry} = DisplayName.put("demo", "/tmp/demo/ws", display_name)
    assert entry.display_name == display_name
  end

  test "equivalent trimmed path upserts instead of creating a second row" do
    assert {:ok, first} = DisplayName.put("demo", "/tmp/demo/ws", "First")
    assert {:ok, second} = DisplayName.put(" demo ", "  /tmp/demo/ws  ", "Second")

    assert second.id == first.id
    assert {:ok, [only]} = DisplayName.list_for_project("demo")
    assert only.display_name == "Second"
  end

  test "delete is idempotent-safe when another deletion wins" do
    assert {:ok, _entry} = DisplayName.put("demo", "/tmp/demo/ws", "Feature")
    assert :ok = DisplayName.delete("demo", "/tmp/demo/ws")
    assert {:error, :not_found} = DisplayName.delete("demo", "/tmp/demo/ws")
  end

  test "two concurrent deletes return one success and one not found without exiting" do
    assert {:ok, _entry} = DisplayName.put("demo", "/tmp/demo/ws", "Feature")
    parent = self()

    delete_tasks =
      for _index <- 1..2 do
        Task.async(fn ->
          send(parent, {:delete_ready, self()})

          receive do
            :delete_now -> DisplayName.delete("demo", "/tmp/demo/ws")
          end
        end)
      end

    delete_processes =
      for _index <- 1..2 do
        assert_receive {:delete_ready, delete_process}
        delete_process
      end

    Enum.each(delete_processes, &send(&1, :delete_now))
    results = Enum.map(delete_tasks, &Task.await/1)

    assert Enum.count(results, &(&1 == :ok)) == 1
    assert Enum.count(results, &(&1 == {:error, :not_found})) == 1
  end

  test "concurrent puts atomically return the display name written by each call" do
    parent = self()

    put_tasks =
      for display_name <- ["First", "Second"] do
        Task.async(fn ->
          send(parent, {:put_ready, self()})

          receive do
            :put_now -> DisplayName.put("demo", "/tmp/demo/ws", display_name)
          end
        end)
      end

    put_processes =
      for _index <- 1..2 do
        assert_receive {:put_ready, put_process}
        put_process
      end

    Enum.each(put_processes, &send(&1, :put_now))

    assert [{:ok, first_response}, {:ok, second_response}] =
             Enum.map(put_tasks, &Task.await/1)

    assert first_response.display_name == "First"
    assert second_response.display_name == "Second"
    assert first_response.id == second_response.id
  end

  test "deleting and recreating a project does not inherit old aliases" do
    {:ok, original_project} = Context.get_project("demo")
    assert {:ok, _entry} = DisplayName.put("demo", "/tmp/demo/ws", "Old alias")

    Repo.delete!(original_project)
    {:ok, recreated_project} = Context.ensure_project(%{name: "Demo recreated", slug: "demo"})

    refute recreated_project.id == original_project.id
    assert {:ok, []} = DisplayName.list_for_project("demo")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
