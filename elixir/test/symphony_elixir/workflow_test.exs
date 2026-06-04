defmodule SymphonyElixir.WorkflowTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workflow

  describe "parse_string/1" do
    test "returns front matter and body" do
      md = "---\ntracker:\n  active_states: [Todo]\n---\n\nHello {{ issue.identifier }}"
      assert {:ok, %{config: cfg, prompt: body}} = Workflow.parse_string(md)
      assert get_in(cfg, ["tracker", "active_states"]) == ["Todo"]
      assert body =~ "Hello"
    end

    test "empty front matter yields empty config" do
      assert {:ok, %{config: %{}, prompt: "just a body"}} = Workflow.parse_string("just a body")
    end

    test "reports non-map front matter" do
      assert {:error, :workflow_front_matter_not_a_map} =
               Workflow.parse_string("---\n- a\n- b\n---\nx")
    end
  end

  describe "to_markdown/2" do
    test "round-trips structured front matter including multiline hooks" do
      fm = %{
        "tracker" => %{"active_states" => ["Todo", "In Progress"]},
        "agent" => %{"max_turns" => 7},
        "hooks" => %{"after_create" => "gh repo clone x .\necho done"}
      }

      md = Workflow.to_markdown(fm, "Body {{ issue.identifier }}")
      assert {:ok, %{config: parsed, prompt: prompt}} = Workflow.parse_string(md)
      assert parsed == fm
      assert prompt == "Body {{ issue.identifier }}"
    end

    test "empty front matter returns just the body" do
      assert Workflow.to_markdown(%{}, "only body") == "only body"
    end
  end
end
