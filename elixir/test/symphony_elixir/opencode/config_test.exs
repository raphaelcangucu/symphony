defmodule SymphonyElixir.OpenCode.ConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.OpenCode.Config

  test "command/0 falls back to instance command when section empty" do
    assert is_binary(Config.command())
    assert String.length(Config.command()) > 0
  end

  test "validate!/0 ok when command present" do
    assert Config.validate!() == :ok
  end
end
