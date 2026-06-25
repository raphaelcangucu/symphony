defmodule SymphonyElixir.EventHumanizerCoverageTest do
  use ExUnit.Case, async: true

  @po_dir Path.expand("../../priv/gettext", __DIR__)
  @lib_dir Path.expand("../../lib", __DIR__)

  @passthrough_pt_msgids MapSet.new([
    " (%{details})",
    "%{base} (%{tool})",
    "%{event} (%{msg_type})",
    "%{method} (%{msg_type})",
    "item %{state}: %{type}%{suffix}",
    "ok",
    "total"
  ])

  test "events.po covers every EventHumanizer.Text msgid used in lib" do
    code_msgids = collect_code_msgids()
    en = parse_po(Path.join(@po_dir, "en/LC_MESSAGES/events.po"))
    pt = parse_po(Path.join(@po_dir, "pt_BR/LC_MESSAGES/events.po"))

    missing_en = MapSet.difference(code_msgids, MapSet.new(Map.keys(en)))
    missing_pt = MapSet.difference(MapSet.new(Map.keys(en)), MapSet.new(Map.keys(pt)))

    assert missing_en == MapSet.new(), "missing en events.po entries: #{inspect(MapSet.to_list(missing_en))}"
    assert missing_pt == MapSet.new(), "missing pt_BR events.po entries: #{inspect(MapSet.to_list(missing_pt))}"

    untranslated =
      en
      |> Map.keys()
      |> Enum.reject(&MapSet.member?(@passthrough_pt_msgids, &1))
      |> Enum.filter(fn msgid -> Map.fetch!(pt, msgid) == msgid end)

    assert untranslated == [],
           "pt_BR events.po still mirrors English for: #{inspect(untranslated)}"
  end

  defp collect_code_msgids do
    pattern = ~r/(?:T|EventText)\.t\(\s*"((?:[^"\\]|\\.)*)"/

    @lib_dir
    |> Path.join("**/*.ex")
    |> Path.wildcard()
    |> Enum.flat_map(fn path ->
      path
      |> File.read!()
      |> then(&Regex.scan(pattern, &1, capture: :all_but_first))
      |> Enum.map(fn [literal] -> decode_elixir_string(literal) end)
    end)
    |> MapSet.new()
  end

  defp decode_elixir_string(literal) do
    "\"#{literal}\""
    |> Code.eval_string()
    |> elem(0)
  end

  defp parse_po(path) do
    path
    |> File.read!()
    |> parse_po_entries()
  end

  defp parse_po_entries(content) do
    content
    |> String.split(~r/\n\n+/)
    |> Enum.reduce(%{}, fn block, acc ->
      case parse_po_block(block) do
        {msgid, msgstr} when is_binary(msgid) and msgid != "" ->
          Map.put(acc, msgid, msgstr)

        _ ->
          acc
      end
    end)
  end

  defp parse_po_block(block) do
    {msgid, msgstr} =
      block
      |> String.split("\n")
      |> Enum.reduce({[], [], nil}, &accumulate_po_line/2)
      |> then(fn {id_lines, str_lines, _} -> {IO.iodata_to_binary(id_lines), IO.iodata_to_binary(str_lines)} end)

    {msgid, msgstr}
  end

  defp accumulate_po_line("msgid " <> rest, {_, _, _}) do
    {po_unquote(rest), [], :id}
  end

  defp accumulate_po_line("msgstr " <> rest, {id_lines, _, _}) do
    {id_lines, po_unquote(rest), :str}
  end

  defp accumulate_po_line("\"" <> _ = line, {id_lines, str_lines, :id}) do
    {id_lines <> po_unquote(line), str_lines, :id}
  end

  defp accumulate_po_line("\"" <> _ = line, {id_lines, str_lines, :str}) do
    {id_lines, str_lines <> po_unquote(line), :str}
  end

  defp accumulate_po_line(_line, state), do: state

  defp po_unquote("\"\"\n"), do: ""
  defp po_unquote("\"\"\r\n"), do: ""

  defp po_unquote(line) do
    line
    |> String.trim()
    |> then(fn
      "\"" <> inner ->
        inner
        |> String.trim_trailing("\"")
        |> String.replace("\\n", "\n")
        |> String.replace("\\\"", "\"")

      _ ->
        ""
    end)
  end
end
