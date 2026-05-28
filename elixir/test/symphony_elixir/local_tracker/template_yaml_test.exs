defmodule SymphonyElixir.LocalTracker.TemplateYamlTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Templates
  alias SymphonyElixir.LocalTracker.TemplateYaml
  alias SymphonyElixir.LocalTracker.WorkspaceTemplate
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    Repo.query!("delete from local_tracker_workspace_template_repositories")
    Repo.query!("delete from local_tracker_workspace_templates")
    :ok
  end

  @yaml """
  slug: gamba
  name: Gamba
  description: Multi-repo
  validation_commands:
    - mix test
  after_create_hook: |
    echo hi
  repositories:
    - github_full_name: g/api
      clone_url: https://github.com/g/api.git
      default_branch: main
      workspace_path: api
      role: backend
  metadata:
    source: imported
  """

  test "import_yaml creates a template" do
    assert {:ok, template} = Templates.import_yaml(@yaml)
    assert template.slug == "gamba"
    assert [%{github_full_name: "g/api"}] = template.repositories
  end

  test "export_yaml round-trips" do
    {:ok, _} = Templates.import_yaml(@yaml)
    assert {:ok, exported} = Templates.export_yaml("gamba")

    Repo.query!("delete from local_tracker_workspace_template_repositories")
    Repo.query!("delete from local_tracker_workspace_templates")

    assert {:ok, reimported} = Templates.import_yaml(exported)
    assert reimported.slug == "gamba"
    assert [%{workspace_path: "api"}] = reimported.repositories
  end

  test "invalid yaml returns error" do
    assert {:error, :invalid_yaml} = Templates.import_yaml(":\n  - broken: [")
  end

  test "decode returns error when document is not a map" do
    assert {:error, :invalid_yaml} = TemplateYaml.decode("[1, 2, 3]")
  end

  test "encode emits boolean, number, and null scalars and round-trips them" do
    template = %WorkspaceTemplate{
      slug: "scalars",
      name: "Scalars",
      description: nil,
      validation_commands: %{},
      workflow_statuses: %{},
      after_create_hook: nil,
      prompt_template: nil,
      dev_env_markdown: nil,
      metadata: %{
        "enabled" => true,
        "count" => 3,
        "ratio" => 1.5,
        "missing" => nil,
        "kind" => :special,
        "nested" => %{"deep" => "value"},
        "items" => ["one", %{"k" => "v"}]
      },
      repositories: []
    }

    yaml = TemplateYaml.encode(template)

    assert yaml =~ "enabled: true"
    assert yaml =~ "count: 3"
    assert yaml =~ "ratio: 1.5"
    assert yaml =~ "missing: null"
    assert yaml =~ ~s(kind: "special")

    assert {:ok, decoded} = TemplateYaml.decode(yaml)
    assert decoded["metadata"]["enabled"] == true
    assert decoded["metadata"]["count"] == 3
    assert decoded["metadata"]["ratio"] == 1.5
    assert decoded["metadata"]["missing"] == nil
    assert decoded["metadata"]["kind"] == "special"
    assert decoded["metadata"]["nested"] == %{"deep" => "value"}
    assert decoded["metadata"]["items"] == ["one", %{"k" => "v"}]
  end

  test "encode escapes backslashes so they survive a round-trip" do
    template = %WorkspaceTemplate{
      slug: "backslash",
      name: "Backslash",
      validation_commands: %{},
      workflow_statuses: %{},
      metadata: %{"path" => "C:\\work\\api", "regex" => "ends-with-backslash\\"},
      repositories: []
    }

    yaml = TemplateYaml.encode(template)

    assert {:ok, decoded} = TemplateYaml.decode(yaml)
    assert decoded["metadata"]["path"] == "C:\\work\\api"
    assert decoded["metadata"]["regex"] == "ends-with-backslash\\"
  end

  test "export_yaml round-trips all hook fields" do
    {:ok, template} = Templates.import_yaml(@yaml)

    {:ok, updated} =
      Templates.update_template(template.slug, %{
        "before_run_hook" => "echo before-run",
        "after_run_hook" => "echo after-run",
        "before_remove_hook" => "echo before-remove"
      })

    assert updated.before_run_hook == "echo before-run"

    assert {:ok, exported} = Templates.export_yaml("gamba")

    Repo.query!("delete from local_tracker_workspace_template_repositories")
    Repo.query!("delete from local_tracker_workspace_templates")

    assert {:ok, reimported} = Templates.import_yaml(exported)
    assert reimported.before_run_hook == "echo before-run"
    assert reimported.after_run_hook == "echo after-run"
    assert reimported.before_remove_hook == "echo before-remove"
  end
end
