defmodule SymphonyElixir.LocalTracker.DevEnv.ConventionReaderTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ConventionReader, ProposedStep}
  alias SymphonyElixirWeb.DevEnvPresenter

  setup do
    root = Path.join(System.tmp_dir!(), "devenv-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, ".symphony"))
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "reads yaml convention", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), """
    steps:
      - description: Install deps
        command: mix deps.get
        working_dir: api
      - description: Migrate
        command: mix ecto.migrate
    """)

    assert {:ok, steps} = ConventionReader.read(root)
    assert [%ProposedStep{description: "Install deps", command: "mix deps.get", working_dir: "api", source: "convention"} | _] = steps
    assert length(steps) == 2
  end

  test "reads yaml serve fields", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), """
    steps:
      - description: Front dev server
        command: symphony-preview-runner
        stop_command: npm run stop
        working_dir: front
        role: serve
        port_env: PORT
        url_path: /tracker/
        ready: http
        ready_path: /tracker/
        primary: true
        run_spec:
          cwd: front
          prepare:
            - [npm, ci]
          start:
            - [npm, run, dev, "--", "--port", "${PORT}"]
          health:
            path: /tracker/
            timeout_ms: 60000
          stop:
            signal: TERM
            grace_ms: 5000
    """)

    assert {:ok, [step]} = ConventionReader.read(root)
    assert step.role == "serve"
    assert step.port_env == "PORT"
    assert step.url_path == "/tracker/"
    assert step.ready_probe == "http"
    assert step.ready_path == "/tracker/"
    assert step.primary == true
    assert step.stop_command == "npm run stop"

    assert step.run_spec == %{
             "cwd" => "front",
             "prepare" => [["npm", "ci"]],
             "start" => [["npm", "run", "dev", "--", "--port", "${PORT}"]],
             "health" => %{"path" => "/tracker/", "timeout_ms" => 60_000},
             "stop" => %{"signal" => "TERM", "grace_ms" => 5_000}
           }

    proposed_dto = DevEnvPresenter.proposed(step)
    assert proposed_dto.stop_command == "npm run stop"
    assert proposed_dto.run_spec == step.run_spec
  end

  test "reads markdown convention fenced bash", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.md"), """
    # Setup

    Install dependencies:

    ```bash
    mix deps.get
    ```

    Run migrations:

    ```bash
    mix ecto.migrate
    ```
    """)

    assert {:ok, steps} = ConventionReader.read(root)
    assert Enum.map(steps, & &1.command) == ["mix deps.get", "mix ecto.migrate"]
    assert Enum.all?(steps, &(&1.source == "convention"))
  end

  test "returns :none when no convention file", %{root: root} do
    assert ConventionReader.read(root) == :none
  end

  test "returns invalid_convention when top-level yaml is not a steps list", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), "foo: bar\n")

    assert ConventionReader.read(root) == {:error, :invalid_convention}
  end

  test "returns an error when yaml is malformed", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), "steps: [a, b\n")

    assert {:error, _reason} = ConventionReader.read(root)
  end

  test "returns invalid_convention when a step is missing its command", %{root: root} do
    File.write!(Path.join(root, ".symphony/devenv.yaml"), """
    steps:
      - description: missing command
    """)

    assert ConventionReader.read(root) == {:error, :invalid_convention}
  end
end
