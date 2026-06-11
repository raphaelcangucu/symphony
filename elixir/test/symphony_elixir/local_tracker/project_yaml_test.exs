defmodule SymphonyElixir.LocalTracker.ProjectYamlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.ProjectYaml

  @yaml """
  kind: symphony_project
  version: 1
  slug: gamba
  name: Gamba
  description: Multi-repo workspace
  tracker:
    kind: local
    config: {}
  workflow_statuses:
    - name: Todo
      category: active
      position: 0
      is_terminal: false
  repositories:
    - github_full_name: g/api
      clone_url: https://github.com/g/api.git
      default_branch: main
      workspace_path: api
      role: backend
  setup:
    workflow_markdown: |
      ---
      tracker:
        active_states: [Todo]
      ---
      Prompt body
    validation_commands:
      - mix test
  """

  test "decode parses a project bundle" do
    assert {:ok, map} = ProjectYaml.decode(@yaml)
    assert map["slug"] == "gamba"
    assert map["setup"]["workflow_markdown"] =~ "Prompt body"
    assert [%{"github_full_name" => "g/api"}] = map["repositories"]
  end

  test "to_project_attrs maps bundle into workspace create attrs" do
    assert {:ok, map} = ProjectYaml.decode(@yaml)
    attrs = ProjectYaml.to_project_attrs(map)
    assert attrs["slug"] == "gamba"
    assert attrs["tracker"]["kind"] == "local"
    assert attrs["setup"]["workflow_markdown"] =~ "Prompt body"
  end

  test "invalid yaml returns error" do
    assert {:error, :invalid_yaml} = ProjectYaml.decode(":\n  - broken: [")
  end
end
