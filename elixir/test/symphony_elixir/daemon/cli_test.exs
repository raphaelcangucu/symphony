defmodule SymphonyElixir.Daemon.CLITest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.CLI

  test "parses every supported command and option" do
    assert {:ok, {:status, %{json: true}}} = CLI.parse(["daemon", "status", "--json"])
    assert {:ok, {:restart, %{force: true}}} = CLI.parse(["daemon", "restart", "--force"])

    assert {:ok,
            {:install,
             %{
               artifact: "/tmp/symphony.tgz",
               migrate_from: "/repo/elixir",
               force: true,
               enable_linger: true,
               acknowledged: true
             }}} =
             CLI.parse([
               "daemon",
               "install",
               "--artifact",
               "/tmp/symphony.tgz",
               "--migrate-from",
               "/repo/elixir",
               "--force",
               "--enable-linger",
               "--i-understand-that-this-will-be-running-without-the-usual-guardrails"
             ])
  end

  test "rejects unknown or cross-command flags" do
    assert {:error, message} = CLI.parse(["daemon", "status", "--force"])
    assert message =~ "Usage:"
  end

  test "preflight configuration errors use exit code 78" do
    deps = %{
      install: fn _options ->
        {:error, {:preflight, "guardrails acknowledgement is required"}}
      end
    }

    assert {:error, %{exit_code: 78, output: output}} =
             CLI.run(["daemon", "install", "--artifact", "/tmp/symphony.tgz"],
               deps: deps
             )

    assert output =~ "guardrails acknowledgement"
  end

  test "human status includes actionable service diagnostics" do
    deps = %{
      status: fn ->
        {:ok,
         %{
           state: :unhealthy,
           installed?: true,
           enabled?: true,
           active?: true,
           listening?: false,
           healthy?: false,
           linger?: false,
           main_pid: 42,
           restart_count: 3,
           drift: [:configuration],
           host: "127.0.0.1",
           port: 4_321,
           unit_name: "symphony.service",
           service: %{"Result" => "exit-code"}
         }}
      end
    }

    assert {:error, %{exit_code: 1, output: output}} =
             CLI.run(["daemon", "status"], deps: deps)

    assert output =~ "enabled=true"
    assert output =~ "listening=false"
    assert output =~ "result=exit-code"
    assert output =~ "repair=symphony daemon install --force"
    assert output =~ "journalctl --user -u symphony.service"
  end
end
