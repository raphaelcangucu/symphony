defmodule SymphonyElixir.Assistant.UserQuestionNormalizerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.UserQuestionNormalizer

  @claude_questions [
    %{
      "header" => "Alvo do teste",
      "multiSelect" => false,
      "question" => "Qual objetivo priorizar?",
      "options" => [
        %{"label" => "Validar o que a 510 entrega", "description" => "Pest"},
        %{"label" => "Demo visual", "description" => "Playwright"}
      ]
    }
  ]

  test "to_ui_questions adds stable ids and Codex fields" do
    [q] = UserQuestionNormalizer.to_ui_questions(@claude_questions)
    assert q["id"] == "q0"
    assert q["header"] == "Alvo do teste"
    assert q["question"] == "Qual objetivo priorizar?"
    assert q["isOther"] == false
    assert q["isSecret"] == false
    assert length(q["options"]) == 2
  end

  test "to_claude_answers maps qid answers back to question text keys" do
    ui = UserQuestionNormalizer.to_ui_questions(@claude_questions)

    codex_answers = %{
      "q0" => %{"answers" => ["Validar o que a 510 entrega"]}
    }

    assert UserQuestionNormalizer.to_claude_answers(ui, @claude_questions, codex_answers) ==
             %{"Qual objetivo priorizar?" => "Validar o que a 510 entrega"}
  end
end
