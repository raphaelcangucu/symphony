defmodule SymphonyElixir.GitHub.BlockersTest do
  use SymphonyElixir.TestSupport, async: true

  alias SymphonyElixir.GitHub.Blockers

  test "from_tracked maps issue nodes to blocker maps" do
    issue = %{
      "trackedInIssues" => %{
        "nodes" => [
          %{
            "id" => "I_issue1",
            "number" => 42,
            "state" => "OPEN",
            "repository" => %{"nameWithOwner" => "clouapp/front"}
          }
        ]
      }
    }

    assert [%{id: "I_issue1", identifier: "clouapp/front#42", state: "OPEN"}] =
             Blockers.from_tracked(issue)
  end

  test "from_body parses same-repo and cross-repo references" do
    body = """
    Blocked by #7
    Depends on clouapp/other#12
    """

    assert [
             %{identifier: "clouapp/front#7", state: nil},
             %{identifier: "clouapp/other#12", state: nil}
           ] = Blockers.from_body(body, "clouapp/front")
  end

  test "merge prefers tracked entries over body duplicates" do
    tracked = [%{id: "I_1", identifier: "clouapp/front#7", state: "OPEN"}]
    parsed = [%{id: nil, identifier: "clouapp/front#7", state: nil}]

    merged = Blockers.merge(tracked, parsed)
    assert length(merged) == 1
    assert hd(merged).id == "I_1"
  end

  test "from_tracked returns empty for missing field" do
    assert Blockers.from_tracked(%{}) == []
  end

  test "from_body returns empty for nil body" do
    assert Blockers.from_body(nil, "clouapp/front") == []
  end

  test "merge returns parsed-only blockers when tracked is empty" do
    parsed = [%{id: nil, identifier: "clouapp/front#1", state: nil}]
    assert Blockers.merge([], parsed) == parsed
  end

  test "from_tracked handles nodes without id" do
    issue = %{
      "trackedInIssues" => %{
        "nodes" => [%{"number" => 3, "repository" => %{"nameWithOwner" => "clouapp/front"}}]
      }
    }

    assert [%{id: nil, identifier: "clouapp/front#3"}] = Blockers.from_tracked(issue)
  end
end
