defmodule SymphonyElixir.AcceptanceCriteriaTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AcceptanceCriteria

  describe "parse/1" do
    test "reads checkboxes inside an Acceptance criteria markdown section" do
      body = """
      Some intro.

      ## Acceptance criteria
      - [ ] User can log in
      - [x] Errors are shown

      ## Notes
      - [ ] not a criterion
      """

      assert AcceptanceCriteria.parse(body) == [
               %{index: 1, text: "User can log in", checked: false},
               %{index: 2, text: "Errors are shown", checked: true}
             ]
    end

    test "supports a 'Critérios de aceite:' plain-label heading" do
      body = """
      Critérios de aceite:
      - [ ] Primeiro
      - [ ] Segundo
      """

      assert AcceptanceCriteria.parse(body) == [
               %{index: 1, text: "Primeiro", checked: false},
               %{index: 2, text: "Segundo", checked: false}
             ]
    end

    test "returns [] when there is no acceptance section" do
      body = """
      ## Plan
      - [ ] do work
      """

      assert AcceptanceCriteria.parse(body) == []
    end

    test "does not bleed into a sibling section without checkboxes" do
      body = """
      ### Acceptance Criteria
      - [ ] one

      ### Tasks
      - [ ] two
      """

      assert AcceptanceCriteria.parse(body) == [%{index: 1, text: "one", checked: false}]
    end
  end

  describe "apply_marks/2" do
    test "ticks a criterion by 1-based index, preserving the rest of the body" do
      body = "intro\n\n## Acceptance criteria\n- [ ] one\n- [ ] two\n\n## Plan\n- [ ] keep me\n"

      assert {:ok, result} = AcceptanceCriteria.apply_marks(body, [%{index: 1, checked: true}])

      assert result.body ==
               "intro\n\n## Acceptance criteria\n- [x] one\n- [ ] two\n\n## Plan\n- [ ] keep me\n"

      assert result.applied == 1
      assert result.unmatched == []
    end

    test "ticks by normalized text match" do
      body = "## Acceptance criteria\n- [ ] User can LOG IN\n"

      assert {:ok, result} =
               AcceptanceCriteria.apply_marks(body, [%{text: "user can log in", checked: true}])

      assert result.body == "## Acceptance criteria\n- [x] User can LOG IN\n"
      assert result.applied == 1
    end

    test "can uncheck a criterion" do
      body = "## Acceptance criteria\n- [x] done thing\n"

      assert {:ok, result} = AcceptanceCriteria.apply_marks(body, [%{index: 1, checked: false}])
      assert result.body == "## Acceptance criteria\n- [ ] done thing\n"
    end

    test "never touches checkboxes outside the acceptance section" do
      body = "## Plan\n- [ ] plan task\n\n## Acceptance criteria\n- [ ] real one\n"

      assert {:ok, result} = AcceptanceCriteria.apply_marks(body, [%{index: 1, checked: true}])
      assert result.body == "## Plan\n- [ ] plan task\n\n## Acceptance criteria\n- [x] real one\n"
    end

    test "reports unmatched marks without failing the matched ones" do
      body = "## Acceptance criteria\n- [ ] one\n"

      assert {:ok, result} =
               AcceptanceCriteria.apply_marks(body, [
                 %{index: 1, checked: true},
                 %{index: 9, checked: true}
               ])

      assert result.applied == 1
      assert result.unmatched == [%{index: 9, checked: true}]
    end

    test "returns :no_section when the body has no acceptance section" do
      assert AcceptanceCriteria.apply_marks("## Plan\n- [ ] x\n", [%{index: 1, checked: true}]) ==
               {:error, :no_section}
    end

    test "empty marks acts as a read and leaves the body unchanged" do
      body = "## Acceptance criteria\n- [ ] one\n"
      assert {:ok, result} = AcceptanceCriteria.apply_marks(body, [])
      assert result.body == body
      assert result.applied == 0
      assert result.criteria == [%{index: 1, text: "one", checked: false}]
    end

    test "preserves CRLF line endings" do
      body = "## Acceptance criteria\r\n- [ ] one\r\n"
      assert {:ok, result} = AcceptanceCriteria.apply_marks(body, [%{index: 1, checked: true}])
      assert result.body == "## Acceptance criteria\r\n- [x] one\r\n"
    end
  end
end
