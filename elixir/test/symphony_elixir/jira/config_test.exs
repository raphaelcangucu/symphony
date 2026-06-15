defmodule SymphonyElixir.Jira.ConfigTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.Jira.Config
  alias SymphonyElixir.Workflow

  defp write_jira!(overrides) do
    write_workflow_file!(
      Workflow.workflow_file_path(),
      [tracker_kind: "jira"] ++ overrides
    )
  end

  describe "accessors" do
    setup do
      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: "secret-token",
        jira_project_key: "ABC",
        jira_assignee: "me"
      )

      :ok
    end

    test "base_url/0 reads explicit value" do
      assert Config.base_url() == "https://acme.atlassian.net"
    end

    test "email/0 reads explicit value" do
      assert Config.email() == "bot@acme.com"
    end

    test "api_token/0 reads explicit value" do
      assert Config.api_token() == "secret-token"
    end

    test "project_key/0 reads explicit value" do
      assert Config.project_key() == "ABC"
    end

    test "assignee/0 reads explicit value" do
      assert Config.assignee() == "me"
    end
  end

  describe "env-var references" do
    test "api_token/0 resolves a $ENV reference" do
      original = System.get_env("JIRA_API_TOKEN")
      System.put_env("JIRA_API_TOKEN", "from-env")

      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: "$JIRA_API_TOKEN",
        jira_project_key: "ABC"
      )

      assert Config.api_token() == "from-env"

      on_exit(fn -> restore_env("JIRA_API_TOKEN", original) end)
    end

    test "api_token/0 falls back to JIRA_API_TOKEN env when unset" do
      original = System.get_env("JIRA_API_TOKEN")
      System.put_env("JIRA_API_TOKEN", "fallback-env")

      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: nil,
        jira_project_key: "ABC"
      )

      assert Config.api_token() == "fallback-env"

      on_exit(fn -> restore_env("JIRA_API_TOKEN", original) end)
    end
  end

  describe "validate!/0" do
    # `Config.validate!/0` reads the JIRA_* env vars as a fallback for any field
    # the WORKFLOW.md leaves blank. A developer shell that exports these (e.g. via
    # `elixir/.env`) would otherwise satisfy `base_url`/`email` and mask the
    # "missing" errors these tests assert. Clear them for the duration of each
    # test (saving and restoring the originals) so the suite is hermetic.
    setup do
      jira_env_keys = ~w(JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN JIRA_ASSIGNEE)
      saved = Map.new(jira_env_keys, fn key -> {key, System.get_env(key)} end)
      Enum.each(jira_env_keys, &System.delete_env/1)

      on_exit(fn ->
        Enum.each(saved, fn {key, value} -> restore_env(key, value) end)
      end)

      :ok
    end

    test "errors when base_url missing" do
      write_jira!(
        jira_base_url: nil,
        jira_email: "bot@acme.com",
        jira_api_token: "t",
        jira_project_key: "ABC"
      )

      assert {:error, message} = Config.validate!()
      assert message =~ "base URL"
    end

    test "errors when email missing" do
      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: nil,
        jira_api_token: "t",
        jira_project_key: "ABC"
      )

      assert {:error, message} = Config.validate!()
      assert message =~ "email"
    end

    test "errors when api_token missing" do
      original = System.get_env("JIRA_API_TOKEN")
      System.delete_env("JIRA_API_TOKEN")

      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: nil,
        jira_project_key: "ABC"
      )

      assert {:error, message} = Config.validate!()
      assert message =~ "API token"

      on_exit(fn -> restore_env("JIRA_API_TOKEN", original) end)
    end

    test "errors when project_key missing" do
      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: "t",
        jira_project_key: nil
      )

      assert {:error, message} = Config.validate!()
      assert message =~ "project key"
    end

    test "ok when all required fields present" do
      write_jira!(
        jira_base_url: "https://acme.atlassian.net",
        jira_email: "bot@acme.com",
        jira_api_token: "t",
        jira_project_key: "ABC"
      )

      assert :ok = Config.validate!()
    end
  end
end
