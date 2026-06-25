defmodule SymphonyElixir.KnowledgeBase.HomePageTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{HomePage, MarkdownPage}

  test "render produces a generated home page listing projects" do
    out = HomePage.render([%{name: "Acme", slug: "acme"}, %{name: "Beta", slug: "beta"}])

    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.frontmatter["generated"] == true
    assert page.frontmatter["title"] == "Knowledge Base"
    assert page.body =~ "- [Acme](/projects/acme/kb)"
    assert page.body =~ "- [Beta](/projects/beta/kb)"
  end

  test "render handles an empty project list with a placeholder" do
    out = HomePage.render([])
    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.body =~ "No projects yet"
  end
end
