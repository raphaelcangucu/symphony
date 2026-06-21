defmodule SymphonyElixir.DevServeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServe

  describe "load_dotenv!/1" do
    setup do
      on_exit(fn ->
        System.delete_env("DEV_SERVE_DOTENV_TEST")
        System.delete_env("DEV_SERVE_DOTENV_OVERRIDE")
      end)

      :ok
    end

    test "loads missing variables from .env without overriding existing ones" do
      path = Path.join(System.tmp_dir!(), "symphony-dev-serve-#{System.unique_integer([:positive])}.env")
      File.write!(path, "DEV_SERVE_DOTENV_TEST=from_file\nDEV_SERVE_DOTENV_OVERRIDE=from_file\n")
      System.put_env("DEV_SERVE_DOTENV_OVERRIDE", "from_shell")

      DevServe.load_dotenv!(path: path)

      assert System.get_env("DEV_SERVE_DOTENV_TEST") == "from_file"
      assert System.get_env("DEV_SERVE_DOTENV_OVERRIDE") == "from_shell"

      File.rm!(path)
    end
  end

  describe "resolve_port/1" do
    test "returns {:ok, nil} when no port override is configured" do
      assert DevServe.resolve_port(%{}) == {:ok, nil}
    end

    test "parses a valid port override" do
      assert DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "4567"}) == {:ok, 4567}
    end

    test "rejects a non-integer port override" do
      assert {:error, message} = DevServe.resolve_port(%{"SYMPHONY_TRACKER_PORT" => "abc"})
      assert message =~ "Invalid SYMPHONY_TRACKER_PORT"
    end
  end
end
