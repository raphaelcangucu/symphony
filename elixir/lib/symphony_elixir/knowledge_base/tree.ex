defmodule SymphonyElixir.KnowledgeBase.Tree do
  @moduledoc "Builds a repository-scoped page tree by walking a `docs/` directory."

  alias SymphonyElixir.KnowledgeBase.MarkdownPage

  @ignored_dirs ["assets", ".git"]
  @no_order 1_000_000

  @type tree_node :: %{
          type: :folder | :page,
          name: String.t(),
          path: String.t(),
          title: String.t(),
          order: integer() | nil,
          children: [tree_node()]
        }

  @spec build(Path.t()) :: [tree_node()]
  def build(docs_root) when is_binary(docs_root) do
    if File.dir?(docs_root), do: build_dir(docs_root, ""), else: []
  end

  @spec page_paths(Path.t()) :: [String.t()]
  def page_paths(docs_root) when is_binary(docs_root) do
    if File.dir?(docs_root), do: docs_root |> walk("") |> Enum.sort(), else: []
  end

  defp walk(abs_dir, rel_dir) do
    abs_dir
    |> File.ls!()
    |> Enum.reject(&ignored?/1)
    |> Enum.flat_map(fn name ->
      abs = Path.join(abs_dir, name)
      rel = join_rel(rel_dir, name)

      cond do
        File.dir?(abs) -> walk(abs, rel)
        page?(name) -> [rel]
        true -> []
      end
    end)
  end

  defp build_dir(abs_dir, rel_dir) do
    abs_dir
    |> File.ls!()
    |> Enum.reject(&ignored?/1)
    |> Enum.map(&entry(abs_dir, rel_dir, &1))
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(&{&1.order || @no_order, String.downcase(&1.title)})
  end

  defp entry(abs_dir, rel_dir, name) do
    abs = Path.join(abs_dir, name)
    rel = join_rel(rel_dir, name)

    cond do
      File.dir?(abs) ->
        %{type: :folder, name: name, path: rel, title: humanize(name), order: nil, children: build_dir(abs, rel)}

      page?(name) ->
        page_node(abs, rel, name)

      true ->
        nil
    end
  end

  defp page_node(abs, rel, name) do
    {frontmatter, title} =
      with {:ok, content} <- File.read(abs),
           {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(name)) do
        {page.frontmatter, page.title}
      else
        _ -> {%{}, default_title(name)}
      end

    %{type: :page, name: name, path: rel, title: title, order: order(frontmatter), children: []}
  end

  defp ignored?(name), do: name in @ignored_dirs or String.starts_with?(name, ".")
  defp page?(name), do: String.ends_with?(name, ".md")
  defp join_rel("", name), do: name
  defp join_rel(rel_dir, name), do: rel_dir <> "/" <> name
  defp default_title(name), do: name |> String.replace_suffix(".md", "") |> humanize()
  defp humanize(name), do: name |> String.replace(["-", "_"], " ") |> String.trim()
  defp order(%{"order" => order}) when is_integer(order), do: order
  defp order(_), do: nil
end
