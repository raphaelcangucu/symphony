defmodule SymphonyElixir.Notion.ConfigTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Notion.Config
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.{Credentials, Setting}

  setup do
    Repo.delete_all(Setting)
    previous = System.get_env("NOTION_API_KEY")

    on_exit(fn ->
      Repo.delete_all(Setting)

      if previous,
        do: System.put_env("NOTION_API_KEY", previous),
        else: System.delete_env("NOTION_API_KEY")
    end)

    System.delete_env("NOTION_API_KEY")
    :ok
  end

  test "prefers stored credential over env" do
    System.put_env("NOTION_API_KEY", "env-key")
    assert Config.api_key() == "env-key"
    assert {:ok, :stored} = Credentials.put("notion", "api_key", "db-key")
    assert Config.api_key() == "db-key"
  end
end
