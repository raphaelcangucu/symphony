defmodule SymphonyElixirWeb.TerminalChannelDevTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  defmodule FakeDevTmux do
    def has_session?("sym-dev-gamba-GAM-20-backend"), do: true
    def has_session?(_session_name), do: false

    def capture_pane("sym-dev-gamba-GAM-20-backend"), do: {:ok, "docker build output"}
    def capture_pane(_session_name), do: {:error, "can't find pane"}

    def send_keys(session_name, data) do
      send(test_pid(), {:sent_keys, session_name, data})
      :ok
    end

    def resize(session_name, cols, rows) do
      send(test_pid(), {:resized, session_name, cols, rows})
      :ok
    end

    defp test_pid, do: Process.whereis(__MODULE__.TestProcess)
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    previous_tmux = Application.get_env(:symphony_elixir, :terminal_tmux)
    Application.put_env(:symphony_elixir, :terminal_tmux, FakeDevTmux)

    Process.register(self(), FakeDevTmux.TestProcess)

    on_exit(fn ->
      restore_env(@token_env, previous_token)

      case previous_tmux do
        nil -> Application.delete_env(:symphony_elixir, :terminal_tmux)
        tmux -> Application.put_env(:symphony_elixir, :terminal_tmux, tmux)
      end
    end)

    :ok
  end

  test "joins a dev server session, forwards keystrokes, and pushes captures" do
    assert {:ok, %{session: session}, socket} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(SymphonyElixirWeb.TerminalChannel, "terminal:dev:gamba:GAM-20:backend")

    assert session.server_slug == "backend"
    assert session.session_name == "sym-dev-gamba-GAM-20-backend"
    assert session.output == "docker build output"

    push(socket, "input", %{"data" => "\u0003"})
    assert_receive {:sent_keys, "sym-dev-gamba-GAM-20-backend", "\u0003"}, 1_000
    assert_push("output", %{data: "docker build output"})

    push(socket, "resize", %{"cols" => 120, "rows" => 40})
    assert_receive {:resized, "sym-dev-gamba-GAM-20-backend", 120, 40}, 1_000
  end

  test "rejects a dev topic whose tmux session does not exist" do
    assert {:error, %{reason: reason}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(SymphonyElixirWeb.TerminalChannel, "terminal:dev:gamba:GAM-20:missing")

    assert reason =~ "not found"
  end

  test "rejects dev topics without a valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "wrong"})
             |> subscribe_and_join(SymphonyElixirWeb.TerminalChannel, "terminal:dev:gamba:GAM-20:backend")
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
