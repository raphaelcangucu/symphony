defmodule SymphonyElixir.KnowledgeBase.MarkdownPage do
  @moduledoc "Parses knowledge base Markdown documents (YAML frontmatter + body)."

  defstruct frontmatter: %{}, body: "", title: ""

  @type t :: %__MODULE__{frontmatter: map(), body: String.t(), title: String.t()}

  @frontmatter_regex ~r/\A---\r?\n(?<yaml>.*?)\r?\n?---\r?\n(?<body>.*)\z/s
  @h1_regex ~r/^#\s+(.+?)\s*$/

  @spec parse(String.t(), keyword()) :: {:ok, t()} | {:error, :kb_frontmatter_invalid}
  def parse(content, opts \\ []) when is_binary(content) do
    default_title = Keyword.get(opts, :default_title, "")

    case Regex.named_captures(@frontmatter_regex, content) do
      %{"yaml" => yaml, "body" => body} ->
        parse_frontmatter(yaml, body, default_title)

      nil ->
        {:ok, build(%{}, content, default_title)}
    end
  end

  defp parse_frontmatter(yaml, body, default_title) do
    if String.trim(yaml) == "" do
      {:ok, build(%{}, body, default_title)}
    else
      case YamlElixir.read_from_string(yaml) do
        {:ok, map} when is_map(map) -> {:ok, build(map, body, default_title)}
        {:ok, nil} -> {:ok, build(%{}, body, default_title)}
        {:ok, _non_map} -> {:error, :kb_frontmatter_invalid}
        {:error, _reason} -> {:error, :kb_frontmatter_invalid}
      end
    end
  end

  defp build(frontmatter, body, default_title) do
    %__MODULE__{
      frontmatter: frontmatter,
      body: body,
      title: resolve_title(frontmatter, body, default_title)
    }
  end

  defp resolve_title(frontmatter, body, default_title) do
    cond do
      is_binary(frontmatter["title"]) and String.trim(frontmatter["title"]) != "" ->
        String.trim(frontmatter["title"])

      title = first_h1(body) ->
        title

      true ->
        default_title
    end
  end

  defp first_h1(body) do
    body
    |> String.split("\n")
    |> Enum.find_value(fn line ->
      case Regex.run(@h1_regex, line) do
        [_, title] -> String.trim(title)
        _ -> nil
      end
    end)
  end
end
