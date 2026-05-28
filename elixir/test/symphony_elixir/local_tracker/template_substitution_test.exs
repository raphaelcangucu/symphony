defmodule SymphonyElixir.LocalTracker.TemplateSubstitutionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.TemplateSubstitution

  @vars %{slug: "gamba", name: "Gamba", workspace_root: "/root"}

  test "substitutes known tokens" do
    assert TemplateSubstitution.apply("{{workspace_root}}/{{slug}}/api", @vars) == "/root/gamba/api"
  end

  test "tolerates whitespace inside braces" do
    assert TemplateSubstitution.apply("{{ slug }}-x", @vars) == "gamba-x"
  end

  test "leaves unknown tokens literal" do
    assert TemplateSubstitution.apply("{{date}}", @vars) == "{{date}}"
  end

  test "nil input returns nil" do
    assert TemplateSubstitution.apply(nil, @vars) == nil
  end
end
