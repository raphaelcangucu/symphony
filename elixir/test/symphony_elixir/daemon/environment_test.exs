defmodule SymphonyElixir.Daemon.EnvironmentTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Daemon.Environment

  test "render keeps only PATH, locale, and the SYMPHONY namespace" do
    rendered =
      Environment.render(%{
        "PATH" => "/usr/bin:/home/a b/bin",
        "LANG" => "pt_BR.UTF-8",
        "SYMPHONY_TRACKER_TOKEN" => "quote\"slash\\",
        "GITHUB_TOKEN" => "must-not-copy",
        "BASH_FUNC_x" => "must-not-copy"
      })

    assert rendered =~ ~s(PATH="/usr/bin:/home/a b/bin")
    assert rendered =~ ~s(SYMPHONY_TRACKER_TOKEN="quote\\\"slash\\\\")
    refute rendered =~ "GITHUB_TOKEN"
    refute rendered =~ "BASH_FUNC"
  end

  test "render rejects newlines and NUL bytes" do
    assert_raise ArgumentError, ~r/unsafe environment value/, fn ->
      Environment.render(%{"SYMPHONY_BAD" => "one\ntwo"})
    end

    assert_raise ArgumentError, ~r/unsafe environment value/, fn ->
      Environment.render(%{"SYMPHONY_BAD" => "one\0two"})
    end
  end

  test "parse accepts rendered values and rejects shell syntax" do
    rendered =
      Environment.render(%{
        "PATH" => "/usr/bin",
        "SYMPHONY_TRACKER_TOKEN" => "quote\"slash\\"
      })

    assert {:ok, env} = Environment.parse(rendered)
    assert env["SYMPHONY_TRACKER_TOKEN"] == "quote\"slash\\"
    assert {:error, :invalid} = Environment.parse("SYMPHONY_BAD=$(touch /tmp/escape)\n")
  end
end
