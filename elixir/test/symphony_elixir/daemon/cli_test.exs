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
end
