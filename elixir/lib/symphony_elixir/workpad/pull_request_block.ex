defmodule SymphonyElixir.Workpad.PullRequestBlock do
  @moduledoc """
  Renders and parses the machine-readable `symphony:prs` block embedded in an
  issue's `## Codex Workpad` comment. The block is an HTML comment (invisible in
  rendered markdown) carrying the issue's associated PRs so discovery can parse
  them deterministically.
  """

  @begin_marker "<!-- symphony:prs"
  @end_marker "-->"
  @block_regex ~r/<!--\s*symphony:prs\b.*?-->/s

  @type pr_ref :: %{
          repo: String.t() | nil,
          number: integer() | nil,
          branch: String.t() | nil,
          url: String.t() | nil
        }

  @spec render([map()]) :: String.t()
  def render(prs) when is_list(prs) do
    body = prs |> Enum.map(&render_one/1) |> Enum.join("\n")
    @begin_marker <> "\n" <> body <> "\n" <> @end_marker
  end

  @spec parse(String.t() | nil) :: [pr_ref()]
  def parse(body) when is_binary(body) do
    case Regex.run(@block_regex, body) do
      [block] -> parse_block(block)
      _ -> []
    end
  end

  def parse(_body), do: []

  @spec upsert_block(String.t() | nil, [map()]) :: String.t()
  def upsert_block(body, prs) when is_binary(body) and is_list(prs) do
    rendered = render(prs)

    if Regex.match?(@block_regex, body) do
      Regex.replace(@block_regex, body, fn _ -> rendered end)
    else
      String.trim_trailing(body) <> "\n\n" <> rendered <> "\n"
    end
  end

  def upsert_block(nil, prs) when is_list(prs) do
    "## Codex Workpad\n\n" <> render(prs) <> "\n"
  end

  defp render_one(pr) do
    [
      "- repo: #{field(pr, :repo)}",
      "  number: #{field(pr, :number)}",
      "  branch: #{field(pr, :branch) || field(pr, :head_ref)}",
      "  url: #{field(pr, :url)}"
    ]
    |> Enum.join("\n")
  end

  defp parse_block(block) do
    block
    |> String.split("\n")
    |> Enum.reduce({[], nil}, fn line, {items, current} ->
      cond do
        Regex.match?(~r/^\s*-\s+/, line) ->
          items = if current, do: [current | items], else: items
          {items, parse_kv(strip_dash(line), %{})}

        current != nil ->
          {items, parse_kv(line, current)}

        true ->
          {items, current}
      end
    end)
    |> close_items()
    |> Enum.map(&to_ref/1)
    |> Enum.reject(&(is_nil(&1.url) and is_nil(&1.repo)))
    |> Enum.reverse()
  end

  defp close_items({items, nil}), do: items
  defp close_items({items, current}), do: [current | items]

  defp parse_kv(line, acc) do
    case Regex.run(~r/^\s*(repo|number|branch|url)\s*:\s*(.*?)\s*$/, line) do
      [_, key, value] -> Map.put(acc, key, blank_to_nil(value))
      _ -> acc
    end
  end

  defp strip_dash(line), do: Regex.replace(~r/^\s*-\s+/, line, "")

  defp to_ref(fields) do
    %{
      repo: fields["repo"],
      number: to_int(fields["number"]),
      branch: fields["branch"],
      url: fields["url"]
    }
  end

  defp field(map, key), do: Map.get(map, key) || Map.get(map, to_string(key))

  defp blank_to_nil(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp to_int(nil), do: nil

  defp to_int(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> nil
    end
  end
end
