defmodule SymphonyElixir.KnowledgeBase.MarkdownPageTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.MarkdownPage

  test "parses frontmatter, body, and title from frontmatter" do
    content = "---\ntitle: Architecture\norder: 10\n---\n# Heading\n\nBody text\n"

    assert {:ok, page} = MarkdownPage.parse(content)
    assert page.frontmatter["title"] == "Architecture"
    assert page.frontmatter["order"] == 10
    assert page.title == "Architecture"
    assert page.body == "# Heading\n\nBody text\n"
  end

  test "falls back to first H1 when frontmatter has no title" do
    assert {:ok, page} = MarkdownPage.parse("# Backend Guide\n\ntext")
    assert page.frontmatter == %{}
    assert page.title == "Backend Guide"
  end

  test "falls back to default_title when no frontmatter and no H1" do
    assert {:ok, page} = MarkdownPage.parse("plain text only", default_title: "guide")
    assert page.title == "guide"
  end

  test "treats empty frontmatter block as empty map" do
    assert {:ok, page} = MarkdownPage.parse("---\n---\nbody", default_title: "x")
    assert page.frontmatter == %{}
    assert page.body == "body"
  end

  test "returns error for invalid frontmatter yaml" do
    assert MarkdownPage.parse("---\n: : :\nbad\n---\nbody") == {:error, :kb_frontmatter_invalid}
  end

  test "returns error when frontmatter is not a map" do
    assert MarkdownPage.parse("---\n- a\n- b\n---\nbody") == {:error, :kb_frontmatter_invalid}
  end
end
