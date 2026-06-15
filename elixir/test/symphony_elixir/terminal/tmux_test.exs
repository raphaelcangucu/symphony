defmodule SymphonyElixir.Terminal.TmuxTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Terminal.Tmux

  describe "capture_pane/1 output normalization" do
    test "trims trailing blank lines from captured pane output" do
      runner = fn "tmux", ["capture-pane", "-t", "sym-issue-test", "-p", "-S", "-2000"], _opts ->
        {"prompt$\nhello\n\n\n\n", 0}
      end

      previous = Application.get_env(:symphony_elixir, :terminal_tmux_command_runner)
      Application.put_env(:symphony_elixir, :terminal_tmux_command_runner, runner)

      try do
        assert {:ok, "prompt$\nhello"} = Tmux.capture_pane("sym-issue-test")
      after
        Application.put_env(:symphony_elixir, :terminal_tmux_command_runner, previous)
      end
    end
  end
end
