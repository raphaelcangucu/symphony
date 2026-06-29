defmodule SymphonyElixir.Settings.CredentialsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.Config, as: GitHubConfig
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Settings.{Credentials, Setting}

  setup do
    Repo.delete_all(Setting)
    on_exit(fn -> Repo.delete_all(Setting) end)
    :ok
  end

  test "stores a credential encrypted at rest and reads it back" do
    assert {:ok, :stored} = Credentials.put("github", "token", "ghp_abc123")
    assert Credentials.get("github", "token") == "ghp_abc123"
    assert Credentials.configured?("github", "token")

    row = Repo.get_by(Setting, group: "credentials", name: "github.token")
    assert is_binary(row.payload["value"])
    refute row.payload["value"] == "ghp_abc123"
  end

  test "a blank value clears the stored credential" do
    {:ok, :stored} = Credentials.put("linear", "api_key", "lin_xyz")
    assert {:ok, :cleared} = Credentials.put("linear", "api_key", "   ")
    refute Credentials.configured?("linear", "api_key")
    assert Credentials.get("linear", "api_key") == nil
  end

  test "rejects unknown providers and fields" do
    assert {:error, :unknown_credential} = Credentials.put("github", "nope", "x")
    assert {:error, :unknown_credential} = Credentials.put("slack", "token", "x")
  end

  test "field metadata distinguishes secret from non-secret fields" do
    assert Credentials.secret_field?("jira", "api_token")
    refute Credentials.secret_field?("jira", "base_url")
    assert Credentials.field?("jira", "email")
    refute Credentials.field?("jira", "unknown")
  end

  test "telegram bot token is a known encrypted credential" do
    assert Credentials.field?("telegram", "bot_token")
    assert Credentials.secret_field?("telegram", "bot_token")

    assert {:ok, :stored} = Credentials.put("telegram", "bot_token", "123:abc")
    assert Credentials.get("telegram", "bot_token") == "123:abc"
  end

  test "provider Config reads prefer the stored credential over the env var" do
    previous = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "env-token")

    on_exit(fn ->
      if previous, do: System.put_env("GITHUB_TOKEN", previous), else: System.delete_env("GITHUB_TOKEN")
    end)

    assert GitHubConfig.token() == "env-token"

    {:ok, :stored} = Credentials.put("github", "token", "db-token")
    assert GitHubConfig.token() == "db-token"

    Credentials.clear("github", "token")
    assert GitHubConfig.token() == "env-token"
  end
end
