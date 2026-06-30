defmodule SymphonyElixir.PromptTemplates.BuiltinTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PromptTemplates.Builtin

  @required_slugs ~w(
    investigate-issue
    code-review
    commit-message
    pr-description
    release-notes
    resolve-conflicts
  )

  test "all/0 returns required built-in templates" do
    templates = Builtin.all()
    slugs = Enum.map(templates, &Map.fetch!(&1, :slug))

    Enum.each(@required_slugs, fn slug ->
      assert slug in slugs
    end)
  end

  test "templates include required fields and built_in defaults" do
    Enum.each(Builtin.all(), fn template ->
      assert is_binary(Map.get(template, :slug))
      assert is_binary(Map.get(template, :name))
      assert is_binary(Map.get(template, :category))
      assert is_binary(Map.get(template, :body))
      assert Map.get(template, :scope) == "global"
      assert Map.get(template, :built_in) == true
      assert Map.get(template, :enabled) == true
    end)
  end

  test "code-review template uses high effort" do
    code_review =
      Builtin.all()
      |> Enum.find(&(Map.get(&1, :slug) == "code-review"))

    assert code_review
    assert Map.get(code_review, :effort) == "high"
  end

  test "every built-in body parses with Solid" do
    Enum.each(Builtin.all(), fn template ->
      assert template
             |> Map.fetch!(:body)
             |> Solid.parse!()
    end)
  end
end
