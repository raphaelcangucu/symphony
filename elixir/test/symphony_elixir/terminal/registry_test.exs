defmodule SymphonyElixir.Terminal.RegistryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Terminal.Registry
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule FakeWorkspace do
    def create_for_issue(%{identifier: "MAC-1"}), do: {:ok, "/tmp/symphony-workspaces/MAC-1"}
    def create_for_issue(%{identifier: "BAD-1"}), do: {:error, :workspace_failed}
  end

  defmodule FakeTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-MAC-1"), do: false
    def new_session("sym-issue-macro-markets-MAC-1", "/tmp/symphony-workspaces/MAC-1"), do: :ok
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

  defmodule WorkspaceTmux do
    def available?, do: true

    def has_session?(session_name) do
      send(self(), {:workspace_has_session, session_name})
      false
    end

    def new_session(session_name, cwd) do
      send(self(), {:workspace_new_session, session_name, cwd})
      :ok
    end

    def capture_pane(session_name) do
      send(self(), {:workspace_capture, session_name})
      {:ok, "workspace ready\n"}
    end
  end

  defmodule ResumeLaunchTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-MAC-1"), do: false
    def new_session("sym-issue-macro-markets-MAC-1", "/tmp/symphony-workspaces/MAC-1"), do: :ok
    def capture_pane("sym-issue-macro-markets-MAC-1"), do: {:ok, "ready\n"}

    def send_keys("sym-issue-macro-markets-MAC-1", data) do
      Process.put(:sent_keys, Process.get(:sent_keys, []) ++ [data])
      :ok
    end
  end

  defmodule GithubWorkspace do
    def create_for_issue(%{identifier: "501"}), do: {:ok, "/tmp/symphony-workspaces/501"}
  end

  defmodule GithubTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-501"), do: false
    def new_session("sym-issue-macro-markets-501", "/tmp/symphony-workspaces/501"), do: :ok
    def capture_pane("sym-issue-macro-markets-501"), do: {:ok, "ready\n"}
  end

  defmodule ResumeWorkspace do
    def path_for_issue("501"), do: "/tmp/symphony-workspaces/501"
  end

  defmodule ResumeTmux do
    def available?, do: true
    def has_session?("sym-issue-macro-markets-501"), do: true
    def capture_pane("sym-issue-macro-markets-501"), do: {:ok, "resumed\n"}
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
              cwd: "/tmp/symphony-workspaces/MAC-1",
              state: "running",
              output: "ready\n"
            }} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: FakeTmux,
               workspace: FakeWorkspace
             )
  end

  test "resumes the agent's codex session in a freshly created terminal" do
    Process.put(:sent_keys, [])

    assert {:ok, %{cwd: "/tmp/symphony-workspaces/MAC-1"}} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: ResumeLaunchTmux,
               workspace: FakeWorkspace,
               codex_resolver: fn "/tmp/symphony-workspaces/MAC-1" -> {:ok, "abc-123"} end
             )

    assert Process.get(:sent_keys) == ["codex resume abc-123\n"]
  end

  test "does not relaunch codex when reusing an existing session" do
    Process.put(:sent_keys, [])

    assert {:ok, %{output: "existing\n"}} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: ExistingSessionTmux,
               workspace: FakeWorkspace,
               codex_resolver: fn _cwd -> {:ok, "abc-123"} end
             )

    assert Process.get(:sent_keys) == []
  end

  test "opens a plain shell when no codex session resolves" do
    Process.put(:sent_keys, [])

    assert {:ok, %{output: "ready\n"}} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: ResumeLaunchTmux,
               workspace: FakeWorkspace,
               codex_resolver: fn _cwd -> :error end
             )

    assert Process.get(:sent_keys) == []
  end

  test "reuses an existing issue session" do
    assert {:ok, %{output: "existing\n"}} =
             Registry.open_issue_session(%{identifier: "MAC-1", project: %{slug: "macro-markets"}},
               tmux: ExistingSessionTmux,
               workspace: FakeWorkspace
             )
  end

  test "opens a session for a tracker-resolved remote issue identifier" do
    fetcher = fn "macro-markets", "#501" ->
      {:ok, IssueDTO.build(%{identifier: "#501", title: "Remote issue", project_slug: "macro-markets"})}
    end

    assert {:ok,
            %{
              issue_identifier: "#501",
              project_slug: "macro-markets",
              session_name: "sym-issue-macro-markets-501",
              cwd: "/tmp/symphony-workspaces/501",
              state: "running",
              output: "ready\n"
            }} =
             Registry.open_project_issue_session("macro-markets", "#501",
               tmux: GithubTmux,
               workspace: GithubWorkspace,
               issue_fetcher: fetcher
             )
  end

  test "resumes an existing session without resolving the issue or recreating the workspace" do
    fetcher = fn _slug, _identifier -> flunk("issue fetcher must not run when a session already exists") end

    assert {:ok,
            %{
              issue_identifier: "#501",
              project_slug: "macro-markets",
              session_name: "sym-issue-macro-markets-501",
              cwd: "/tmp/symphony-workspaces/501",
              state: "running",
              output: "resumed\n"
            }} =
             Registry.open_project_issue_session("macro-markets", "#501",
               tmux: ResumeTmux,
               workspace: ResumeWorkspace,
               issue_fetcher: fetcher
             )
  end

  test "propagates the resolver error when no session exists for the issue" do
    fetcher = fn _slug, _identifier -> {:error, :issue_not_found} end

    assert {:error, :issue_not_found} =
             Registry.open_project_issue_session("macro-markets", "#501",
               tmux: GithubTmux,
               workspace: GithubWorkspace,
               issue_fetcher: fetcher
             )
  end

  test "returns explicit errors when tmux or workspace setup fails" do
    assert {:error, :tmux_unavailable} =
             Registry.open_issue_session(%{identifier: "MAC-1"},
               tmux: MissingTmux,
               workspace: FakeWorkspace
             )

    assert {:error, {:workspace_setup_failed, :workspace_failed}} =
             Registry.open_issue_session(%{identifier: "BAD-1"},
               tmux: FakeTmux,
               workspace: FakeWorkspace
             )
  end

  test "opens a workspace session in the expanded existing directory" do
    workspace_path =
      Path.join([
        System.tmp_dir!(),
        "symphony-terminal-workspace-#{System.unique_integer([:positive])}",
        "nested",
        ".."
      ])

    expanded_path = Path.expand(workspace_path)
    File.mkdir_p!(expanded_path)
    on_exit(fn -> File.rm_rf!(expanded_path) end)

    assert {:ok,
            %{
              project_slug: "macro-markets",
              issue_identifier: nil,
              workspace_path: ^expanded_path,
              cwd: ^expanded_path,
              session_name: session_name,
              state: "running",
              output: "workspace ready\n"
            }} =
             Registry.open_workspace_session("macro-markets", workspace_path, tmux: WorkspaceTmux)

    assert String.starts_with?(session_name, "sym-workspace-macro-markets-")
    assert_receive {:workspace_has_session, ^session_name}
    assert_receive {:workspace_new_session, ^session_name, ^expanded_path}
    assert_receive {:workspace_capture, ^session_name}
  end

  test "rejects a missing workspace before opening tmux" do
    missing_path =
      Path.join(
        System.tmp_dir!(),
        "symphony-terminal-missing-#{System.unique_integer([:positive])}"
      )

    refute File.dir?(missing_path)

    assert {:error, :workspace_missing} =
             Registry.open_workspace_session("macro-markets", missing_path, tmux: WorkspaceTmux)

    refute_receive {:workspace_has_session, _session_name}
  end
end
