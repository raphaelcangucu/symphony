defmodule Mix.Tasks.Symphony.ProjectTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureIO

  alias Mix.Tasks.Symphony.Project, as: Task
  alias SymphonyElixir.Repo

  setup do
    tmp = Path.join(System.tmp_dir!(), "symphony-project-mix-#{:erlang.unique_integer([:positive])}")
    db = Path.join(tmp, "tracker.sqlite3")
    yaml_path = Path.join(tmp, "gamba.yaml")
    export_path = Path.join(tmp, "exported.yaml")

    File.mkdir_p!(tmp)
    File.write!(db, "")

    Application.put_env(:symphony_elixir, SymphonyElixir.Repo, database: db)

    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    yaml = """
    kind: symphony_project
    version: 1
    slug: imported-cli
    name: Imported CLI
    description: From mix task
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
        workspace_path: api
        role: backend
    setup:
      workflow_markdown: |
        ---
        tracker:
          active_states: [Todo]
        ---

        Hello from CLI
      validation_commands:
        - mix test
    """

    File.write!(yaml_path, yaml)

    on_exit(fn ->
      Application.stop(:symphony_elixir)
      File.rm_rf(tmp)
    end)

    %{yaml_path: yaml_path, export_path: export_path}
  end

  test "import creates a project from YAML file", %{yaml_path: yaml_path} do
    Mix.Task.reenable("app.start")
    Mix.Task.reenable("symphony.project")

    output =
      capture_io(fn ->
        Task.run(["import", yaml_path])
      end)

    assert output =~ "✓  Imported project imported-cli"
  end

  test "export writes YAML bundle", %{yaml_path: yaml_path, export_path: export_path} do
    Mix.Task.reenable("app.start")
    Mix.Task.reenable("symphony.project")

    capture_io(fn -> Task.run(["import", yaml_path]) end)

    output =
      capture_io(fn ->
        Mix.Task.reenable("symphony.project")
        Task.run(["export", "imported-cli", "--output", export_path])
      end)

    assert output =~ "✓  Exported imported-cli"
    assert File.read!(export_path) =~ "symphony_project"
  end
end
