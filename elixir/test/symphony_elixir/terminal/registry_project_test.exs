defmodule SymphonyElixir.Terminal.RegistryProjectTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Terminal.Registry

  defmodule TmuxStub do
    def available?, do: true
    def has_session?(_name), do: false
    def new_session(_name, _cwd), do: :ok
    def send_keys(_name, _data), do: :ok
    def capture_pane(_name), do: {:ok, "captured"}
    def resize(_name, _c, _r), do: :ok
  end

  test "open_project_session builds a sym-devenv session" do
    assert {:ok, session} =
             Registry.open_project_session("my-proj", cwd: "/tmp/my-proj", tmux: TmuxStub)

    assert session.session_name == "sym-devenv-my-proj"
    assert session.project_slug == "my-proj"
    assert session.output == "captured"
  end

  test "send_input_project + capture_project delegate to tmux" do
    assert :ok = Registry.send_input_project("my-proj", "echo hi\n", tmux: TmuxStub)
    assert {:ok, "captured"} = Registry.capture_project("my-proj", tmux: TmuxStub)
  end
end
