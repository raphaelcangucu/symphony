# Claude AskUserQuestion via PreToolUse Implementation Plan

**Goal:** Make interactive Claude assistant turns pause on native `AskUserQuestion`, show the shared `UserQuestionsCard`, and resume the same CLI turn with the operator's answers — fixing the `"Answer questions?"` / **FALHOU** failure seen on thread `7999`.

**Architecture:** Install a session-scoped Claude Code `PreToolUse` hook (matcher `AskUserQuestion`) that long-polls a loopback HTTP route on the existing ToolGateway Bandit listener. The route emits `:user_input_required` to the live `AssistantChannel` and blocks on a new `UserInputBroker` registry until `submit_user_input` resolves it. The hook then returns `permissionDecision: allow` + `updatedInput{questions, answers}`. Codex stays on its port path; Cursor is out of scope.

**Tech Stack:** Elixir (Registry, Bandit/Plug on ToolGateway, Phoenix Channel), Claude CLI `--settings` hooks, existing React `UserQuestionsCard`.

**Spec:** `docs/superpowers/specs/2026-07-09-claude-ask-user-question-pretooluse-design.md`

---

## File Structure

**Backend (Elixir)**
- Create `elixir/lib/symphony_elixir/assistant/user_input_broker.ex` — Registry await/resolve + session binding table.
- Create `elixir/lib/symphony_elixir/assistant/user_question_normalizer.ex` — Claude↔Codex question/answer shaping.
- Create `elixir/lib/symphony_elixir/claude/ask_user_hook.ex` — write `--settings` JSON + hook runner script; build PreToolUse stdout payload.
- Create `elixir/priv/claude/ask_user_hook.sh` — stdin→HTTP long-poll→stdout wrapper invoked by Claude CLI.
- Modify `elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex` — add `POST /user-input/:session_token` long-poll route.
- Modify `elixir/lib/symphony_elixir/shared_supervisor.ex` — start UserInputBroker registry.
- Modify `elixir/lib/symphony_elixir/claude/coding_agent.ex` — install/cleanup settings when interactive; pass settings path into CliRunner.
- Modify `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex` — `--settings` flag.
- Modify `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — route Claude `submit_user_input` to broker; register session token↔channel on turn start.

**Tests**
- Create `elixir/test/symphony_elixir/assistant/user_input_broker_test.exs`
- Create `elixir/test/symphony_elixir/assistant/user_question_normalizer_test.exs`
- Create `elixir/test/symphony_elixir/claude/ask_user_hook_test.exs`
- Modify `elixir/test/symphony_elixir/claude/app_server/tool_gateway_test.exs`
- Modify `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

**Answer contract across layers**
- Claude PreToolUse stdin → `tool_input.questions` (Claude shape).
- Hook → ToolGateway: `POST /user-input/:session_token` body `{request_id, questions}` (Claude shape).
- ToolGateway → channel: `{:assistant_user_input_required, %{request_id, questions}}` where `questions` is **Codex-shaped** (normalized).
- Client → channel: `{request_id, answers: %{questionId => label_or_text}}`.
- Channel → broker: Codex-shaped answers `%{qid => %{"answers" => [value]}}`.
- Broker → hook HTTP response: Claude `answers` map `%{question_text => label}` plus echoed original Claude `questions`.
- Hook stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "questions": ["…original…"],
      "answers": {"<question text>": "<label>"}
    }
  }
}
```

**Non-interactive Claude:** do **not** install the interactive hook; leave native failure behavior (no card, no fabricated consent).

---

### Task 1: UserInputBroker registry

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/user_input_broker.ex`
- Modify: `elixir/lib/symphony_elixir/shared_supervisor.ex`
- Test: `elixir/test/symphony_elixir/assistant/user_input_broker_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.UserInputBrokerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.UserInputBroker

  test "resolve delivers answers to await" do
    request_id = "req-#{System.unique_integer([:positive])}"
    answers = %{"q1" => %{"answers" => ["Use default"]}}

    task =
      Task.async(fn ->
        UserInputBroker.await(request_id, 2_000)
      end)

    # Give the awaiter time to register
    Process.sleep(20)
    assert :ok = UserInputBroker.resolve(request_id, answers)
    assert {:ok, ^answers} = Task.await(task)
  end

  test "await times out with error" do
    request_id = "req-timeout-#{System.unique_integer([:positive])}"
    assert {:error, :timeout} = UserInputBroker.await(request_id, 50)
  end

  test "bind_session and lookup_session round-trip" do
    token = "tok-#{System.unique_integer([:positive])}"
    binding = %{channel_pid: self(), thread_id: 7999, agent: "claude"}

    assert :ok = UserInputBroker.bind_session(token, binding)
    assert {:ok, ^binding} = UserInputBroker.lookup_session(token)
    assert :ok = UserInputBroker.unbind_session(token)
    assert :error = UserInputBroker.lookup_session(token)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/assistant/user_input_broker_test.exs`
Expected: FAIL — module missing

- [ ] **Step 3: Implement UserInputBroker**

```elixir
defmodule SymphonyElixir.Assistant.UserInputBroker do
  @moduledoc """
  Correlates a Claude AskUserQuestion PreToolUse wait with the operator's answers.

  Two registries:
  - `@await_registry` — request_id → waiting hook/HTTP process
  - ETS `@sessions` — session_token → %{channel_pid, thread_id, agent}
  """

  require Logger

  @await_registry __MODULE__.AwaitRegistry
  @sessions __MODULE__.Sessions
  @default_timeout_ms 300_000

  @type answers :: %{optional(String.t()) => map()}
  @type session_binding :: %{
          required(:channel_pid) => pid(),
          required(:thread_id) => integer() | nil,
          required(:agent) => String.t()
        }

  @spec registry_child_spec() :: {module(), keyword()}
  def registry_child_spec, do: {Registry, keys: :unique, name: @await_registry}

  @spec ensure_started() :: :ok
  def ensure_started do
    ensure_registry()
    ensure_sessions_table()
    :ok
  end

  @spec await(String.t(), non_neg_integer()) :: {:ok, answers()} | {:error, :timeout | :duplicate}
  def await(request_id, timeout_ms \\ @default_timeout_ms)
      when is_binary(request_id) and is_integer(timeout_ms) and timeout_ms >= 0 do
    ensure_started()

    case Registry.register(@await_registry, request_id, nil) do
      {:ok, _owner} ->
        receive do
          {:user_input_answers, ^request_id, answers} when is_map(answers) ->
            {:ok, answers}
        after
          timeout_ms ->
            Logger.warning("[UserInputBroker] request #{short(request_id)} timed out after #{timeout_ms}ms")
            {:error, :timeout}
        end

      {:error, {:already_registered, _pid}} ->
        Logger.warning("[UserInputBroker] duplicate request_id #{short(request_id)}")
        {:error, :duplicate}
    end
  end

  @spec resolve(String.t(), answers()) :: :ok
  def resolve(request_id, answers) when is_binary(request_id) and is_map(answers) do
    ensure_started()

    Registry.dispatch(@await_registry, request_id, fn entries ->
      Enum.each(entries, fn {pid, _} ->
        send(pid, {:user_input_answers, request_id, answers})
      end)
    end)

    :ok
  end

  @spec bind_session(String.t(), session_binding()) :: :ok
  def bind_session(token, %{channel_pid: pid, agent: agent} = binding)
      when is_binary(token) and is_pid(pid) and is_binary(agent) do
    ensure_started()
    true = :ets.insert(@sessions, {token, Map.put_new(binding, :thread_id, nil)})
    :ok
  end

  @spec lookup_session(String.t()) :: {:ok, session_binding()} | :error
  def lookup_session(token) when is_binary(token) do
    ensure_started()

    case :ets.lookup(@sessions, token) do
      [{^token, binding}] -> {:ok, binding}
      [] -> :error
    end
  end

  @spec unbind_session(String.t()) :: :ok
  def unbind_session(token) when is_binary(token) do
    ensure_started()
    :ets.delete(@sessions, token)
    :ok
  end

  defp ensure_registry do
    if Process.whereis(@await_registry) == nil do
      case Registry.start_link(keys: :unique, name: @await_registry) do
        {:ok, _} -> :ok
        {:error, {:already_started, _}} -> :ok
        {:error, reason} ->
          Logger.warning("[UserInputBroker] registry start failed: #{inspect(reason)}")
      end
    end

    :ok
  end

  defp ensure_sessions_table do
    case :ets.whereis(@sessions) do
      :undefined ->
        :ets.new(@sessions, [:named_table, :public, :set, read_concurrency: true])
        :ok

      _tid ->
        :ok
    end
  end

  defp short(id) when is_binary(id), do: String.slice(id, 0, 8)
end
```

In `shared_supervisor.ex` `child_specs/0`, immediately after `ApprovalBroker.registry_child_spec()`:

```elixir
SymphonyElixir.Assistant.UserInputBroker.registry_child_spec(),
```

- [ ] **Step 4: Run tests — PASS**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/assistant/user_input_broker_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/user_input_broker.ex \
  elixir/lib/symphony_elixir/shared_supervisor.ex \
  elixir/test/symphony_elixir/assistant/user_input_broker_test.exs
git commit -m "feat(assistant): add UserInputBroker for Claude AskUserQuestion"
```

---

### Task 2: Question normalizer

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/user_question_normalizer.ex`
- Test: `elixir/test/symphony_elixir/assistant/user_question_normalizer_test.exs`

- [ ] **Step 1: Write the failing test**

```elixir
defmodule SymphonyElixir.Assistant.UserQuestionNormalizerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.UserQuestionNormalizer

  @claude_questions [
    %{
      "header" => "Alvo do teste",
      "multiSelect" => false,
      "question" => "Qual objetivo priorizar?",
      "options" => [
        %{"label" => "Validar o que a 510 entrega", "description" => "Pest"},
        %{"label" => "Demo visual", "description" => "Playwright"}
      ]
    }
  ]

  test "to_ui_questions adds stable ids and Codex fields" do
    [q] = UserQuestionNormalizer.to_ui_questions(@claude_questions)
    assert q["id"] == "q0"
    assert q["header"] == "Alvo do teste"
    assert q["question"] == "Qual objetivo priorizar?"
    assert q["isOther"] == false
    assert q["isSecret"] == false
    assert length(q["options"]) == 2
  end

  test "to_claude_answers maps qid answers back to question text keys" do
    ui = UserQuestionNormalizer.to_ui_questions(@claude_questions)

    codex_answers = %{
      "q0" => %{"answers" => ["Validar o que a 510 entrega"]}
    }

    assert UserQuestionNormalizer.to_claude_answers(ui, @claude_questions, codex_answers) ==
             %{"Qual objetivo priorizar?" => "Validar o que a 510 entrega"}
  end
end
```

- [ ] **Step 2: Run — FAIL**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir/assistant/user_question_normalizer_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.Assistant.UserQuestionNormalizer do
  @moduledoc false

  @spec to_ui_questions(list()) :: [map()]
  def to_ui_questions(questions) when is_list(questions) do
    questions
    |> Enum.with_index()
    |> Enum.map(fn {question, index} -> normalize_one(question, index) end)
  end

  def to_ui_questions(_), do: []

  @spec to_claude_answers([map()], list(), map()) :: %{String.t() => String.t()}
  def to_claude_answers(ui_questions, claude_questions, codex_answers)
      when is_list(ui_questions) and is_list(claude_questions) and is_map(codex_answers) do
    Enum.reduce(ui_questions, %{}, fn ui_q, acc ->
      id = Map.get(ui_q, "id") || Map.get(ui_q, :id)
      question_text = Map.get(ui_q, "question") || Map.get(ui_q, :question)

      case Map.get(codex_answers, id) || Map.get(codex_answers, to_string(id)) do
        %{"answers" => [value | _]} when is_binary(question_text) and is_binary(value) ->
          Map.put(acc, question_text, value)

        value when is_binary(question_text) and is_binary(value) ->
          Map.put(acc, question_text, value)

        _ ->
          acc
      end
    end)
  end

  def to_claude_answers(_, _, _), do: %{}

  defp normalize_one(question, index) when is_map(question) do
    options =
      case Map.get(question, "options") || Map.get(question, :options) do
        list when is_list(list) ->
          Enum.map(list, fn
            %{"label" => label} = opt ->
              %{
                "label" => label,
                "description" => Map.get(opt, "description") || Map.get(opt, :description)
              }

            %{label: label} = opt ->
              %{
                "label" => label,
                "description" => Map.get(opt, :description)
              }

            other ->
              other
          end)

        _ ->
          nil
      end

    %{
      "id" => "q#{index}",
      "header" => Map.get(question, "header") || Map.get(question, :header) || "",
      "question" => Map.get(question, "question") || Map.get(question, :question) || "",
      "isOther" => Map.get(question, "isOther") || Map.get(question, :isOther) || false,
      "isSecret" => Map.get(question, "isSecret") || Map.get(question, :isSecret) || false,
      "options" => options
    }
  end

  defp normalize_one(_, index) do
    %{"id" => "q#{index}", "header" => "", "question" => "", "isOther" => false, "isSecret" => false, "options" => nil}
  end
end
```

- [ ] **Step 4: Run — PASS + commit**

```bash
git add elixir/lib/symphony_elixir/assistant/user_question_normalizer.ex \
  elixir/test/symphony_elixir/assistant/user_question_normalizer_test.exs
git commit -m "feat(assistant): normalize Claude AskUserQuestion payloads for UI"
```

---

### Task 3: ToolGateway user-input HTTP route

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex`
- Modify: `elixir/test/symphony_elixir/claude/app_server/tool_gateway_test.exs`

- [ ] **Step 1: Write the failing HTTP round-trip test**

Add to `tool_gateway_test.exs`:

```elixir
test "POST /user-input/:token awaits answers from broker" do
  alias SymphonyElixir.Assistant.UserInputBroker

  UserInputBroker.ensure_started()
  token = "user-input-#{System.unique_integer([:positive])}"
  channel = self()
  assert :ok = UserInputBroker.bind_session(token, %{channel_pid: channel, thread_id: 1, agent: "claude"})

  {:ok, _tok, mcp_url} = ToolGateway.register_session([], fn _, _ -> %{"ok" => true} end)
  base = mcp_url |> URI.parse() |> Map.put(:path, "/user-input/#{token}") |> URI.to_string()

  request_id = "hook-req-1"
  questions = [%{"header" => "H", "question" => "Q?", "options" => [%{"label" => "A", "description" => "d"}]}]

  task =
    Task.async(fn ->
      Req.post(base,
        json: %{"request_id" => request_id, "questions" => questions},
        receive_timeout: 5_000
      )
    end)

  assert_receive {:assistant_user_input_required, %{request_id: ^request_id, questions: ui_qs}}, 2_000
  assert hd(ui_qs)["id"] == "q0"

  assert :ok =
           UserInputBroker.resolve(request_id, %{"q0" => %{"answers" => ["A"]}})

  assert {:ok, %{status: 200, body: body}} = Task.await(task)
  assert body["permissionDecision"] == "allow"
  assert body["updatedInput"]["answers"]["Q?"] == "A"
  assert is_list(body["updatedInput"]["questions"])
after
  UserInputBroker.unbind_session(token)
end
```

- [ ] **Step 2: Run — FAIL (route 404)**

- [ ] **Step 3: Implement route in ToolGateway**

In `tool_gateway.ex`, add alias + route before the catch-all:

```elixir
alias SymphonyElixir.Assistant.{UserInputBroker, UserQuestionNormalizer}

post "/user-input/:session_token" do
  handle_user_input(conn, session_token)
end
```

```elixir
defp handle_user_input(conn, session_token) when is_binary(session_token) do
  UserInputBroker.ensure_started()

  case UserInputBroker.lookup_session(session_token) do
    :error ->
      send_resp(conn, 401, Jason.encode!(%{"error" => "unauthorized"}))

    {:ok, %{channel_pid: channel_pid}} ->
      body = conn.body_params || %{}
      request_id = Map.get(body, "request_id") || Map.get(body, :request_id)
      claude_questions = Map.get(body, "questions") || Map.get(body, :questions) || []

      if not is_binary(request_id) do
        send_resp(conn, 400, Jason.encode!(%{"error" => "request_id required"}))
      else
        ui_questions = UserQuestionNormalizer.to_ui_questions(claude_questions)

        send(channel_pid, {:assistant_user_input_required, %{request_id: request_id, questions: ui_questions}})

        timeout_ms = Map.get(body, "timeout_ms") || 300_000

        case UserInputBroker.await(request_id, timeout_ms) do
          {:ok, codex_answers} ->
            answers = UserQuestionNormalizer.to_claude_answers(ui_questions, claude_questions, codex_answers)

            payload = %{
              "permissionDecision" => "allow",
              "updatedInput" => %{
                "questions" => claude_questions,
                "answers" => answers
              }
            }

            send_resp(conn, 200, Jason.encode!(payload))

          {:error, :timeout} ->
            send_resp(
              conn,
              504,
              Jason.encode!(%{
                "permissionDecision" => "deny",
                "permissionDecisionReason" => "Operator input timed out"
              })
            )

          {:error, :duplicate} ->
            send_resp(conn, 409, Jason.encode!(%{"error" => "duplicate request_id"}))
        end
      end
  end
end
```

Keep ToolGateway's "stdlib-only" comment accurate by treating Assistant.* as an intentional exception documented in the module moduledoc, **or** move the Plug handler into `SymphonyElixir.Assistant.UserInputHttp` and call it from ToolGateway to preserve isolation. Prefer a thin `UserInputHttp.call/2` invoked from ToolGateway if the import rule is enforced by tests/`mix` checks.

- [ ] **Step 4: Run — PASS + commit**

```bash
git add elixir/lib/symphony_elixir/claude/app_server/tool_gateway.ex \
  elixir/test/symphony_elixir/claude/app_server/tool_gateway_test.exs \
  elixir/lib/symphony_elixir/assistant/user_input_http.ex  # if split
git commit -m "feat(claude): expose loopback user-input await on ToolGateway"
```

---

### Task 4: Hook runner + settings writer

**Files:**
- Create: `elixir/priv/claude/ask_user_hook.sh`
- Create: `elixir/lib/symphony_elixir/claude/ask_user_hook.ex`
- Test: `elixir/test/symphony_elixir/claude/ask_user_hook_test.exs`

- [ ] **Step 1: Failing test for settings payload + deny stdout helper**

```elixir
test "write_settings! installs PreToolUse matcher and returns settings path" do
  dir = Path.join(System.tmp_dir!(), "ask-user-hook-#{System.unique_integer([:positive])}")
  File.mkdir_p!(dir)

  {:ok, path} =
    AskUserHook.write_settings!(dir,
      session_token: "tok",
      gateway_base_url: "http://127.0.0.1:9999",
      timeout_ms: 1000
    )

  assert File.exists?(path)
  {:ok, json} = Jason.decode(File.read!(path))
  hooks = get_in(json, ["hooks", "PreToolUse"])
  assert is_list(hooks)
  assert Enum.any?(hooks, fn h -> h["matcher"] == "AskUserQuestion" end)
end

test "allow_payload builds hookSpecificOutput" do
  payload =
    AskUserHook.allow_payload(%{
      "questions" => [%{"question" => "Q?"}],
      "answers" => %{"Q?" => "A"}
    })

  assert get_in(payload, ["hookSpecificOutput", "permissionDecision"]) == "allow"
  assert get_in(payload, ["hookSpecificOutput", "updatedInput", "answers", "Q?"]) == "A"
end
```

- [ ] **Step 2: Implement `AskUserHook` + shell script**

`ask_user_hook.sh` (must be executable):

```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
if [[ "$TOOL_NAME" != "AskUserQuestion" ]]; then
  exit 0
fi

REQUEST_ID=$(printf '%s' "$INPUT" | jq -r '.tool_use_id // .tool_input.id // ("ask-" + (now|tostring))')
# Prefer tool_use_id from PreToolUse event; fallback uuid from env
REQUEST_ID=${REQUEST_ID:-$SYMPHONY_ASK_USER_FALLBACK_ID}
QUESTIONS=$(printf '%s' "$INPUT" | jq -c '.tool_input.questions // []')

RESP=$(curl -sS -X POST \
  -H 'content-type: application/json' \
  --max-time "${SYMPHONY_ASK_USER_TIMEOUT_SEC:-300}" \
  -d "$(jq -nc --arg id "$REQUEST_ID" --argjson qs "$QUESTIONS" '{request_id:$id, questions:$qs}')" \
  "${SYMPHONY_ASK_USER_URL}")

DECISION=$(printf '%s' "$RESP" | jq -r '.permissionDecision // empty')
if [[ "$DECISION" == "allow" ]]; then
  UPDATED=$(printf '%s' "$RESP" | jq -c '.updatedInput')
  jq -nc --argjson updated "$UPDATED" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:$updated}}'
  exit 0
fi

REASON=$(printf '%s' "$RESP" | jq -r '.permissionDecisionReason // "Operator input unavailable"')
jq -nc --arg reason "$REASON" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
exit 0
```

`AskUserHook.write_settings!/2` writes JSON:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "<absolute path to priv script with env exports inlined or wrapper>"
          }
        ]
      }
    ]
  }
}
```

Prefer writing a tiny wrapper next to settings that exports `SYMPHONY_ASK_USER_URL=http://127.0.0.1:<port>/user-input/<token>` then `exec` the priv script — so Claude's settings JSON stays small and path-safe.

- [ ] **Step 3: PASS + commit**

```bash
git add elixir/priv/claude/ask_user_hook.sh \
  elixir/lib/symphony_elixir/claude/ask_user_hook.ex \
  elixir/test/symphony_elixir/claude/ask_user_hook_test.exs
git commit -m "feat(claude): add AskUserQuestion PreToolUse hook runner"
```

---

### Task 5: Wire Claude CodingAgent + CliRunner settings

**Files:**
- Modify: `elixir/lib/symphony_elixir/claude/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex`
- Test: `elixir/test/symphony_elixir/claude/coding_agent_test.exs` (extend)

- [ ] **Step 1: Fail test — interactive session writes settings when channel binding provided**

```elixir
test "interactive session installs AskUserQuestion settings when ask_user_session is set" do
  # start_session with interactive_user_input: true and
  # ask_user_session: %{token: ..., gateway_base_url: ..., channel_pid: self(), thread_id: 1}
  # assert session.settings_path is binary and File.exists?
  # stop_session removes settings and unbinds token
end
```

Non-interactive session must have `settings_path: nil`.

- [ ] **Step 2: Implement**

Extend session map with `settings_path` and `ask_user_token`.

In `start_session/2`, after gateway registration, when `interactive?(opts)` and `Keyword.get(opts, :ask_user_session)` is a map:

1. `UserInputBroker.bind_session(token, …)`
2. `AskUserHook.write_settings!(workspace, …)`
3. Store paths/token on session

In `stop_session/1`: `File.rm(settings_path)`, `UserInputBroker.unbind_session(token)`.

In `turn_args/3` / `CliRunner.build_args/1`: append ` --settings #{path}` when present (sanitize path: must be absolute under tmp/workspace; reject shell metacharacters).

Channel / AgentSession must pass `ask_user_session` into runner opts — see Task 6.

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(claude): install PreToolUse settings for interactive AskUserQuestion"
```

---

### Task 6: AssistantChannel routing + session binding on turn start

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex` (if needed to forward `ask_user_session`)
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Failing channel test**

Mirror existing user-questions test; for Claude:

1. Start a fake turn with `agent_kind: "claude"`.
2. Ensure broker session is bound (either by turn start or test setup).
3. Push `user_input_required` via `send(channel, {:assistant_user_input_required, …})`.
4. `submit_user_input` → assert `UserInputBroker.resolve` unblocks an `await` (no `{:codex_user_input}` sent).
5. Existing Codex test still greps for `{:codex_user_input, …}`.

- [ ] **Step 2: Implement `submit_user_input` branch**

```elixir
def handle_in("submit_user_input", %{"request_id" => request_id, "answers" => answers}, socket)
    when is_map(answers) do
  if socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) do
    {:reply, {:error, %{reason: "ActiveTurnNotAwaitingInput"}}, socket}
  else
    pending = socket.assigns[:pending_user_inputs] || %{}
    {questions, rest} = Map.pop(pending, request_id, [])
    normalized = normalize_user_answers(answers)

    maybe_persist_user_questions(socket, questions, answers)
    deliver_user_input(socket, request_id, normalized)

    {:reply, :ok, assign(socket, :pending_user_inputs, rest)}
  end
end

defp deliver_user_input(socket, request_id, normalized) do
  case current_turn_agent(socket) do
    "claude" ->
      UserInputBroker.resolve(request_id, normalized)

    _ ->
      send(socket.assigns.turn_pid, {:codex_user_input, request_id, normalized, self()})
  end
end
```

`current_turn_agent/1`: read `History.current_turn(thread)["agent_kind"]` normalized, default `"codex"`.

- [ ] **Step 3: Pass ask_user_session into Claude turns**

In `turn_stream_opts/4`, when effective agent is `"claude"`:

```elixir
|> maybe_put_ask_user_session(socket, thread, channel_pid)
```

`maybe_put_ask_user_session` generates a token, resolves ToolGateway base URL from `:persistent_term`, and puts:

```elixir
ask_user_session: %{
  token: token,
  gateway_base_url: "http://127.0.0.1:#{port}",
  channel_pid: channel_pid,
  thread_id: thread.id
}
```

Ensure `AgentSession.default_runner/4` / Claude `start_session` receives this opt (thread through existing `opts` KW list — already forwarded to `CodingAgent.run_turn` / `start_session`).

On `reset_turn/1` / turn completion: unbind token if stored on socket assigns (`:ask_user_token`).

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(assistant): route Claude user_input submits through UserInputBroker"
```

---

### Task 7: End-to-end hook script smoke + verification

**Files:** none new unless needed for fixture.

- [ ] **Step 1: Unit smoke — priv script against ToolGateway**

In test, bind session, POST via `ask_user_hook.sh` with env vars set, resolve from another process, assert stdout JSON has `permissionDecision: allow`.

- [ ] **Step 2: Run focused suites**

```bash
cd elixir && mise exec -- mix test \
  test/symphony_elixir/assistant/user_input_broker_test.exs \
  test/symphony_elixir/assistant/user_question_normalizer_test.exs \
  test/symphony_elixir/claude/ask_user_hook_test.exs \
  test/symphony_elixir/claude/app_server/tool_gateway_test.exs \
  test/symphony_elixir_web/channels/assistant_channel_test.exs \
  test/symphony_elixir/claude/coding_agent_test.exs
```

Expected: PASS

- [ ] **Step 3: Manual check (optional in this session)**

Restart serve, open a Claude workspace turn, ask it to clarify with options, confirm `UserQuestionsCard` appears and turn resumes without **FALHOU**.

- [ ] **Step 4: Final commit if any fixups**

```bash
git commit -m "test(claude): cover AskUserQuestion PreToolUse happy path"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| PreToolUse allow+updatedInput | 4, 5 |
| Shared UserQuestionsCard / channel events | 6 (reuse) |
| UserInputBroker + loopback HTTP | 1, 3 |
| Claude↔UI normalizer | 2 |
| Agent-aware submit routing | 6 |
| Non-interactive: no hook | 5 |
| Codex unchanged | 6 regression |
| Cursor deferred | documented in spec/plan only |
| Approvals unchanged | no edits to ApprovalBroker path |

## Open notes resolved

1. **IPC:** extend ToolGateway Bandit (`POST /user-input/:token`), not Phoenix.
2. **Non-interactive:** omit interactive settings entirely.
3. **Hook runner:** `elixir/priv/claude/ask_user_hook.sh` + per-session wrapper beside settings.
