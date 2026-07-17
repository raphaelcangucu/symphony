defmodule SymphonyElixir.LogFileTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LogFile

  test "default_log_file/0 uses the current working directory" do
    assert LogFile.default_log_file() == Path.join(File.cwd!(), "log/symphony.log")
  end

  test "default_log_file/1 builds the log path under a custom root" do
    assert LogFile.default_log_file("/tmp/symphony-logs") == "/tmp/symphony-logs/log/symphony.log"
  end

  test "sql_log_file/1 derives the SQL log path next to the main log" do
    assert LogFile.sql_log_file("/tmp/symphony-logs/log/symphony.log") ==
             "/tmp/symphony-logs/log/symphony.sql.log"
  end
end
