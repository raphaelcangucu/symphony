defmodule SymphonyElixir.Terminal.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Terminal.Registry

  defmodule FakeWorkspace do
    def create_for_issue(%{identifier: "macro-markets-MAC-1"}), do: {:ok, "/tmp/symphony-workspaces/macro-markets-MAC-1"}
    def create_for_issue(%{identifier: "local-BAD-1"}), do: {:error, :workspace_failed}
  end

  defmodule FakeTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-MAC-1"), do: false
    def new_session("sym-issue-macro-markets-MAC-1", "/tmp/symphony-workspaces/macro-markets-MAC-1"), do: :ok
    def capture_pane("sym-issue-macro-markets-MAC-1"), do: {:ok, "ready\n"}
  end

  defmodule ExistingSessionTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-MAC-1"), do: true
    def capture_pane("sym-issue-macro-markets-MAC-1"), do: {:ok, "existing\n"}
  end

  defmodule MissingTmux do
    def available?, do: false
  end

  test "session name is stable and safe for issue identifier" do
    assert Registry.session_name("MAC-1") == "sym-issue-MAC-1"
    assert Registry.session_name("macro-markets", "MAC-1") == "sym-issue-macro-markets-MAC-1"
    assert Registry.session_name("mac 1/feature") == "sym-issue-mac_1_feature"
    assert Registry.session_name("../") == "sym-issue-issue"
  end

  test "opens an issue session in the issue workspace" do
    assert {:ok,
            %{
              issue_identifier: "MAC-1",
              project_slug: "macro-markets",
              session_name: "sym-issue-macro-markets-MAC-1",
              cwd: "/tmp/symphony-workspaces/macro-markets-MAC-1",
              state: "running",
              output: "ready\n"
            }} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: FakeTmux,
               workspace: FakeWorkspace
             )
  end

  test "reuses an existing issue session" do
    assert {:ok, %{output: "existing\n"}} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: ExistingSessionTmux,
               workspace: FakeWorkspace
             )
  end

  test "returns explicit errors when tmux or workspace setup fails" do
    assert {:error, "tmux is not available"} =
             Registry.open_issue_session(%{identifier: "MAC-1"},
               tmux: MissingTmux,
               workspace: FakeWorkspace
             )

    assert {:error, "workspace setup failed: :workspace_failed"} =
             Registry.open_issue_session(%{identifier: "BAD-1"},
               tmux: FakeTmux,
               workspace: FakeWorkspace
             )
  end
end
