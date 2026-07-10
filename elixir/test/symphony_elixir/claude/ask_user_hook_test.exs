defmodule SymphonyElixir.Claude.AskUserHookTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Claude.AskUserHook

  test "write_settings! installs PreToolUse matcher and returns settings path" do
    dir = Path.join(System.tmp_dir!(), "ask-user-hook-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf(dir) end)

    assert {:ok, path} =
             AskUserHook.write_settings!(dir,
               session_token: "tok",
               gateway_base_url: "http://127.0.0.1:9999",
               timeout_ms: 1000
             )

    assert File.exists?(path)
    assert {:ok, json} = Jason.decode(File.read!(path))
    hooks = get_in(json, ["hooks", "PreToolUse"])
    assert is_list(hooks)
    assert Enum.any?(hooks, fn h -> h["matcher"] == "AskUserQuestion" end)
  end

  test "allow_payload builds hookSpecificOutput" do
    payload =
      AskUserHook.allow_payload(%{
        "questions" => [%{"question" => "Q?"}],
        "answers" => %{"Q?" => "A"}
      })

    assert get_in(payload, ["hookSpecificOutput", "permissionDecision"]) == "allow"
    assert get_in(payload, ["hookSpecificOutput", "updatedInput", "answers", "Q?"]) == "A"
  end

  test "deny_payload builds deny hookSpecificOutput" do
    payload = AskUserHook.deny_payload("Operator input timed out")
    assert get_in(payload, ["hookSpecificOutput", "permissionDecision"]) == "deny"
    assert get_in(payload, ["hookSpecificOutput", "permissionDecisionReason"]) == "Operator input timed out"
  end
end
