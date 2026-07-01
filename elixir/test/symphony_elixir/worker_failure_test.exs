defmodule SymphonyElixir.WorkerFailureTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.WorkerFailure

  test "format includes exception message and stack trace" do
    exception = %RuntimeError{message: "boom"}

    stacktrace = [
      {__MODULE__, :sample, 1, []},
      {Enum, :map, 2, [file: "lib/enum.ex", line: 10]}
    ]

    formatted = WorkerFailure.format(exception, stacktrace)

    assert formatted =~ "boom"
    assert formatted =~ "Stack trace:"
    assert formatted =~ "WorkerFailureTest.sample/1"
    assert formatted =~ "Enum.map/2"
  end

  test "format_exit_reason distinguishes shutdown from exceptions" do
    assert WorkerFailure.format_exit_reason(:shutdown) =~ "shutdown"
    assert WorkerFailure.crash_exception?(%RuntimeError{message: "x"})
    refute WorkerFailure.crash_exception?(:shutdown)
  end

  test "summary returns the first line only" do
    body = WorkerFailure.format(%RuntimeError{message: "boom"}, [{__MODULE__, :sample, 1, []}])
    assert WorkerFailure.summary(%RuntimeError{message: "boom"}) == "boom"
    assert WorkerFailure.summary(body) == "boom"
  end

  def sample, do: :ok
end
