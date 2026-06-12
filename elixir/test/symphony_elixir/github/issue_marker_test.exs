defmodule SymphonyElixir.GitHub.IssueMarkerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueMarker

  test "marker_line builds the default-key line" do
    assert IssueMarker.marker_line("GAM-2") == "Symphony-Issue: GAM-2"
  end

  test "marker_line honors a custom key and trims the identifier" do
    assert IssueMarker.marker_line("  GAM-2 ", "Linked-Issue") == "Linked-Issue: GAM-2"
  end

  test "extract finds one marker (case-insensitive key, surrounding text)" do
    body = "Recovery publish\n\nsymphony-issue:  GAM-2  \n\nMade with Cursor"
    assert IssueMarker.extract(body) == ["GAM-2"]
  end

  test "extract finds multiple distinct markers and dedups" do
    body = "Symphony-Issue: GAM-2\nSymphony-Issue: GAM-2\nSymphony-Issue: GAM-9"
    assert IssueMarker.extract(body) == ["GAM-2", "GAM-9"]
  end

  test "extract returns [] when absent or nil" do
    assert IssueMarker.extract("no marker here") == []
    assert IssueMarker.extract(nil) == []
  end
end
