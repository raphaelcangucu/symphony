defmodule SymphonyElixir.LocalTracker.DevEnv.ConventionReaderTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{ConventionReader, ProposedStep}

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
