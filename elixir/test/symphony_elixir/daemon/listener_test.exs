defmodule SymphonyElixir.Daemon.ListenerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Listener

  test "parses listener pids from ss output" do
    output =
      ~s|LISTEN 0 1024 127.0.0.1:4000 0.0.0.0:* users:(("beam.smp",pid=4242,fd=39))\n|

    assert {:owned, [4242]} = Listener.parse(output)
    assert :free = Listener.parse("")
  end
end
