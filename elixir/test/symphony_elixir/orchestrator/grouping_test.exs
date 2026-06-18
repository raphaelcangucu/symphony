defmodule SymphonyElixir.Orchestrator.GroupingTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Orchestrator.Grouping

  test "dispatch_candidates drops members but keeps leads and standalone" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-2"]}
    member = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}
    solo = %Issue{id: "3", identifier: "MAC-3"}

    assert Grouping.dispatch_candidates([lead, member, solo]) == [lead, solo]
  end

  test "members_for resolves member structs in the lead's order" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-3", "MAC-2"]}
    m2 = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}
    m3 = %Issue{id: "3", identifier: "MAC-3", group_lead_identifier: "MAC-1"}

    assert Grouping.members_for(lead, [lead, m2, m3]) == [m3, m2]
  end

  test "claim_ids includes the lead and members" do
    lead = %Issue{id: "1", identifier: "MAC-1", group_member_identifiers: ["MAC-2"]}
    m2 = %Issue{id: "2", identifier: "MAC-2", group_lead_identifier: "MAC-1"}

    assert Grouping.claim_ids(lead, [m2]) == ["1", "2"]
  end
end
