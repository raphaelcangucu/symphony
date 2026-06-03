defmodule SymphonyElixir.IssueTest do
  use ExUnit.Case, async: true

  test "issue struct carries project_slug defaulting to nil" do
    assert %SymphonyElixir.Issue{}.project_slug == nil
    assert %SymphonyElixir.Issue{project_slug: "alpha"}.project_slug == "alpha"
  end
end
