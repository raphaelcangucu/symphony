defmodule SymphonyElixir.KnowledgeBase.HomePage do
  @moduledoc "Renders the generated general-KB home page that links to project KBs."

  alias SymphonyElixir.KnowledgeBase.Frontmatter

  @spec render([%{name: String.t(), slug: String.t()}]) :: String.t()
  def render(projects) when is_list(projects) do
    Frontmatter.serialize(%{"title" => "Knowledge Base", "generated" => true}, body(projects))
  end

  defp body([]), do: heading() <> "_No projects yet. Create a project to see it here._\n"

  defp body(projects) do
    items =
      Enum.map_join(projects, "\n", fn %{name: name, slug: slug} ->
        "- [#{name}](/projects/#{slug}/kb)"
      end)

    heading() <> items <> "\n"
  end

  defp heading do
    "# Knowledge Base\n\nWelcome to your personal knowledge base.\n\n## Projects\n\n"
  end
end
