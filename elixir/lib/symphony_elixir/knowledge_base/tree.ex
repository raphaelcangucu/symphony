defmodule SymphonyElixir.KnowledgeBase.Tree do
  @moduledoc "Builds a repository-scoped page tree by walking a `docs/` directory."

  alias SymphonyElixir.KnowledgeBase.MarkdownPage

  @ignored_dot_dirs [".git"]
  @asset_extensions MapSet.new([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"])
  @no_order 1_000_000

  @type tree_node :: %{
          type: :folder | :page | :asset,
          name: String.t(),
          path: String.t(),
          title: String.t(),
          order: integer() | nil,
          favorite: boolean(),
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

  @spec build_from_paths(Path.t(), [String.t()]) :: [tree_node()]
  def build_from_paths(docs_root, paths) when is_binary(docs_root) and is_list(paths) do
    full_tree = build(docs_root)
    wanted = MapSet.new(paths)
    filter_tree(full_tree, wanted)
  end

  defp walk(abs_dir, rel_dir) do
    abs_dir
    |> File.ls!()
    |> Enum.reject(&ignored_for_walk?/1)
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
    |> Enum.reject(&ignored_for_tree?/1)
    |> Enum.map(&entry(abs_dir, rel_dir, &1))
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(&{&1.order || @no_order, String.downcase(&1.title)})
  end

  defp filter_tree(nodes, wanted) do
    nodes
    |> Enum.flat_map(fn
      %{type: :folder, children: children} = node ->
        case filter_tree(children, wanted) do
          [] -> []
          kept -> [%{node | children: kept}]
        end

      %{path: path} = node ->
        if MapSet.member?(wanted, path), do: [node], else: []
    end)
  end

  defp entry(abs_dir, rel_dir, name) do
    abs = Path.join(abs_dir, name)
    rel = join_rel(rel_dir, name)

    cond do
      File.dir?(abs) ->
        %{
          type: :folder,
          name: name,
          path: rel,
          title: humanize(name),
          order: nil,
          favorite: false,
          children: build_dir(abs, rel)
        }

      page?(name) ->
        page_node(abs, rel, name)

      asset?(name) ->
        asset_node(rel, name)

      true ->
        nil
    end
  end

  defp asset_node(rel, name) do
    %{
      type: :asset,
      name: name,
      path: rel,
      title: asset_title(name),
      order: nil,
      favorite: false,
      children: []
    }
  end

  defp page_node(abs, rel, name) do
    {frontmatter, title} =
      with {:ok, content} <- File.read(abs),
           {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(name)) do
        {page.frontmatter, page.title}
      else
        _ -> {%{}, default_title(name)}
      end

    %{
      type: :page,
      name: name,
      path: rel,
      title: title,
      order: order(frontmatter),
      favorite: favorite?(frontmatter),
      children: []
    }
  end

  defp ignored_for_walk?(name), do: name == "assets" or dot_ignored?(name)
  defp ignored_for_tree?(name), do: dot_ignored?(name)
  defp dot_ignored?(name), do: name in @ignored_dot_dirs or String.starts_with?(name, ".")
  defp page?(name), do: String.ends_with?(name, ".md")

  defp asset?(name) do
    name
    |> Path.extname()
    |> String.downcase()
    |> then(&(&1 in @asset_extensions))
  end

  defp join_rel("", name), do: name
  defp join_rel(rel_dir, name), do: rel_dir <> "/" <> name
  defp default_title(name), do: name |> String.replace_suffix(".md", "") |> humanize()
  defp asset_title(name), do: name |> Path.rootname() |> humanize()
  defp humanize(name), do: name |> String.replace(["-", "_"], " ") |> String.trim()
  defp order(%{"order" => order}) when is_integer(order), do: order
  defp order(_), do: nil

  defp favorite?(%{"favorite" => true}), do: true
  defp favorite?(_), do: false
end
