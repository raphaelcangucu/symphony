defmodule SymphonyElixir.DevServeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServe

  describe "resolve_port/1" do
    test "returns {:ok, nil} when no port override is configured" do
      assert DevServe.resolve_port(%{}) == {:ok, nil}
    end

    test "parses a valid port override" do
      assert DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "4567"}) == {:ok, 4567}
    end

    test "rejects a non-integer port override" do
      assert {:error, message} = DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "abc"})
      assert message =~ "Invalid SYMPHONY_TRACKER_PORT"
    end
  end
end
