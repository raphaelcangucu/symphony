defmodule SymphonyElixir.Assistant.UserQuestionNormalizer do
  @moduledoc """
  Maps Claude Code `AskUserQuestion` tool_input into the Codex-shaped questions
  array consumed by `UserQuestionsCard`, and maps Codex-shaped answers back into
  the Claude PreToolUse `updatedInput.answers` map (question text → label).
  """

  @spec to_ui_questions(list()) :: [map()]
  def to_ui_questions(questions) when is_list(questions) do
    questions
    |> Enum.with_index()
    |> Enum.map(fn {question, index} -> normalize_one(question, index) end)
  end

  def to_ui_questions(_), do: []

  @spec to_claude_answers([map()], list(), map()) :: %{String.t() => String.t()}
  def to_claude_answers(ui_questions, _claude_questions, codex_answers)
      when is_list(ui_questions) and is_map(codex_answers) do
    Enum.reduce(ui_questions, %{}, fn ui_q, acc ->
      id = Map.get(ui_q, "id")
      question_text = Map.get(ui_q, "question")

      case Map.get(codex_answers, id) do
        %{"answers" => [value | _]} when is_binary(question_text) and is_binary(value) ->
          Map.put(acc, question_text, value)

        value when is_binary(question_text) and is_binary(value) ->
          Map.put(acc, question_text, value)

        _ ->
          acc
      end
    end)
  end

  def to_claude_answers(_, _, _), do: %{}

  defp normalize_one(question, index) when is_map(question) do
    options =
      case Map.get(question, "options") do
        list when is_list(list) -> Enum.map(list, &normalize_option/1)
        _ -> nil
      end

    %{
      "id" => "q#{index}",
      "header" => Map.get(question, "header") || "",
      "question" => Map.get(question, "question") || "",
      "isOther" => Map.get(question, "isOther") == true,
      "isSecret" => Map.get(question, "isSecret") == true,
      "options" => options
    }
  end

  defp normalize_one(_question, index) do
    %{
      "id" => "q#{index}",
      "header" => "",
      "question" => "",
      "isOther" => false,
      "isSecret" => false,
      "options" => nil
    }
  end

  defp normalize_option(%{"label" => label} = opt) when is_binary(label) do
    %{
      "label" => label,
      "description" => Map.get(opt, "description")
    }
  end

  defp normalize_option(other), do: other
end
