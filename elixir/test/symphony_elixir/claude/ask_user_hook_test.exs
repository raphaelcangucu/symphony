defmodule SymphonyElixir.Claude.AskUserHookTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.UserInputBroker
  alias SymphonyElixir.Claude.AskUserHook
  alias SymphonyElixir.Claude.AppServer.ToolGateway

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

  test "priv ask_user_hook.sh round-trips through ToolGateway with allow" do
    UserInputBroker.ensure_started()
    session_token = "hook-smoke-#{System.unique_integer([:positive])}"
    channel = self()

    assert :ok =
             UserInputBroker.bind_session(session_token, %{
               channel_pid: channel,
               thread_id: 7,
               agent: "claude"
             })

    on_exit(fn -> UserInputBroker.unbind_session(session_token) end)

    {:ok, mcp_token, _mcp_url} = ToolGateway.register_session([], fn _, _ -> %{"ok" => true} end)
    on_exit(fn -> ToolGateway.unregister_session(mcp_token) end)

    base_url = ToolGateway.loopback_base_url()
    assert is_binary(base_url)
    ask_url = base_url <> "/user-input/" <> session_token
    script = AskUserHook.priv_script_path!()
    request_id = "smoke-#{System.unique_integer([:positive])}"

    stdin =
      Jason.encode!(%{
        "tool_name" => "AskUserQuestion",
        "tool_use_id" => request_id,
        "tool_input" => %{
          "questions" => [
            %{
              "header" => "H",
              "question" => "Which?",
              "options" => [%{"label" => "Yes", "description" => ""}]
            }
          ]
        }
      })

    input_path = Path.join(System.tmp_dir!(), "ask-user-stdin-#{System.unique_integer([:positive])}.json")
    File.write!(input_path, stdin)
    on_exit(fn -> File.rm(input_path) end)

    task =
      Task.async(fn ->
        System.cmd("bash", ["-c", "#{shell_quote(script)} < #{shell_quote(input_path)}"],
          env: [
            {"SYMPHONY_ASK_USER_URL", ask_url},
            {"SYMPHONY_ASK_USER_TIMEOUT_SEC", "5"}
          ],
          stderr_to_stdout: true
        )
      end)

    assert_receive {:assistant_user_input_required, %{request_id: ^request_id, questions: ui_qs}}, 2_000
    assert hd(ui_qs)["id"] == "q0"

    assert :ok = UserInputBroker.resolve(request_id, %{"q0" => %{"answers" => ["Yes"]}})

    assert {stdout, 0} = Task.await(task, 6_000)
    assert {:ok, decoded} = Jason.decode(stdout)
    assert get_in(decoded, ["hookSpecificOutput", "permissionDecision"]) == "allow"
    assert get_in(decoded, ["hookSpecificOutput", "updatedInput", "answers", "Which?"]) == "Yes"
  end

  defp shell_quote(path) when is_binary(path) do
    "'" <> String.replace(path, "'", "'\"'\"'") <> "'"
  end
end
