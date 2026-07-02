defmodule SymphonyElixir.WorkerFailure do
  @moduledoc """
  Formats agent worker failures for session logs and retry metadata.
  """

  @max_stack_lines 40

  @spec format(term(), list()) :: String.t()
  def format(reason, stacktrace \\ [])

  def format(exception, stacktrace) when is_exception(exception) do
    join_message_and_stack(Exception.message(exception), format_stacktrace(stacktrace))
  end

  def format({:exit, reason}, stacktrace) do
    join_message_and_stack("exit: #{format_reason(reason)}", format_stacktrace(stacktrace))
  end

  def format({:throw, reason}, stacktrace) do
    join_message_and_stack("throw: #{format_reason(reason)}", format_stacktrace(stacktrace))
  end

  def format(reason, stacktrace) when is_list(stacktrace) and stacktrace != [] do
    join_message_and_stack(format_reason(reason), format_stacktrace(stacktrace))
  end

  def format(reason, _stacktrace), do: format_reason(reason)

  @spec summary(term()) :: String.t()
  def summary(reason) do
    reason
    |> format()
    |> String.split("\n", parts: 2)
    |> List.first()
    |> case do
      line when is_binary(line) -> String.trim(line)
      _ -> "worker failure"
    end
  end

  @spec crash_exception?(term()) :: boolean()
  def crash_exception?(reason) do
    is_exception(reason) or match?({:exit, _}, reason) or match?({:throw, _}, reason)
  end

  @spec format_exit_reason(term()) :: String.t()
  def format_exit_reason(:shutdown), do: "Worker process terminated (shutdown signal)"
  def format_exit_reason(:killed), do: "Worker process killed"
  def format_exit_reason({:shutdown, detail}), do: "Worker process terminated (shutdown): #{format_reason(detail)}"

  def format_exit_reason(reason) do
    if crash_exception?(reason) do
      format(reason)
    else
      "Worker process exited: #{format_reason(reason)}"
    end
  end

  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason), do: inspect(reason, pretty: true, limit: :infinity)

  defp join_message_and_stack(message, stack) do
    message = String.trim(message || "")

    cond do
      message != "" and stack != "" -> message <> "\n\n" <> stack
      message != "" -> message
      stack != "" -> stack
      true -> "Unknown worker failure"
    end
  end

  defp format_stacktrace(stacktrace) when is_list(stacktrace) do
    stacktrace
    |> Enum.take(@max_stack_lines)
    |> Enum.map(&Exception.format_stacktrace_entry/1)
    |> Enum.map(&String.trim_trailing/1)
    |> Enum.reject(&(&1 == ""))
    |> case do
      [] -> ""
      lines -> "Stack trace:\n" <> Enum.join(lines, "\n")
    end
  end

  defp format_stacktrace(_stacktrace), do: ""
end
