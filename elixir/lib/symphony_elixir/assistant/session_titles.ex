defmodule SymphonyElixir.Assistant.SessionTitles do
  @moduledoc """
  Canonical initial session titles by thread scope.

  Grammar: `{Type} · {Context}` with separator `" · "`. Truncated to the
  sidebar title max (160 graphemes) at write time.
  """

  @separator " · "
  @max_graphemes 160

  @type scope :: String.t()
  @type opts :: keyword()

  @spec default_title(scope(), opts()) :: String.t()
  def default_title(scope, opts \\ []) when is_binary(scope) and is_list(opts) do
    scope
    |> build_parts(opts)
    |> Enum.reject(&blank?/1)
    |> Enum.join(@separator)
    |> truncate_graphemes(@max_graphemes)
  end

  defp build_parts("issue_session", opts), do: ["Chat" | issue_context(opts)]
  defp build_parts("issue_execution", opts), do: ["Run" | issue_context(opts)]
  defp build_parts("issue", opts), do: build_parts("issue_session", opts)

  defp build_parts("project_session", opts), do: ["Workspace", workspace_name(opts)]
  defp build_parts("workspace_session", opts), do: ["Workspace", workspace_name(opts)]

  defp build_parts("project_explore", opts), do: ["Explore", project_name(opts)]

  defp build_parts("freeform", _opts), do: ["Chat"]

  defp build_parts("kb", opts), do: ["KB", page_title(opts)]

  defp build_parts(_scope, _opts), do: ["Chat"]

  defp issue_context(opts) do
    identifier = opt_string(opts, :identifier)
    issue_title = opt_string(opts, :issue_title)

    [identifier, issue_title]
  end

  defp workspace_name(opts) do
    case opt_string(opts, :workspace_name) do
      nil -> path_basename(opts)
      name -> name
    end
  end

  defp project_name(opts) do
    opt_string(opts, :project_name) || opt_string(opts, :project_slug)
  end

  defp page_title(opts) do
    case opt_string(opts, :page_title) do
      nil -> path_basename(opts)
      title -> title
    end
  end

  defp path_basename(opts) do
    case opt_string(opts, :workspace_path) || opt_string(opts, :path) do
      nil -> nil
      path -> Path.basename(path)
    end
  end

  defp opt_string(opts, key) do
    case Keyword.get(opts, key) do
      value when is_binary(value) ->
        trimmed = String.trim(value)
        if trimmed == "", do: nil, else: trimmed

      _other ->
        nil
    end
  end

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(_value), do: false

  defp truncate_graphemes(text, max) when is_binary(text) and is_integer(max) and max > 0 do
    graphemes = String.graphemes(text)

    if length(graphemes) <= max do
      text
    else
      graphemes |> Enum.take(max) |> Enum.join()
    end
  end
end
