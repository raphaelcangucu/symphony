defmodule SymphonyElixir.Terminal.RegistryDevSessionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Terminal.Registry

  defmodule CreateTmux do
    def available?, do: true
    def has_session?("sym-dev-macro-markets-507-front"), do: false
    def new_session("sym-dev-macro-markets-507-front", "/tmp/macro-markets/front"), do: :ok
    def capture_pane("sym-dev-macro-markets-507-front"), do: {:ok, "output"}
  end

  defmodule ExistingTmux do
    def available?, do: true
    def has_session?("sym-dev-macro-markets-507-front"), do: true
    def capture_pane("sym-dev-macro-markets-507-front"), do: {:ok, "existing output"}
  end

  defmodule KillTmux do
    def kill_session(name) do
      send(self(), {:killed_session, name})
      :ok
    end
  end

  test "dev session name is stable and namespaced" do
    assert Registry.dev_session_name("macro-markets", "#507", "front") ==
             "sym-dev-macro-markets-507-front"
  end

  test "open_dev_session creates a namespaced session and returns terminal state" do
    assert {:ok,
            %{
              project_slug: "macro-markets",
              issue_identifier: "#507",
              session_name: "sym-dev-macro-markets-507-front",
              cwd: "/tmp/macro-markets/front",
              state: "running",
              output: "output"
            }} =
             Registry.open_dev_session(
               "macro-markets",
               "#507",
               "front",
               "/tmp/macro-markets/front",
               tmux: CreateTmux
             )
  end

  test "open_dev_session resumes an existing namespaced session" do
    assert {:ok, %{session_name: "sym-dev-macro-markets-507-front", output: "existing output"}} =
             Registry.open_dev_session(
               "macro-markets",
               "#507",
               "front",
               "/tmp/macro-markets/front",
               tmux: ExistingTmux
             )
  end

  test "kill_dev_session delegates to tmux with the namespaced session" do
    assert :ok = Registry.kill_dev_session("macro-markets", "#507", "front", tmux: KillTmux)
    assert_received {:killed_session, "sym-dev-macro-markets-507-front"}
  end
end
