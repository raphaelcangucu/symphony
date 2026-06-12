defmodule SymphonyElixir.Jira.IssueAdapter.QueryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.IssueAdapter.Query
  alias SymphonyElixir.Tracker.IssueDTO

  @ctx %{project_slug: "acme", base_url: "https://acme.atlassian.net"}

  defp issue_node do
    %{
      "id" => "10001",
      "key" => "ABC-12",
      "fields" => %{
        "summary" => "Fix the thing",
        "description" => %{
          "type" => "doc",
          "content" => [%{"type" => "paragraph", "content" => [%{"type" => "text", "text" => "body"}]}]
        },
        "priority" => %{"name" => "High"},
        "status" => %{"name" => "In Progress", "statusCategory" => %{"key" => "indeterminate"}},
        "assignee" => %{"displayName" => "Bot"},
        "creator" => %{"displayName" => "Maker"},
        "created" => "2026-06-01T10:00:00.000Z",
        "updated" => "2026-06-01T12:00:00.000Z"
      }
    }
  end

  describe "category_for/1" do
    test "maps JIRA status categories to Symphony categories" do
      assert Query.category_for("new") == "unstarted"
      assert Query.category_for("indeterminate") == "started"
      assert Query.category_for("done") == "completed"
      assert Query.category_for("anything") == "unstarted"
    end
  end

  describe "normalize_issue/2" do
    test "builds an IssueDTO from a JIRA issue node" do
      dto = Query.normalize_issue(issue_node(), @ctx)

      assert %IssueDTO{} = dto
      assert dto.id == "10001"
      assert dto.identifier == "ABC-12"
      assert dto.title == "Fix the thing"
      assert dto.description == "body"
      assert dto.priority == 2
      assert dto.assignee == "Bot"
      assert dto.creator == "Maker"
      assert dto.project_slug == "acme"
      assert dto.url == "https://acme.atlassian.net/browse/ABC-12"
      assert dto.status == %{name: "In Progress", category: "started", position: nil, is_terminal: false}
    end

    test "marks done statuses as terminal" do
      node = put_in(issue_node(), ["fields", "status"], %{"name" => "Done", "statusCategory" => %{"key" => "done"}})
      dto = Query.normalize_issue(node, @ctx)
      assert dto.status.category == "completed"
      assert dto.status.is_terminal == true
    end

    test "defaults attachments to an empty list when the issue has none" do
      assert Query.normalize_issue(issue_node(), @ctx).attachments == []
    end

    test "normalizes issue attachments" do
      node =
        put_in(issue_node(), ["fields", "attachment"], [
          %{
            "id" => "10500",
            "filename" => "WHCCD.VAR.docx",
            "mimeType" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "size" => 24_576,
            "created" => "2026-06-01T09:00:00.000Z",
            "author" => %{"displayName" => "Maker"}
          },
          %{
            "id" => "10501",
            "filename" => "screenshot.png",
            "mimeType" => "image/png",
            "size" => 2048,
            "created" => "2026-06-01T09:30:00.000Z",
            "author" => %{"displayName" => "Maker"}
          }
        ])

      assert Query.normalize_issue(node, @ctx).attachments == [
               %{
                 id: "10500",
                 filename: "WHCCD.VAR.docx",
                 mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 size: 24_576,
                 created: "2026-06-01T09:00:00.000Z",
                 author: "Maker",
                 is_image: false
               },
               %{
                 id: "10501",
                 filename: "screenshot.png",
                 mime_type: "image/png",
                 size: 2048,
                 created: "2026-06-01T09:30:00.000Z",
                 author: "Maker",
                 is_image: true
               }
             ]
    end
  end

  describe "attachments/1" do
    test "skips entries without an id and coerces ids to strings" do
      assert Query.attachments([
               %{"filename" => "orphan.txt"},
               %{"id" => 99, "filename" => "kept.txt", "mimeType" => "text/plain"}
             ]) == [
               %{
                 id: "99",
                 filename: "kept.txt",
                 mime_type: "text/plain",
                 size: nil,
                 created: nil,
                 author: nil,
                 is_image: false
               }
             ]
    end

    test "returns [] for non-list payloads" do
      assert Query.attachments(nil) == []
    end
  end

  describe "statuses/1" do
    test "flattens project statuses across issue types, unique by name, ordered" do
      response = [
        %{
          "name" => "Task",
          "statuses" => [
            %{"id" => "1", "name" => "To Do", "statusCategory" => %{"key" => "new"}},
            %{"id" => "2", "name" => "In Progress", "statusCategory" => %{"key" => "indeterminate"}}
          ]
        },
        %{
          "name" => "Bug",
          "statuses" => [
            %{"id" => "2", "name" => "In Progress", "statusCategory" => %{"key" => "indeterminate"}},
            %{"id" => "3", "name" => "Done", "statusCategory" => %{"key" => "done"}}
          ]
        }
      ]

      statuses = Query.statuses(response)

      assert Enum.map(statuses, & &1.name) == ["To Do", "In Progress", "Done"]
      assert Enum.map(statuses, & &1.position) == [0, 1, 2]
      assert List.last(statuses).is_terminal == true
    end
  end

  describe "labels/1" do
    test "maps system label strings to label options" do
      assert Query.labels(%{"values" => ["backend", "urgent"]}) == [
               %{id: nil, name: "backend"},
               %{id: nil, name: "urgent"}
             ]
    end

    test "returns [] for unexpected payloads" do
      assert Query.labels(%{}) == []
    end
  end

  describe "users/1" do
    test "maps assignable users to user options" do
      response = [
        %{"accountId" => "acc-1", "displayName" => "Bot", "avatarUrls" => %{"48x48" => "http://x/a.png"}}
      ]

      assert Query.users(response) == [
               %{id: "acc-1", login: "Bot", name: "Bot", avatar_url: "http://x/a.png"}
             ]
    end
  end

  describe "created_issue/3" do
    test "builds a DTO from a create response and the requested title" do
      response = %{"id" => "10010", "key" => "ABC-99"}
      assert {:ok, dto} = Query.created_issue(response, @ctx, "New title")
      assert dto.id == "10010"
      assert dto.identifier == "ABC-99"
      assert dto.title == "New title"
      assert dto.url == "https://acme.atlassian.net/browse/ABC-99"
    end

    test "errors when the response has no key" do
      assert {:error, :create_failed} = Query.created_issue(%{}, @ctx, "t")
    end
  end
end
