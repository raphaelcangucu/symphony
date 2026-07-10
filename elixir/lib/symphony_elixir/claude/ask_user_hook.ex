defmodule SymphonyElixir.Claude.AskUserHook do
  @moduledoc """
  Writes a per-session Claude Code `--settings` JSON that installs a
  `PreToolUse` command hook for `AskUserQuestion`, plus helpers to shape the
  hook stdout contract for tests.
  """

  @priv_script_rel Path.join(["priv", "claude", "ask_user_hook.sh"])

  @type write_opts :: [
          session_token: String.t(),
          gateway_base_url: String.t(),
          timeout_ms: non_neg_integer()
        ]

  @doc "Build the PreToolUse allow payload Claude expects on stdout."
  @spec allow_payload(map()) :: map()
  def allow_payload(%{"questions" => questions, "answers" => answers})
      when is_list(questions) and is_map(answers) do
    %{
      "hookSpecificOutput" => %{
        "hookEventName" => "PreToolUse",
        "permissionDecision" => "allow",
        "updatedInput" => %{
          "questions" => questions,
          "answers" => answers
        }
      }
    }
  end

  @doc "Build the PreToolUse deny payload Claude expects on stdout."
  @spec deny_payload(String.t()) :: map()
  def deny_payload(reason) when is_binary(reason) do
    %{
      "hookSpecificOutput" => %{
        "hookEventName" => "PreToolUse",
        "permissionDecision" => "deny",
        "permissionDecisionReason" => reason
      }
    }
  end

  @doc """
  Write session settings + wrapper script under `dir`.

  Returns `{:ok, settings_path}`.
  """
  @spec write_settings!(Path.t(), write_opts()) :: {:ok, Path.t()}
  def write_settings!(dir, opts) when is_binary(dir) and is_list(opts) do
    token = Keyword.fetch!(opts, :session_token)
    base_url = Keyword.fetch!(opts, :gateway_base_url)
    timeout_ms = Keyword.get(opts, :timeout_ms, 300_000)

    unless is_binary(token) and token != "", do: raise(ArgumentError, "session_token required")
    unless is_binary(base_url) and String.starts_with?(base_url, "http://127.0.0.1"),
      do: raise(ArgumentError, "gateway_base_url must be loopback http")

    File.mkdir_p!(dir)

    priv_script = priv_script_path!()
    wrapper_path = Path.join(dir, "ask_user_hook_wrapper.sh")
    settings_path = Path.join(dir, "symphony-ask-user-settings.json")
    ask_url = String.trim_trailing(base_url, "/") <> "/user-input/" <> token
    timeout_sec = max(div(timeout_ms, 1000), 1)

    wrapper = """
    #!/usr/bin/env bash
    set -euo pipefail
    export SYMPHONY_ASK_USER_URL=#{shell_single_quote(ask_url)}
    export SYMPHONY_ASK_USER_TIMEOUT_SEC=#{timeout_sec}
    exec #{shell_single_quote(priv_script)}
    """

    File.write!(wrapper_path, wrapper)
    File.chmod!(wrapper_path, 0o755)

    settings = %{
      "hooks" => %{
        "PreToolUse" => [
          %{
            "matcher" => "AskUserQuestion",
            "hooks" => [
              %{
                "type" => "command",
                "command" => wrapper_path
              }
            ]
          }
        ]
      }
    }

    File.write!(settings_path, Jason.encode!(settings))
    {:ok, settings_path}
  end

  @doc "Absolute path to the checked-in priv hook script."
  @spec priv_script_path!() :: Path.t()
  def priv_script_path! do
    path =
      :code.priv_dir(:symphony_elixir)
      |> List.to_string()
      |> Path.join(["claude", "ask_user_hook.sh"])

    if File.exists?(path) do
      path
    else
      # Mix test / source tree fallback
      fallback = Path.expand(Path.join([File.cwd!(), @priv_script_rel]))

      if File.exists?(fallback) do
        fallback
      else
        raise "missing AskUserQuestion hook script at #{path}"
      end
    end
  end

  defp shell_single_quote(value) when is_binary(value) do
    "'" <> String.replace(value, "'", "'\"'\"'") <> "'"
  end
end
