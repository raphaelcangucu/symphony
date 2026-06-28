defmodule SymphonyElixir.AcceptanceCriteria do
  @moduledoc """
  Safe, surgical editing of the *acceptance criteria* checklist embedded in an
  issue body.

  Only `- [ ]` / `- [x]` lines that live inside a recognized "Acceptance
  criteria" section are parsed or modified; every other byte of the body —
  including checkboxes in other sections such as a Plan or Tasks list — is
  preserved exactly. This gives the coding agent a constrained way to tick
  validated criteria without an `update_issue` rewriting the whole description.

  The section heading is matched against a small set of English/Portuguese
  synonyms (accent- and case-insensitive). When no acceptance section is found,
  nothing is touched and `apply_marks/2` returns `{:error, :no_section}`.
  """

  @checkbox_re ~r/^(\s*[-*+]\s+)\[([ xX])\]\s?(.*)$/
  @md_heading_re ~r/^\s{0,3}\#{1,6}\s+(.+?)\s*\#*\s*$/
  @bold_heading_re ~r/^\s*\*\*(.+?)\*\*\s*:?\s*$/
  @label_heading_re ~r/^\s*([^\s\-*+#].*?):\s*$/
  @checkbox_token_re ~r/\[[ xX]\]/

  @synonyms MapSet.new([
              "acceptance criteria",
              "acceptance criterion",
              "acceptance",
              "criterios de aceite",
              "criterio de aceite",
              "criterios de aceitacao",
              "criterio de aceitacao",
              "definition of done"
            ])

  @type criterion :: %{index: pos_integer(), text: String.t(), checked: boolean()}
  @type apply_result :: %{
          body: String.t(),
          criteria: [criterion()],
          applied: non_neg_integer(),
          unmatched: [map()]
        }

  @doc """
  Returns the acceptance criteria found in `body`, in document order, as
  `%{index, text, checked}` maps. Returns `[]` when there is no acceptance
  section (or `body` is not a string).
  """
  @spec parse(term()) :: [criterion()]
  def parse(body) when is_binary(body) do
    body
    |> internal_criteria()
    |> Enum.map(&Map.take(&1, [:index, :text, :checked]))
  end

  def parse(_), do: []

  @doc """
  Applies `marks` to the acceptance criteria in `body`.

  Each mark targets a criterion by `:index` (1-based, as returned by `parse/1`)
  or `:text` (normalized match). `:checked` defaults to `true`. Passing an empty
  list performs a read: the body is returned unchanged with the current
  criteria.

  Returns `{:ok, %{body, criteria, applied, unmatched}}` on success, where
  `unmatched` holds the original marks that did not match any criterion, or
  `{:error, :no_section}` when `body` has no acceptance section.
  """
  @spec apply_marks(term(), term()) :: {:ok, apply_result()} | {:error, :no_section}
  def apply_marks(body, marks) when is_binary(body) and is_list(marks) do
    lines = String.split(body, "\n")

    case section_range(lines) do
      :error ->
        {:error, :no_section}

      {start_idx, stop_idx} ->
        criteria = collect_criteria(lines, start_idx, stop_idx)
        do_apply(body, lines, criteria, marks)
    end
  end

  def apply_marks(_body, _marks), do: {:error, :no_section}

  defp do_apply(body, _lines, criteria, []) do
    {:ok, %{body: body, criteria: strip(criteria), applied: 0, unmatched: []}}
  end

  defp do_apply(_body, lines, criteria, marks) do
    pairs = Enum.map(marks, fn mark -> {mark, normalize_mark(mark)} end)

    {updates, unmatched} =
      Enum.reduce(pairs, {%{}, []}, fn {original, normalized}, {acc, missed} ->
        case find_criterion(criteria, normalized) do
          nil -> {acc, [original | missed]}
          %{line: line} -> {Map.put(acc, line, normalized.checked), missed}
        end
      end)

    new_body =
      lines
      |> Enum.with_index()
      |> Enum.map(fn {line, index} ->
        case Map.fetch(updates, index) do
          {:ok, checked} -> toggle_line(line, checked)
          :error -> line
        end
      end)
      |> Enum.join("\n")

    {:ok,
     %{
       body: new_body,
       criteria: parse(new_body),
       applied: map_size(updates),
       unmatched: Enum.reverse(unmatched)
     }}
  end

  defp internal_criteria(body) do
    lines = String.split(body, "\n")

    case section_range(lines) do
      :error -> []
      {start_idx, stop_idx} -> collect_criteria(lines, start_idx, stop_idx)
    end
  end

  # Returns the inclusive-start / exclusive-stop line indices that bound the
  # acceptance criteria section, or `:error` when there is no such section.
  defp section_range(lines) do
    headings =
      lines
      |> Enum.with_index()
      |> Enum.flat_map(fn {line, index} ->
        case heading_text(line) do
          nil -> []
          text -> [{index, normalize(text)}]
        end
      end)

    case Enum.find(headings, fn {_index, text} -> MapSet.member?(@synonyms, text) end) do
      nil ->
        :error

      {ac_index, _text} ->
        stop_index =
          headings
          |> Enum.map(fn {index, _text} -> index end)
          |> Enum.find(length(lines), fn index -> index > ac_index end)

        {ac_index + 1, stop_index}
    end
  end

  defp collect_criteria(lines, start_idx, stop_idx) do
    lines
    |> Enum.with_index()
    |> Enum.filter(fn {line, index} ->
      index >= start_idx and index < stop_idx and checkbox?(line)
    end)
    |> Enum.with_index(1)
    |> Enum.map(fn {{line, line_index}, index} ->
      [_, _prefix, state, text] = Regex.run(@checkbox_re, line)

      %{
        index: index,
        line: line_index,
        text: String.trim(text),
        checked: state in ["x", "X"]
      }
    end)
  end

  defp find_criterion(criteria, %{index: index}) when is_integer(index) do
    Enum.find(criteria, fn criterion -> criterion.index == index end)
  end

  defp find_criterion(criteria, %{text: text}) when is_binary(text) do
    target = normalize(text)

    Enum.find(criteria, fn criterion -> normalize(criterion.text) == target end) ||
      Enum.find(criteria, fn criterion ->
        normalized = normalize(criterion.text)
        target != "" and (String.contains?(normalized, target) or String.contains?(target, normalized))
      end)
  end

  defp find_criterion(_criteria, _mark), do: nil

  defp normalize_mark(mark) when is_map(mark) do
    %{
      index: mark_index(mark),
      text: mark_text(mark),
      checked: mark_checked(mark)
    }
    |> drop_nil_target()
  end

  defp normalize_mark(_mark), do: %{checked: true}

  # Index takes precedence over text when both are present, so the resulting map
  # exposes exactly one targeting key for `find_criterion/2`.
  defp drop_nil_target(%{index: index} = mark) when is_integer(index), do: Map.delete(mark, :text)
  defp drop_nil_target(mark), do: Map.delete(mark, :index)

  defp mark_index(mark) do
    case mark_get(mark, :index) do
      value when is_integer(value) ->
        value

      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {parsed, _rest} -> parsed
          :error -> nil
        end

      _ ->
        nil
    end
  end

  defp mark_text(mark) do
    case mark_get(mark, :text) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp mark_checked(mark) do
    case mark_get(mark, :checked) do
      nil -> true
      false -> false
      "false" -> false
      0 -> false
      _ -> true
    end
  end

  defp mark_get(mark, key) when is_map(mark) and is_atom(key) do
    Map.get(mark, key, Map.get(mark, Atom.to_string(key)))
  end

  defp toggle_line(line, checked) do
    token = if checked, do: "[x]", else: "[ ]"
    Regex.replace(@checkbox_token_re, line, token, global: false)
  end

  defp checkbox?(line), do: Regex.match?(@checkbox_re, line)

  defp heading_text(line) do
    cond do
      checkbox?(line) -> nil
      match = Regex.run(@md_heading_re, line) -> Enum.at(match, 1)
      match = Regex.run(@bold_heading_re, line) -> Enum.at(match, 1)
      match = Regex.run(@label_heading_re, line) -> Enum.at(match, 1)
      true -> nil
    end
  end

  defp normalize(text) do
    text
    |> deburr()
    |> String.downcase()
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
    |> String.trim_trailing(":")
    |> String.trim()
  end

  defp deburr(text) do
    text
    |> :unicode.characters_to_nfd_binary()
    |> String.replace(~r/[\x{0300}-\x{036F}]/u, "")
  end

  defp strip(criteria), do: Enum.map(criteria, &Map.take(&1, [:index, :text, :checked]))
end
