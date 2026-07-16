defmodule SymphonyElixir.Assistant.FreeformPromptSurfaceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.AgentSession

  describe "freeform_location_block/1" do
    test "home surface frames the global operator role" do
      block = AgentSession.freeform_location_block(%{"surface" => "home"})
      assert block =~ "Home"
      assert block =~ "@user"
    end

    test "observability surface points at runtimes" do
      block = AgentSession.freeform_location_block(%{"surface" => "observability"})
      assert block =~ "Observability"
      assert block =~ "list_observability_runtimes"
    end

    test "defaults to home when surface is missing" do
      assert AgentSession.freeform_location_block(%{}) =~ "Home"
    end
  end
end
