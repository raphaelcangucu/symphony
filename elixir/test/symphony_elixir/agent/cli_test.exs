defmodule SymphonyElixir.Agent.CLITest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Agent.{CLI, Client}

  test "lists providers as a machine-readable contract" do
    assert {:ok, payload, :json} = CLI.evaluate(["providers"], deps())
    assert payload.command == "providers"
    assert payload.providers == ["codex", "claude", "cursor"]
  end

  test "shows capabilities for one provider" do
    assert {:ok, payload, :json} =
             CLI.evaluate(["capabilities", "--agent", "codex"], deps())

    assert payload.command == "capabilities"
    assert payload.capabilities.provider == "codex"
    assert payload.capabilities.steer
    assert payload.capabilities.native_goal
  end

  test "runs an agent and forwards resume and model options" do
    parent = self()

    client_execute = fn operation, opts ->
      send(parent, {:client_execute, operation, opts})

      {:ok,
       %{
         provider: "cursor",
         conversation_id: "cursor-chat-7",
         run_id: "cursor-run-7",
         execution_id: "exec-7",
         assistant_message: "finished"
       }}
    end

    assert {:ok, payload, :json} =
             CLI.evaluate(
               [
                 "run",
                 "--agent",
                 "cursor",
                 "--workspace",
                 "./repo",
                 "--prompt",
                 "Fix it",
                 "--conversation",
                 "cursor-chat-7",
                 "--model",
                 "composer",
                 "--effort",
                 "high",
                 "--mode",
                 "build"
               ],
               deps(client_execute)
             )

    assert_receive {:client_execute, :run, opts}
    assert opts[:provider] == "cursor"
    assert opts[:workspace] == Path.expand("./repo")
    assert opts[:prompt] == "Fix it"
    assert opts[:conversation_id] == "cursor-chat-7"
    assert opts[:model] == "composer"
    assert opts[:effort] == "high"
    assert opts[:execution_mode] == "build"
    assert payload.result.execution_id == "exec-7"
  end

  test "accepts a positional prompt and text output" do
    assert {:ok, "finished", :text} =
             CLI.evaluate(
               ["run", "--agent", "claude", "--text", "Explain", "this"],
               deps(fn :run, _opts -> {:ok, %{assistant_message: "finished"}} end)
             )
  end

  test "goal and steer use the same provider-neutral option contract" do
    parent = self()

    execute = fn operation, opts ->
      send(parent, {:execute, operation, opts})

      {:ok,
       %{
         provider: opts[:provider],
         conversation_id: opts[:conversation_id] || "new-conversation",
         run_id: "run-1",
         execution_id: "execution-1",
         assistant_message: "done"
       }}
    end

    assert {:ok, %{command: "goal"}, :json} =
             CLI.evaluate(
               ["goal", "--agent", "cursor", "--prompt", "Finish it", "--mode", "build"],
               deps(execute)
             )

    assert_receive {:execute, :goal, goal_opts}
    assert goal_opts[:provider] == "cursor"
    assert goal_opts[:prompt] == "Finish it"
    assert goal_opts[:execution_mode] == "build"

    assert {:ok, %{command: "steer"}, :json} =
             CLI.evaluate(
               [
                 "steer",
                 "--agent",
                 "claude",
                 "--conversation",
                 "claude-chat",
                 "--prompt",
                 "Focus on tests"
               ],
               deps(execute)
             )

    assert_receive {:execute, :steer, steer_opts}
    assert steer_opts[:provider] == "claude"
    assert steer_opts[:conversation_id] == "claude-chat"
    assert steer_opts[:prompt] == "Focus on tests"
  end

  test "returns the stable error contract for invalid input" do
    assert {:error, encoded} = CLI.evaluate(["run", "--agent", "codex"], deps())
    assert error(encoded)["code"] == "prompt_required"

    assert {:error, encoded} =
             CLI.evaluate(["run", "--agent", "codex", "--prompt", "x", "--json"], deps())

    assert error(encoded)["code"] == "invalid_cli_arguments"

    assert {:error, encoded} = CLI.evaluate(["capabilities", "--agent", "unknown"], deps())
    assert error(encoded)["code"] == "unsupported_provider"

    assert {:error, encoded} = CLI.evaluate(["providers", "unexpected"], deps())
    assert error(encoded)["code"] == "invalid_cli_arguments"

    assert {:error, encoded} = CLI.evaluate(["wat"], deps())
    assert error(encoded)["code"] == "unknown_agent_command"
  end

  defp error(encoded) do
    assert %{"error" => error} = Jason.decode!(encoded)
    assert Map.keys(error) |> Enum.sort() == ~w(category code details message retryable)
    error
  end

  defp deps(client_execute \\ fn _operation, _opts -> {:error, %{"code" => "not_called"}} end) do
    %{
      client_execute: client_execute,
      providers: fn -> ["codex", "claude", "cursor"] end,
      capabilities: &Client.capabilities/1
    }
  end
end
