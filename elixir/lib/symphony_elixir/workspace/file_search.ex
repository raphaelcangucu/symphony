defmodule SymphonyElixir.Workspace.FileSearch do
  @moduledoc """
  Read-only, sandboxed file search within a single issue workspace tree.

  Powers the execution composer's `@file:` mentions. Walks `root` (the issue's
  checkout), returning relative paths whose path matches `query` (case-insensitive
  substring). Hard safety guards: symlinks are never followed, build/vendor dirs are
  skipped, path-traversal queries are rejected, and a missing root yields `[]`
  instead of raising — results can never escape `root`.
  """

  @default_limit 50
  @denylist MapSet.new([".git", "node_modules", "_build", "deps", ".elixir_ls", "tmp", ".symphony"])

  @spec search(Path.t() | nil, String.t(), keyword()) :: [String.t()]
  def search(root, query, opts \\ [])

  def search(root, query, opts) when is_binary(root) and is_binary(query) and is_list(opts) do
    limit = positive_limit(Keyword.get(opts, :limit, @default_limit))
    normalized = query |> String.trim() |> String.downcase()

    cond do
      normalized == "" -> []
      String.contains?(normalized, "..") -> []
      not File.dir?(root) -> []
      true -> matching_paths(root, normalized, limit)
    end
  end

  def search(_root, _query, _opts), do: []

  defp matching_paths(root, normalized, limit) do
    root
    |> collect_relative_files()
    |> Enum.filter(fn rel -> String.contains?(String.downcase(rel), normalized) end)
    |> Enum.sort()
    |> Enum.take(limit)
  end

  defp collect_relative_files(root) do
    root
    |> walk()
    |> Enum.map(fn absolute -> relative_to(root, absolute) end)
  end

  defp walk(dir) do
    case File.ls(dir) do
      {:ok, entries} -> Enum.flat_map(entries, fn entry -> walk_entry(dir, entry) end)
      {:error, _reason} -> []
    end
  end

  defp walk_entry(dir, entry) do
    path = Path.join(dir, entry)

    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} -> []
      {:ok, %File.Stat{type: :directory}} -> walk_directory(entry, path)
      {:ok, %File.Stat{type: :regular}} -> [path]
      _ -> []
    end
  end

  defp walk_directory(entry, path) do
    if MapSet.member?(@denylist, entry), do: [], else: walk(path)
  end

  defp relative_to(root, absolute) do
    absolute
    |> Path.relative_to(root)
    |> String.replace_leading("./", "")
  end

  defp positive_limit(value) when is_integer(value) and value > 0, do: value
  defp positive_limit(_value), do: @default_limit
end
