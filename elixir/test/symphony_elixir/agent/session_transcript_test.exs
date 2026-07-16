defmodule SymphonyElixir.Agent.SessionTranscriptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.SessionTranscript

  setup do
    workspace = Path.join(System.tmp_dir!(), "session-transcript-#{System.unique_integer([:positive])}")
    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf(workspace) end)
    %{workspace: workspace}
  end

  test "path/2 returns agent-specific symphony jsonl", %{workspace: workspace} do
    assert SessionTranscript.path(:cursor, workspace) ==
             Path.join(workspace, ".symphony/cursor-session.jsonl")

    assert SessionTranscript.path(:claude, workspace) ==
             Path.join(workspace, ".symphony/claude-session.jsonl")
  end

  test "append/3 creates .symphony and appends one NDJSON line", %{workspace: workspace} do
    line = %{"type" => "assistant", "message" => %{"content" => [%{"type" => "text", "text" => "hi"}]}}

    assert :ok = SessionTranscript.append(:cursor, workspace, line)

    path = SessionTranscript.path(:cursor, workspace)
    assert File.exists?(path)
    [written] = path |> File.read!() |> String.split("\n", trim: true)
    assert Jason.decode!(written)["message"]["content"] == [%{"type" => "text", "text" => "hi"}]
  end

  test "append/3 never raises when workspace is unwritable", %{workspace: workspace} do
    blocker = Path.join(workspace, "not-a-dir")
    File.write!(blocker, "x")

    assert :ok =
             SessionTranscript.append(:cursor, blocker, %{
               "type" => "assistant",
               "message" => %{"content" => []}
             })
  end

  test "write_sidecar/3 and read_sidecar/2 round-trip meta", %{workspace: workspace} do
    meta = %{
      "session_id" => "chat-1",
      "agent_kind" => "cursor",
      "model" => "composer-1",
      "effort" => "high",
      "path" => SessionTranscript.path(:cursor, workspace)
    }

    assert :ok = SessionTranscript.write_sidecar(:cursor, workspace, meta)
    assert {:ok, decoded} = SessionTranscript.read_sidecar(:cursor, workspace)
    assert decoded["session_id"] == "chat-1"
    assert decoded["agent_kind"] == "cursor"
    assert decoded["model"] == "composer-1"
    assert decoded["effort"] == "high"
    assert decoded["path"] == meta["path"]
    assert is_binary(decoded["started_at"])
  end
end
