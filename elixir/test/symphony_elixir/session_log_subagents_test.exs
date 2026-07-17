defmodule SymphonyElixir.SessionLogSubagentsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.SessionLog, as: ClaudeLog
  alias SymphonyElixir.Codex.SessionLog, as: CodexLog
  alias SymphonyElixir.Cursor.SessionLog, as: CursorLog
  alias SymphonyElixir.SessionLog

  setup do
    root = Path.join(System.tmp_dir!(), "session-log-subagents-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  describe "Codex subagents" do
    test "resolve_subagent_path finds rollout by id", %{root: root} do
      uuid = "019f15d9-43f9-7443-8b33-c25bd6b47307"
      path = Path.join(root, "rollout-2026-07-17T10-00-00-#{uuid}.jsonl")

      write_jsonl!(path, [
        %{
          "type" => "session_meta",
          "payload" => %{
            "id" => uuid,
            "parent_thread_id" => "parent-thread-1",
            "agent_nickname" => "Popper",
            "agent_role" => "explorer"
          }
        },
        %{"type" => "event_msg", "payload" => %{"type" => "task_started"}}
      ])

      assert {:ok, ^path} = CodexLog.resolve_subagent_path(uuid, sessions_dir: root)
      assert {:ok, ^path} = SessionLog.resolve_subagent("codex", uuid, sessions_dir: root)
    end

    test "subagent_meta parses session_meta first line only", %{root: root} do
      path = Path.join(root, "rollout-2026-07-17T10-00-00-aabbccdd-eeee-ffff-0000-111122223333.jsonl")

      write_jsonl!(path, [
        %{
          "type" => "session_meta",
          "payload" => %{
            "id" => "aabbccdd-eeee-ffff-0000-111122223333",
            "parent_thread_id" => "parent-1",
            "agent_nickname" => "Dalton",
            "agent_role" => "default"
          }
        },
        %{"type" => "turn_context", "payload" => %{}}
      ])

      assert CodexLog.subagent_meta(path) == %{
               "nickname" => "Dalton",
               "role" => "default",
               "parent" => "parent-1",
               "label" => "Dalton"
             }
    end

    test "list_subagents is intentionally empty" do
      assert CodexLog.list_subagents("/tmp/unused.jsonl", []) == []
    end
  end

  describe "Cursor subagents" do
    test "resolve, list, and label from first prompt line", %{root: root} do
      parent_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      child_a = "11111111-2222-3333-4444-555555555555"
      child_b = "66666666-7777-8888-9999-aaaaaaaaaaaa"

      parent_dir = Path.join(root, parent_id)
      File.mkdir_p!(Path.join(parent_dir, "subagents"))
      parent_path = Path.join(parent_dir, "#{parent_id}.jsonl")
      File.write!(parent_path, Jason.encode!(%{"role" => "user", "message" => %{"content" => []}}) <> "\n")

      path_a = Path.join([parent_dir, "subagents", "#{child_a}.jsonl"])
      path_b = Path.join([parent_dir, "subagents", "#{child_b}.jsonl"])

      write_jsonl!(path_a, [
        %{
          "role" => "user",
          "message" => %{
            "content" => [
              %{"type" => "text", "text" => "Explore the auth module thoroughly\nand report findings"}
            ]
          }
        }
      ])

      write_jsonl!(path_b, [
        %{
          "role" => "user",
          "message" => %{
            "content" => [%{"type" => "text", "text" => "Implement the login form"}]
          }
        }
      ])

      File.touch!(path_a, {{2026, 7, 17}, {10, 0, 0}})
      File.touch!(path_b, {{2026, 7, 17}, {10, 0, 1}})

      assert {:ok, ^path_a} =
               CursorLog.resolve_subagent_path(child_a, parent_path: parent_path)

      listed = CursorLog.list_subagents(parent_path, [])
      assert Enum.map(listed, & &1["id"]) == [child_a, child_b]
      assert hd(listed)["label"] == "Explore the auth module thoroughly"
      assert hd(listed)["path"] == path_a
      assert hd(listed)["nickname"] == nil
      assert hd(listed)["role"] == nil
      assert hd(listed)["tool_use_id"] == nil
    end

    test "rejects path-traversal ids", %{root: root} do
      parent_id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
      parent_dir = Path.join(root, parent_id)
      File.mkdir_p!(Path.join(parent_dir, "subagents"))
      parent_path = Path.join(parent_dir, "#{parent_id}.jsonl")
      File.write!(parent_path, "{}\n")

      assert :error =
               CursorLog.resolve_subagent_path("../../etc/passwd", parent_path: parent_path)

      assert :error = SessionLog.resolve_subagent("cursor", "../x", parent_path: parent_path)
    end
  end

  describe "Claude subagents" do
    test "resolve by id with and without agent- prefix", %{root: root} do
      parent_id = "c3c3f46a-fc34-4f8f-9d1a-772c65604020"
      parent_path = Path.join(root, "#{parent_id}.jsonl")
      File.write!(parent_path, "{}\n")

      child_id = "a0b70422f9f999605"
      subagents = Path.join(Path.rootname(parent_path), "subagents")
      File.mkdir_p!(subagents)
      jsonl = Path.join(subagents, "agent-#{child_id}.jsonl")

      write_jsonl!(jsonl, [
        %{"type" => "user", "message" => %{"role" => "user", "content" => "fallback prompt"}}
      ])

      File.write!(
        Path.join(subagents, "agent-#{child_id}.meta.json"),
        Jason.encode!(%{
          "agentType" => "Explore",
          "description" => "Extract settlement signatures",
          "toolUseId" => "toolu_01VSiPZB53TmJvgurefWVUGB"
        })
      )

      assert {:ok, ^jsonl} = ClaudeLog.resolve_subagent_path(child_id, parent_path: parent_path)

      assert {:ok, ^jsonl} =
               ClaudeLog.resolve_subagent_path("agent-#{child_id}", parent_path: parent_path)
    end

    test "resolve by tool_use_id when id does not match", %{root: root} do
      parent_id = "d4d4f46a-fc34-4f8f-9d1a-772c65604021"
      parent_path = Path.join(root, "#{parent_id}.jsonl")
      File.write!(parent_path, "{}\n")

      child_id = "ab006d72a40897d60"
      tool_use_id = "toolu_01ABCDEFGHijklmnop"
      subagents = Path.join(Path.rootname(parent_path), "subagents")
      File.mkdir_p!(subagents)
      jsonl = Path.join(subagents, "agent-#{child_id}.jsonl")
      File.write!(jsonl, "{}\n")

      File.write!(
        Path.join(subagents, "agent-#{child_id}.meta.json"),
        Jason.encode!(%{
          "agentType" => "Bash",
          "description" => "Run checks",
          "toolUseId" => tool_use_id
        })
      )

      assert {:ok, ^jsonl} =
               ClaudeLog.resolve_subagent_path("missing-id",
                 parent_path: parent_path,
                 tool_use_id: tool_use_id
               )
    end

    test "list_subagents reads meta.json and tolerates corrupt sidecars", %{root: root} do
      parent_id = "e5e5f46a-fc34-4f8f-9d1a-772c65604022"
      parent_path = Path.join(root, "#{parent_id}.jsonl")
      File.write!(parent_path, "{}\n")

      subagents = Path.join(Path.rootname(parent_path), "subagents")
      File.mkdir_p!(subagents)

      good_id = "ad8a040be6a6e12f1"
      good_jsonl = Path.join(subagents, "agent-#{good_id}.jsonl")

      write_jsonl!(good_jsonl, [
        %{"type" => "user", "message" => %{"role" => "user", "content" => "should not be used"}}
      ])

      File.write!(
        Path.join(subagents, "agent-#{good_id}.meta.json"),
        Jason.encode!(%{
          "agentType" => "Explore",
          "description" => "Good description",
          "toolUseId" => "toolu_good"
        })
      )

      bad_id = "a38f3c33b05fd07a9"
      bad_jsonl = Path.join(subagents, "agent-#{bad_id}.jsonl")

      write_jsonl!(bad_jsonl, [
        %{
          "type" => "user",
          "message" => %{"role" => "user", "content" => "Fallback label from prompt\nmore"}
        }
      ])

      File.write!(Path.join(subagents, "agent-#{bad_id}.meta.json"), "{not-json")
      File.touch!(good_jsonl, {{2026, 7, 17}, {10, 0, 0}})
      File.touch!(bad_jsonl, {{2026, 7, 17}, {10, 0, 1}})

      listed = ClaudeLog.list_subagents(parent_path, [])
      assert Enum.map(listed, & &1["id"]) == [good_id, bad_id]

      good = Enum.find(listed, &(&1["id"] == good_id))
      assert good["label"] == "Good description"
      assert good["role"] == "Explore"
      assert good["tool_use_id"] == "toolu_good"
      assert good["path"] == good_jsonl

      bad = Enum.find(listed, &(&1["id"] == bad_id))
      assert bad["label"] == "Fallback label from prompt"
      assert bad["role"] == nil
      assert bad["tool_use_id"] == nil
      assert bad["path"] == bad_jsonl
    end
  end

  describe "facade unknown agent_kind" do
    test "returns safe defaults" do
      assert SessionLog.resolve_subagent("unknown", "any-id") == :error
      assert SessionLog.list_subagents("unknown", "/tmp/parent.jsonl") == []
      assert SessionLog.subagent_meta("unknown", "/tmp/child.jsonl") == %{}
    end

    test "opencode subagent callbacks are no-ops" do
      assert SessionLog.resolve_subagent("opencode", "any-id") == :error
      assert SessionLog.list_subagents("opencode", "/tmp/parent.jsonl") == []
      assert SessionLog.subagent_meta("opencode", "/tmp/child.jsonl") == %{}
    end
  end

  defp write_jsonl!(path, rows) when is_list(rows) do
    File.mkdir_p!(Path.dirname(path))

    body =
      rows
      |> Enum.map(&Jason.encode!/1)
      |> Enum.join("\n")

    File.write!(path, body <> "\n")
  end
end
