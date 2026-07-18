defmodule SymphonyElixir.Evidence.SessionAuditTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.SessionAudit

  @moduletag :tmp_dir

  defp write_rollout!(tmp_dir, commands) do
    path = Path.join(tmp_dir, "rollout-test.jsonl")

    lines =
      Enum.map(commands, fn cmd ->
        Jason.encode!(%{
          "type" => "response_item",
          "payload" => %{
            "type" => "function_call",
            "name" => "exec_command",
            "call_id" => "c1",
            "arguments" => Jason.encode!(%{"cmd" => cmd})
          }
        })
      end)

    File.write!(path, Enum.join(lines, "\n") <> "\n")
    path
  end

  test "commands present in the session pass", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["npm test -- --watchAll=false", "npx playwright test"])

    assert :ok =
             SessionAudit.verify_commands(["npm test", "npx playwright test"],
               rollout_path: rollout
             )
  end

  test "command never executed fails", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["ls -la"])

    assert {:error, {:commands_not_executed, ["npm test"]}} =
             SessionAudit.verify_commands(["npm test"], rollout_path: rollout)
  end

  test "missing rollout file fails closed", %{tmp_dir: tmp_dir} do
    assert {:error, :session_log_unavailable} =
             SessionAudit.verify_commands(["npm test"],
               rollout_path: Path.join(tmp_dir, "nope.jsonl")
             )
  end

  test "blank declared commands are ignored as never executed", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["npm test"])

    assert {:error, {:commands_not_executed, ["  "]}} =
             SessionAudit.verify_commands(["  "], rollout_path: rollout)
  end

  defp write_claude_log!(tmp_dir, commands) do
    path = Path.join(tmp_dir, "claude-session.jsonl")

    lines =
      commands
      |> Enum.with_index()
      |> Enum.map(fn {cmd, index} ->
        Jason.encode!(%{
          "type" => "assistant",
          "message" => %{
            "content" => [
              %{
                "type" => "tool_use",
                "id" => "toolu_#{index}",
                "name" => "Bash",
                "input" => %{"command" => cmd}
              }
            ]
          }
        })
      end)

    File.write!(path, Enum.join(lines, "\n") <> "\n")
    path
  end

  test "commands executed in a Claude session pass via explicit sources", %{tmp_dir: tmp_dir} do
    claude_log = write_claude_log!(tmp_dir, ["yarn test --run tests/pages/Task2.test.ts"])

    assert :ok =
             SessionAudit.verify_commands(["yarn test --run tests/pages/Task2.test.ts"],
               sources: [{"claude", claude_log}]
             )
  end

  test "commands are accepted when found in ANY of several agent logs", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["npx playwright test task.spec.ts"])
    claude_log = write_claude_log!(tmp_dir, ["./vibe phpunit --filter Task2HealthPageTest"])

    assert :ok =
             SessionAudit.verify_commands(
               ["npx playwright test task.spec.ts", "./vibe phpunit --filter Task2HealthPageTest"],
               sources: [{"codex", rollout}, {"claude", claude_log}]
             )
  end

  test "fabricated commands still fail across multiple agent logs", %{tmp_dir: tmp_dir} do
    rollout = write_rollout!(tmp_dir, ["ls -la"])
    claude_log = write_claude_log!(tmp_dir, ["git status"])

    assert {:error, {:commands_not_executed, ["npm test"]}} =
             SessionAudit.verify_commands(["npm test"],
               sources: [{"codex", rollout}, {"claude", claude_log}]
             )
  end

  test "no readable source at all fails closed", %{tmp_dir: tmp_dir} do
    assert {:error, :session_log_unavailable} =
             SessionAudit.verify_commands(["npm test"],
               sources: [{"codex", Path.join(tmp_dir, "gone.jsonl")}]
             )
  end
end
