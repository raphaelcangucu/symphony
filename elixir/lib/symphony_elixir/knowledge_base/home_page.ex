defmodule SymphonyElixir.KnowledgeBase.HomePage do
  @moduledoc "Renders the generated general-KB home page that links to project KBs."

  alias SymphonyElixir.KnowledgeBase.Frontmatter

  # The tracker SPA is mounted under this base path (Vite `base` + the Phoenix
  # `/tracker/*` static routes + the React Router `basename`). Generated links
  # must include it so they resolve to a real, directly-loadable URL: a bare
  # `/projects/...` href bypasses the SPA and hits the Phoenix API catch-all,
  # which answers `{"error":{"code":"not_found"}}`.
  @tracker_base_path "/tracker"

  @spec render([%{name: String.t(), slug: String.t()}]) :: String.t()
  def render(projects) when is_list(projects) do
    Frontmatter.serialize(%{"title" => "Knowledge Base", "generated" => true}, body(projects))
  end

  defp body([]), do: heading() <> "_No projects yet. Create a project to see it here._\n"

  defp body(projects) do
    items =
      Enum.map_join(projects, "\n", fn %{name: name, slug: slug} ->
        "- [#{name}](#{project_kb_path(slug)})"
      end)

    heading() <> items <> "\n"
  end

  defp project_kb_path(slug) when is_binary(slug), do: "#{@tracker_base_path}/projects/#{slug}/kb"

  defp heading do
    "# Knowledge Base\n\nWelcome to your personal knowledge base.\n\n## Projects\n\n"
  end
end
