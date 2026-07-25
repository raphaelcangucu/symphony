defmodule SymphonyElixir.Daemon.BuildInfoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Daemon.BuildInfo

  setup do
    previous = Application.get_env(:symphony_elixir, :build_info)

    on_exit(fn ->
      if is_nil(previous) do
        Application.delete_env(:symphony_elixir, :build_info)
      else
        Application.put_env(:symphony_elixir, :build_info, previous)
      end
    end)
  end

  test "snapshot exposes configured build identity without paths or secrets" do
    Application.put_env(:symphony_elixir, :build_info, %{
      version: "1.2.3",
      git_commit: "abc123",
      mode: "installed"
    })

    BuildInfo.mark_started(~U[2026-07-24 12:00:00Z])

    assert BuildInfo.snapshot() == %{
             version: "1.2.3",
             git_commit: "abc123",
             mode: "installed",
             started_at: "2026-07-24T12:00:00Z"
           }
  end
end
