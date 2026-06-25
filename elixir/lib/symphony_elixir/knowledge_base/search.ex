defmodule SymphonyElixir.KnowledgeBase.Search do
  @moduledoc """
  Full-text search over the derived `kb_pages` FTS5 index.

  Searches title + body, ranks by `bm25`, and returns a snippet excerpt.
  User input is converted into a safe FTS5 MATCH expression so reserved
  characters cannot break the query or inject operators.
  """

  alias SymphonyElixir.Repo

  @min_query_length 2
  @default_limit 25
  @max_limit 50

  @type result :: %{
          project_slug: String.t(),
          repo_slug: String.t(),
          path: String.t(),
          title: String.t(),
          snippet: String.t(),
          rank: float()
        }

  @spec search_project(String.t(), String.t(), keyword()) :: {:ok, [result()]} | {:error, term()}
  def search_project(project_slug, query, opts \\ []) do
    run(["p.project_slug = ?"], [project_slug], query, opts)
  end

  @spec search_global(String.t(), String.t(), keyword()) :: {:ok, [result()]} | {:error, term()}
  def search_global(user_scope, query, opts \\ []) do
    run(["p.project_slug = ?"], [user_scope], query, opts)
  end

  defp run(base_clauses, base_params, query, opts) do
    case build_match(query) do
      :too_short ->
        {:ok, []}

      {:ok, match} ->
        {clauses, params} = apply_repo_filter(base_clauses, base_params, opts)
        limit = opts |> Keyword.get(:limit, @default_limit) |> min(@max_limit) |> max(1)
        where_sql = Enum.join(["p.archived = 0", "kb_pages_fts MATCH ?" | clauses], " AND ")

        sql = """
        SELECT p.project_slug, p.repo_slug, p.path, p.title,
               snippet(kb_pages_fts, 1, '[', ']', ' ... ', 12) AS snippet,
               bm25(kb_pages_fts) AS rank
        FROM kb_pages_fts
        JOIN kb_pages p ON p.id = kb_pages_fts.rowid
        WHERE #{where_sql}
        ORDER BY rank ASC
        LIMIT ?
        """

        case Repo.query(sql, [match | params] ++ [limit]) do
          {:ok, %{rows: rows, columns: cols}} -> {:ok, Enum.map(rows, &row_to_result(cols, &1))}
          {:error, reason} -> {:error, {:kb_search_failed, reason}}
        end
    end
  end

  defp apply_repo_filter(clauses, params, opts) do
    case Keyword.get(opts, :repo_slug) do
      slug when is_binary(slug) and slug != "" -> {clauses ++ ["p.repo_slug = ?"], params ++ [slug]}
      _ -> {clauses, params}
    end
  end

  # Turn arbitrary user text into a safe FTS5 MATCH: split on whitespace,
  # double-quote each token (escaping embedded quotes), prefix-match the last
  # token for incremental search.
  defp build_match(query) do
    trimmed = query |> to_string() |> String.trim()

    if String.length(trimmed) < @min_query_length do
      :too_short
    else
      tokens = trimmed |> String.split(~r/\s+/, trim: true) |> Enum.map(&quote_token/1)

      case tokens do
        [] -> :too_short
        _ -> {:ok, prefixize_last(tokens)}
      end
    end
  end

  defp quote_token(token), do: "\"" <> String.replace(token, "\"", "\"\"") <> "\""

  defp prefixize_last(tokens) do
    {init, [last]} = Enum.split(tokens, length(tokens) - 1)
    Enum.join(init ++ [last <> " *"], " ")
  end

  defp row_to_result(cols, row) do
    map = cols |> Enum.zip(row) |> Map.new()

    %{
      project_slug: map["project_slug"],
      repo_slug: map["repo_slug"],
      path: map["path"],
      title: map["title"],
      snippet: map["snippet"] || "",
      rank: map["rank"] * 1.0
    }
  end
end
