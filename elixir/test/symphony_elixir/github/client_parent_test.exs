defmodule SymphonyElixir.GitHub.ClientParentTest do
  use SymphonyElixir.TestSupport, async: true

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.Issue

  defp item(content_overrides) do
    content =
      Map.merge(
        %{
          "__typename" => "Issue",
          "id" => "I_child",
          "number" => 43,
          "title" => "Child run",
          "body" => "",
          "url" => "https://github.com/macro/be/issues/43",
          "repository" => %{"nameWithOwner" => "macro/be"}
        },
        content_overrides
      )

    %{
      "content" => content,
      "fieldValues" => %{
        "nodes" => [
          %{
            "__typename" => "ProjectV2ItemFieldSingleSelectValue",
            "name" => "In Progress",
            "field" => %{"name" => "Status"}
          }
        ]
      }
    }
  end

  test "maps a GitHub sub-issue's parent number and repository onto the issue" do
    issue = Client.normalize_project_item_for_test(item(%{"parent" => %{"number" => 7}}), "Status")

    assert %Issue{} = issue
    assert issue.identifier == "43"
    assert issue.parent_identifier == "7"
    assert issue.repository_full_name == "macro/be"
    assert issue.state == "In Progress"
  end

  test "leaves parent_identifier nil when the issue has no parent" do
    issue = Client.normalize_project_item_for_test(item(%{}), "Status")

    assert issue.parent_identifier == nil
    assert issue.repository_full_name == "macro/be"
  end
end
