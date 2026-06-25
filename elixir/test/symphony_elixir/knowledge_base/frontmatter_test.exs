defmodule SymphonyElixir.KnowledgeBase.FrontmatterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{Frontmatter, MarkdownPage}

  test "serialize emits a YAML frontmatter block followed by the body" do
    out = Frontmatter.serialize(%{"title" => "Hello", "order" => 3}, "# Hello\n\nbody\n")
    assert String.starts_with?(out, "---\n")
    assert {:ok, page} = MarkdownPage.parse(out)
    assert page.frontmatter["title"] == "Hello"
    assert page.frontmatter["order"] == 3
    assert page.body == "# Hello\n\nbody\n"
  end

  test "serialize without frontmatter returns the body unchanged" do
    assert Frontmatter.serialize(%{}, "plain body\n") == "plain body\n"
  end

  test "merge keeps existing keys and overrides provided ones" do
    assert Frontmatter.merge(%{"title" => "Old", "order" => 1}, %{"title" => "New"}) ==
             %{"title" => "New", "order" => 1}
  end
end
