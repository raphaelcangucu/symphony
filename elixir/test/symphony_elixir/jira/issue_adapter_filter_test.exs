defmodule SymphonyElixir.Jira.IssueAdapter.FilterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Jira.IssueAdapter.Filter
  alias SymphonyElixir.LocalTracker.Project

  defp project(config), do: %Project{tracker_kind: "jira", tracker_config: config}

  test "bare project_key keeps today's behavior" do
    assert Filter.build_jql(project(%{"project_key" => "CDE"})) ==
             ~s|project = "CDE" ORDER BY created DESC|
  end

  test "a single fields entry adds an equality clause" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}})) ==
             ~s|project = "CDE" AND "Product" = "Inspire" ORDER BY created DESC|
  end

  test "multiple fields entries are AND-joined, ordered by key" do
    jql =
      Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire", "Institution" => "westhillscollege"}}))

    assert jql ==
             ~s|project = "CDE" AND "Institution" = "westhillscollege" AND "Product" = "Inspire" ORDER BY created DESC|
  end

  test "a raw jql fragment is parenthesized and ANDed after fields" do
    jql =
      Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => "Inspire"}, "jql" => "updated >= -30d"}))

    assert jql ==
             ~s|project = "CDE" AND "Product" = "Inspire" AND (updated >= -30d) ORDER BY created DESC|
  end

  test "jql only (no fields)" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "jql" => ~s|cf[10050] = "Inspire"|})) ==
             ~s|project = "CDE" AND (cf[10050] = "Inspire") ORDER BY created DESC|
  end

  test "blank/whitespace fields and jql are ignored" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"  " => "x", "Product" => "  "}, "jql" => "   "})) == ~s|project = "CDE" ORDER BY created DESC|
  end

  test "values and names with embedded quotes are escaped" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "fields" => %{"Product" => ~s|In"spire|}})) ==
             ~s|project = "CDE" AND "Product" = "In\\"spire" ORDER BY created DESC|
  end

  test "custom order_by overrides the default" do
    assert Filter.build_jql(project(%{"project_key" => "CDE", "order_by" => "Rank ASC"})) ==
             ~s|project = "CDE" ORDER BY Rank ASC|
  end

  describe "keys_jql/2" do
    test "scopes a quoted key set to the project" do
      assert Filter.keys_jql(project(%{"project_key" => "CDE"}), ["CDE-1141", "CDE-1142"]) ==
               ~s|project = "CDE" AND key in ("CDE-1141", "CDE-1142") ORDER BY created DESC|
    end

    test "escapes embedded quotes in keys" do
      assert Filter.keys_jql(project(%{"project_key" => "CDE"}), [~s|CDE-"1|]) ==
               ~s|project = "CDE" AND key in ("CDE-\\"1") ORDER BY created DESC|
    end
  end
end
