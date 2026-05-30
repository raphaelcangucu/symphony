defmodule SymphonyElixir.Terminal.Tmux do
  @moduledoc "Small tmux command wrapper for issue terminal sessions."

  @type command_result :: :ok | {:error, String.t()}

  @spec available?() :: boolean()
  def available? do
    match?({_output, 0}, run(["-V"]))
  rescue
    ErlangError -> false
  end

  @spec new_session(String.t(), Path.t()) :: command_result()
  def new_session(session_name, cwd) when is_binary(session_name) and is_binary(cwd) do
    run_result(["new-session", "-d", "-s", session_name, "-c", cwd])
  end

  @spec has_session?(String.t()) :: boolean()
  def has_session?(session_name) when is_binary(session_name) do
    match?({_output, 0}, run(["has-session", "-t", session_name]))
  rescue
    ErlangError -> false
  end

  @spec send_keys(String.t(), String.t()) :: command_result()
  def send_keys(session_name, data) when is_binary(session_name) and is_binary(data) do
    data
    |> String.split(~r/(\r\n|\r|\n)/, include_captures: true, trim: false)
    |> Enum.reject(&(&1 == ""))
    |> Enum.reduce_while(:ok, fn chunk, :ok ->
      args =
        case chunk do
          "\r" -> ["send-keys", "-t", session_name, "Enter"]
          "\n" -> ["send-keys", "-t", session_name, "Enter"]
          "\r\n" -> ["send-keys", "-t", session_name, "Enter"]
          literal -> ["send-keys", "-t", session_name, "-l", literal]
        end

      case run_result(args) do
        :ok -> {:cont, :ok}
        {:error, message} -> {:halt, {:error, message}}
      end
    end)
  end

  @spec resize(String.t(), pos_integer(), pos_integer()) :: command_result()
  def resize(session_name, cols, rows)
      when is_binary(session_name) and is_integer(cols) and is_integer(rows) and cols > 0 and rows > 0 do
    # Detached tmux sessions (no attached client) ignore `resize-pane` and stay
    # at the 80x24 default. Switching the window to a manual size and resizing
    # the window is the only way to widen the pane so client output stops
    # wrapping at 80 columns.
    with :ok <- run_result(["set-option", "-t", session_name, "window-size", "manual"]),
         :ok <-
           run_result([
             "resize-window",
             "-t",
             session_name,
             "-x",
             Integer.to_string(cols),
             "-y",
             Integer.to_string(rows)
           ]) do
      :ok
    end
  end

  @spec capture_pane(String.t()) :: {:ok, String.t()} | {:error, String.t()}
  def capture_pane(session_name) when is_binary(session_name) do
    case run(["capture-pane", "-t", session_name, "-p", "-S", "-2000"]) do
      {output, 0} -> {:ok, output}
      {output, _status} -> {:error, error_message(output)}
    end
  rescue
    error in ErlangError -> {:error, Exception.message(error)}
  end

  @spec kill_session(String.t()) :: command_result()
  def kill_session(session_name) when is_binary(session_name) do
    run_result(["kill-session", "-t", session_name])
  end

  defp run_result(args) do
    case run(args) do
      {_output, 0} -> :ok
      {output, _status} -> {:error, error_message(output)}
    end
  rescue
    error in ErlangError -> {:error, Exception.message(error)}
  end

  defp run(args) do
    runner = Application.get_env(:symphony_elixir, :terminal_tmux_command_runner, &System.cmd/3)
    runner.("tmux", args, stderr_to_stdout: true)
  end

  defp error_message(output) when is_binary(output) do
    output
    |> String.trim()
    |> case do
      "" -> "tmux command failed"
      message -> message
    end
  end
end
