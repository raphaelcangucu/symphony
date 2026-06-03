defmodule SymphonyElixir.Assistant.ToolCallPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ToolCallPresenter

  test "arguments/1 reads params.arguments from the payload" do
    payload = %{"params" => %{"name" => "move_issue", "arguments" => %{"identifier" => "MAC-1", "status" => "In Progress"}}}
    assert ToolCallPresenter.arguments(payload) == %{"identifier" => "MAC-1", "status" => "In Progress"}
  end

  test "arguments/1 returns nil when absent" do
    assert ToolCallPresenter.arguments(%{"params" => %{}}) == nil
    assert ToolCallPresenter.arguments(%{}) == nil
  end

  test "output/1 returns the tool result message on success" do
    result = %{"success" => true, "toolResult" => %{"tool" => "move_issue", "message" => "Moved issue MAC-1 to In Progress.", "data" => %{}}}
    assert ToolCallPresenter.output(result) == "Moved issue MAC-1 to In Progress."
  end

  test "output/1 returns the error message on failure" do
    result = %{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => ~s({"error":{"message":"Issue not found."}})}]}
    assert ToolCallPresenter.output(result) == "Issue not found."
  end

  test "output/1 returns nil for empty result" do
    assert ToolCallPresenter.output(%{}) == nil
  end
end
