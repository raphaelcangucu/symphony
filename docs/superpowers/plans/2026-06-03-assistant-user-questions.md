# Assistant User Questions (AskUserQuestion-style) Implementation Plan

**Goal:** Let assistant turns pause mid-flight to ask the user structured single-select clarifying questions (Codex `requestUserInput`) and resume with their answers, with a pinned UI card and persisted Q&A history.

**Architecture:** Unlock the native Codex `item/tool/requestUserInput` protocol for assistant turns. When a non-approval request arrives and the turn is flagged interactive, `CodingAgent` emits a `:user_input_required` event and defers the JSON-RPC reply. `CodexSession` relays it; `AssistantChannel` pushes it to the UI and, on the user's answer, sends `{:codex_user_input, ...}` to the running turn process (symmetric to the existing steering mechanism), which writes the reply to the Codex port and resumes the turn.

**Tech Stack:** Elixir/Phoenix (Ecto, Phoenix.Channel, Port/JSON-RPC over stdio), React + TypeScript (Vite, Vitest, Testing Library), `phoenix` JS client.

**Spec:** `docs/superpowers/specs/2026-06-03-assistant-user-questions-design.md`

---

## File Structure

**Backend (Elixir)**
- Modify `elixir/lib/symphony_elixir/codex/coding_agent.ex` — interactive flag in `turn_ctx`, classify clarifying vs approval, defer + resume in `receive_loop`.
- Modify `elixir/lib/symphony_elixir/assistant/codex_session.ex` — relay `:user_input_required` event to `on_user_input_required` callback.
- Modify `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — push event, `submit_user_input` handler, persistence, turn reset cleanup.
- Modify `elixir/test/symphony_elixir/app_server_test.exs` — interactive defer/resume test.
- Modify `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs` — `submit_user_input` forward + persistence test.

**Frontend (React/TS)**
- Modify `tracker/src/services/assistant.ts` — `UserQuestion`, `UserQuestionsRequest` types.
- Modify `tracker/src/services/phoenix/assistantChannel.ts` — bind `user_input_required`, `submitUserInput` push.
- Create `tracker/src/components/assistant/UserQuestionsCard.tsx` — pinned question card.
- Create `tracker/src/components/assistant/__tests__/UserQuestionsCard.test.tsx`.
- Modify `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts` — binding test.
- Modify `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — wire pending question state, render card, history rendering (and replicate wiring to `FreeformAssistantPanel.tsx` / `IssueAuthoringPanel.tsx` if they bind the channel independently).

**Answer contract across layers (single source of truth):**
- Client → channel: `{ request_id, answers: { [questionId]: string } }` where the string is the selected option `label`, or the free text for an "Other"/freeform answer.
- Channel → `CodingAgent`: `{:codex_user_input, request_id, normalized, reply_to}` where `normalized = %{questionId => %{"answers" => [value]}}`.
- `CodingAgent` → Codex port: `%{"id" => request_id, "result" => %{"answers" => normalized}}`.

---

## Task 1: CodingAgent — defer clarifying questions and resume on answer

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- Test: `elixir/test/symphony_elixir/app_server_test.exs`

- [ ] **Step 1: Write the failing test**

Add this test to `elixir/test/symphony_elixir/app_server_test.exs` (mirror the existing fake-codex harness used by the "auto-approves" / "non-interactive" tests above it; `AppServer` is the test alias for `SymphonyElixir.Codex.CodingAgent`). The fake script blocks on its next `read` after emitting `requestUserInput`, so it only proceeds to `turn/completed` once `CodingAgent` writes the answer reply.

```elixir
test "app server surfaces clarifying questions interactively and resumes after the operator answers" do
  test_root =
    Path.join(
      System.tmp_dir!(),
      "symphony-elixir-app-server-interactive-user-input-#{System.unique_integer([:positive])}"
    )

  try do
    workspace_root = Path.join(test_root, "workspaces")
    workspace = Path.join(workspace_root, "MT-719")
    codex_binary = Path.join(test_root, "fake-codex")
    trace_file = Path.join(test_root, "codex-interactive.trace")
    System.put_env("SYMP_TEST_CODEx_TRACE", trace_file)
    on_exit(fn -> System.delete_env("SYMP_TEST_CODEx_TRACE") end)
    File.mkdir_p!(workspace)

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="${SYMP_TEST_CODEx_TRACE:-/tmp/codex-interactive.trace}"
    count=0
    while IFS= read -r line; do
      count=$((count + 1))
      printf 'JSON:%s\\n' \"$line\" >> \"$trace_file\"

      case \"$count\" in
        1)
          printf '%s\\n' '{\"id\":1,\"result\":{}}'
          ;;
        2)
          ;;
        3)
          printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-719\"}}}'
          ;;
        4)
          printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-719\"}}}'
          printf '%s\\n' '{\"id\":112,\"method\":\"item/tool/requestUserInput\",\"params\":{\"itemId\":\"call-719\",\"questions\":[{\"header\":\"Choose an action\",\"id\":\"options-719\",\"isOther\":false,\"isSecret\":false,\"options\":[{\"description\":\"Use the default behavior.\",\"label\":\"Use default\"},{\"description\":\"Skip this step.\",\"label\":\"Skip\"}],\"question\":\"How should I proceed?\"}],\"threadId\":\"thread-719\",\"turnId\":\"turn-719\"}}'
          ;;
        5)
          printf '%s\\n' '{\"method\":\"turn/completed\"}'
          exit 0
          ;;
        *)
          exit 0
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)

    write_workflow_file!(Workflow.workflow_file_path(),
      workspace_root: workspace_root,
      command: "#{codex_binary} app-server",
      codex_approval_policy: "never"
    )

    issue = %Issue{
      id: "issue-interactive-user-input",
      identifier: "MT-719",
      title: "Interactive clarifying question",
      description: "Ensure clarifying questions pause the turn",
      state: "In Progress",
      url: "https://example.org/issues/MT-719",
      labels: ["backend"]
    }

    test_pid = self()

    on_message = fn message ->
      case message do
        %{event: :user_input_required} = m -> send(test_pid, {:user_input_required, m})
        _ -> :ok
      end
    end

    task =
      Task.async(fn ->
        AppServer.run(workspace, "Ask me something", issue,
          on_message: on_message,
          interactive_user_input: true
        )
      end)

    assert_receive {:user_input_required, %{request_id: 112, questions: [%{"id" => "options-719"}]}}, 5_000

    send(task.pid, {:codex_user_input, 112, %{"options-719" => %{"answers" => ["Use default"]}}, test_pid})

    assert {:ok, _result} = Task.await(task, 10_000)
    assert_receive {:user_input_ok, 112}, 5_000

    trace = File.read!(trace_file)

    assert Enum.any?(String.split(trace, "\n", trim: true), fn line ->
             String.starts_with?(line, "JSON:") and
               (line
                |> String.trim_leading("JSON:")
                |> Jason.decode!()
                |> get_in(["result", "answers", "options-719", "answers"])) == ["Use default"]
           end)
  after
    File.rm_rf(test_root)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/app_server_test.exs -k "surfaces clarifying questions interactively"`
Expected: FAIL — the turn auto-answers with the non-interactive string (no `:user_input_required` event), so `assert_receive {:user_input_required, ...}` times out.

- [ ] **Step 3: Carry the interactive flag in `turn_ctx`**

In `run_single_turn/6`, extend the `turn_ctx` map (currently created with `thread_id`, `turn_id`, `next_id`, `pending`):

```elixir
        turn_ctx = %{
          thread_id: thread_id,
          turn_id: turn_id,
          next_id: @steer_base_id,
          pending: %{},
          interactive_user_input: Keyword.get(opts, :interactive_user_input, false)
        }
```

- [ ] **Step 4: Add the resume clause to `receive_loop/7`**

In `receive_loop/7`, add a new clause alongside the existing `{:codex_steer, ...}` and `{:codex_interrupt}` clauses:

```elixir
      {:codex_user_input, request_id, answers, reply_to} ->
        send_message(port, %{"id" => request_id, "result" => %{"answers" => answers}})
        if is_pid(reply_to), do: send(reply_to, {:user_input_ok, request_id})
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)
```

- [ ] **Step 5: Pass the flag into approval handling and handle the deferred status**

In `handle_turn_method/9`, change the `maybe_handle_approval_request(...)` call to pass the interactive flag as a final argument, and add the `:awaiting_user_input` branch to the result `case`:

```elixir
    case maybe_handle_approval_request(
           port,
           method,
           payload,
           payload_string,
           on_message,
           metadata,
           tool_executor,
           auto_approve_requests,
           Map.get(turn_ctx, :interactive_user_input, false)
         ) do
      :input_required ->
        emit_message(
          on_message,
          :turn_input_required,
          %{payload: payload, raw: payload_string},
          metadata
        )

        {:error, {:turn_input_required, payload}}

      :awaiting_user_input ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      :approved ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)
```

(Leave the existing `:approval_required` and `:unhandled` branches unchanged.)

- [ ] **Step 6: Add the interactive param to every `maybe_handle_approval_request` clause**

All clauses must share the new arity. Add `_interactive_user_input` as the final parameter to the four non-question clauses (`"item/commandExecution/requestApproval"`, `"item/tool/call"`, `"item/fileChange/requestApproval"`, and the catch-all that returns `:unhandled`). For the `"item/tool/requestUserInput"` clause, accept and forward it:

```elixir
  defp maybe_handle_approval_request(
         port,
         "item/tool/requestUserInput",
         %{"id" => id, "params" => params} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    maybe_auto_answer_tool_request_user_input(
      port,
      id,
      params,
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end
```

- [ ] **Step 7: Rewrite `maybe_auto_answer_tool_request_user_input` to classify and defer**

Replace the two existing `maybe_auto_answer_tool_request_user_input/8` clauses (the `true` and `false` `auto_approve_requests` heads) with a single `/9` clause that adds the interactive branch:

```elixir
  defp maybe_auto_answer_tool_request_user_input(
         port,
         id,
         params,
         payload,
         payload_string,
         on_message,
         metadata,
         auto_approve_requests,
         interactive_user_input
       ) do
    approval = tool_request_user_input_approval_answers(params)

    cond do
      auto_approve_requests and match?({:ok, _, _}, approval) ->
        {:ok, answers, decision} = approval
        send_message(port, %{"id" => id, "result" => %{"answers" => answers}})

        emit_message(
          on_message,
          :approval_auto_approved,
          %{payload: payload, raw: payload_string, decision: decision},
          metadata
        )

        :approved

      interactive_user_input ->
        emit_message(
          on_message,
          :user_input_required,
          %{
            payload: payload,
            raw: payload_string,
            request_id: id,
            item_id: Map.get(params, "itemId"),
            questions: Map.get(params, "questions") || []
          },
          metadata
        )

        :awaiting_user_input

      true ->
        reply_with_non_interactive_tool_input_answer(
          port,
          id,
          params,
          payload,
          payload_string,
          on_message,
          metadata
        )
    end
  end
```

(Keep `tool_request_user_input_approval_answers/1`, `reply_with_non_interactive_tool_input_answer/7`, and the other helpers unchanged.)

- [ ] **Step 8: Run the new test and the existing requestUserInput tests**

Run: `cd elixir && mix test test/symphony_elixir/app_server_test.exs`
Expected: PASS — the new interactive test passes; the existing "auto-approves MCP tool approval prompts" and "non-interactive answer" tests still pass (approval still auto-answers; non-interactive turns, which don't pass `interactive_user_input`, still get the generic answer).

- [ ] **Step 9: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/coding_agent.ex elixir/test/symphony_elixir/app_server_test.exs
git commit -m "feat(assistant): defer Codex clarifying questions for interactive turns"
```

---

## Task 2: CodexSession — relay the user-input event

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex`

> The `interactive_user_input` and `on_user_input_required` options flow through automatically: the channel puts them in `opts`, each `run_*_turn` keeps them in `runner_opts`, and `default_runner` forwards `opts` into `CodingAgent.run_turn`. The only change needed here is relaying the event to the callback.

- [ ] **Step 1: Add the relay branch**

In `relay_codex_event/3`, add a branch to the `cond` (after the `tool_call_completed` branch, before the `true ->` fallthrough):

```elixir
      Map.get(message, :event) == :user_input_required ->
        maybe_call(opts, :on_user_input_required, %{
          request_id: Map.get(message, :request_id),
          item_id: Map.get(message, :item_id),
          questions: Map.get(message, :questions) || []
        })
```

- [ ] **Step 2: Verify it compiles and existing assistant tests pass**

Run: `cd elixir && mix compile --warnings-as-errors && mix test test/symphony_elixir/assistant`
Expected: PASS (no behavior change for turns that don't set `on_user_input_required`; `maybe_call` is a no-op when the callback is absent).

- [ ] **Step 3: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex
git commit -m "feat(assistant): relay user_input_required to session callback"
```

---

## Task 3: AssistantChannel — push questions, accept answers, persist Q&A

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

- [ ] **Step 1: Write the failing test**

Add this test to `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs` (mirror the existing `steer_turn` test setup — injected `assistant_runner`, issue topic so a thread exists for persistence):

```elixir
test "submit_user_input forwards normalized answers to the running turn and persists the Q&A" do
  test_pid = self()

  runner = fn _workspace, _prompt, _issue, opts ->
    Keyword.fetch!(opts, :on_turn_started).("turn-q")

    Keyword.fetch!(opts, :on_user_input_required).(%{
      request_id: 112,
      item_id: "call-q",
      questions: [
        %{
          "id" => "q1",
          "header" => "Pick one",
          "question" => "How should I proceed?",
          "isOther" => false,
          "isSecret" => false,
          "options" => [%{"label" => "Use default", "description" => "default"}]
        }
      ]
    })

    send(test_pid, {:runner, self()})

    receive do
      {:codex_user_input, request_id, answers, reply_to} ->
        send(test_pid, {:answered, request_id, answers})
        send(reply_to, {:user_input_ok, request_id})
    after
      2_000 -> :ok
    end

    {:ok, %{assistant_message: "done", turn_id: "turn-q", tool_calls: []}}
  end

  Application.put_env(:symphony_elixir, :assistant_runner, runner)

  {:ok, _join, socket} =
    socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
    |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:issue:macro-markets:MAC-1")

  assert_push("history_loaded", %{})

  ref = push(socket, "send_message", %{"message" => "go", "context" => %{"view" => "board"}})
  assert_reply(ref, :ok, %{})
  assert_receive {:runner, _pid}, 2_000

  assert_push("user_input_required", %{request_id: 112, questions: [%{"id" => "q1"}]})

  sref = push(socket, "submit_user_input", %{"request_id" => 112, "answers" => %{"q1" => "Use default"}})
  assert_reply(sref, :ok, %{})

  assert_receive {:answered, 112, %{"q1" => %{"answers" => ["Use default"]}}}, 2_000
  assert_push("message_created", %{message: %{metadata: %{"kind" => "user_questions"}}})
  assert_push("assistant_completed", %{message: %{role: "assistant", content: "done"}})
end

test "submit_user_input replies error when no turn is running" do
  {:ok, _join, socket} =
    socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
    |> subscribe_and_join(SymphonyElixirWeb.AssistantChannel, "assistant:macro-markets")

  assert_push("history_loaded", %{messages: []})

  ref = push(socket, "submit_user_input", %{"request_id" => 1, "answers" => %{"q1" => "A"}})
  assert_reply(ref, :error, %{reason: "ActiveTurnNotAwaitingInput"})
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs -k "submit_user_input"`
Expected: FAIL — `submit_user_input` is not handled; `on_user_input_required` is not wired, so `user_input_required` is never pushed.

- [ ] **Step 3: Wire the interactive opts when starting a turn**

In `do_send_message/3`, in the `opts` keyword pipeline (after the `:on_turn_started` line), add:

```elixir
          |> Keyword.put(:interactive_user_input, true)
          |> Keyword.put(:on_user_input_required, fn request ->
            send(channel_pid, {:assistant_user_input_required, request})
          end)
```

- [ ] **Step 4: Store + push the questions on the channel process**

Add a `handle_info` clause (next to the other `handle_info` clauses, before the catch-all):

```elixir
  def handle_info({:assistant_user_input_required, %{request_id: request_id, questions: questions}}, socket) do
    pending = Map.put(socket.assigns[:pending_user_inputs] || %{}, request_id, questions)
    push(socket, "user_input_required", %{request_id: request_id, questions: questions})
    {:noreply, assign(socket, :pending_user_inputs, pending)}
  end

  def handle_info({:user_input_ok, _request_id}, socket), do: {:noreply, socket}
```

- [ ] **Step 5: Handle `submit_user_input`**

Add these `handle_in` clauses (next to `steer_turn`):

```elixir
  def handle_in("submit_user_input", %{"request_id" => request_id, "answers" => answers}, socket)
      when is_map(answers) do
    if socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) do
      {:reply, {:error, %{reason: "ActiveTurnNotAwaitingInput"}}, socket}
    else
      pending = socket.assigns[:pending_user_inputs] || %{}
      {questions, rest} = Map.pop(pending, request_id, [])

      maybe_persist_user_questions(socket, questions, answers)
      send(socket.assigns.turn_pid, {:codex_user_input, request_id, normalize_user_answers(answers), self()})

      {:reply, :ok, assign(socket, :pending_user_inputs, rest)}
    end
  end

  def handle_in("submit_user_input", _payload, socket),
    do: {:reply, {:error, %{reason: "answers are required"}}, socket}
```

- [ ] **Step 6: Add the answer normalization + persistence helpers**

Add these private helpers (near `maybe_persist_steer/2`):

```elixir
  defp normalize_user_answers(answers) when is_map(answers) do
    Map.new(answers, fn {question_id, value} -> {question_id, %{"answers" => [to_string(value)]}} end)
  end

  defp maybe_persist_user_questions(socket, questions, answers) do
    case resolve_user_questions_thread(socket) do
      %{id: id} = thread when is_integer(id) ->
        attrs = %{
          role: "user",
          content: user_questions_summary(answers),
          metadata: %{"kind" => "user_questions", "questions" => questions, "answers" => answers}
        }

        case History.append_message(thread, attrs) do
          {:ok, message} ->
            push(socket, "message_created", %{message: History.message_payload(message)})
            :ok

          _ ->
            :ok
        end

      _ ->
        :ok
    end
  end

  defp resolve_user_questions_thread(%Socket{assigns: %{thread: %{id: id} = thread}}) when is_integer(id),
    do: thread

  defp resolve_user_questions_thread(%Socket{assigns: %{project_slug: slug}}) when is_binary(slug) do
    case History.ensure_thread(slug, %{}) do
      {:ok, thread} -> thread
      _ -> nil
    end
  end

  defp resolve_user_questions_thread(_socket), do: nil

  defp user_questions_summary(answers) when is_map(answers) do
    count = map_size(answers)
    "Answered #{count} clarifying question" <> if(count == 1, do: ".", else: "s.")
  end
```

- [ ] **Step 7: Clear pending questions on turn reset**

In `reset_turn/1`, add a final assign:

```elixir
  defp reset_turn(socket) do
    socket
    |> assign(:turn_status, :idle)
    |> assign(:turn_pid, nil)
    |> assign(:turn_ref, nil)
    |> assign(:codex_turn_id, nil)
    |> assign(:pending_user_inputs, %{})
  end
```

- [ ] **Step 8: Run the channel tests**

Run: `cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs`
Expected: PASS — both new tests pass and the existing channel tests are unaffected.

- [ ] **Step 9: Commit**

```bash
git add elixir/lib/symphony_elixir_web/channels/assistant_channel.ex elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs
git commit -m "feat(assistant): channel support for user questions and answers"
```

---

## Task 4: Frontend types + channel binding

**Files:**
- Modify: `tracker/src/services/assistant.ts`
- Modify: `tracker/src/services/phoenix/assistantChannel.ts`
- Test: `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts`

- [ ] **Step 1: Write the failing binding test**

In `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts`, add a test inside the `describe("assistant channel binding", ...)` block:

```ts
it("normalizes user_input_required questions", () => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  const channel = { on: (event: string, cb: (payload: unknown) => void) => (handlers[event] = cb) } as never;
  const onUserInputRequired = vi.fn();

  bindAssistantEvents(channel, {
    onHistoryLoaded: vi.fn(),
    onMessageCreated: vi.fn(),
    onAssistantDelta: vi.fn(),
    onToolCallStarted: vi.fn(),
    onToolCallCompleted: vi.fn(),
    onAssistantCompleted: vi.fn(),
    onAssistantError: vi.fn(),
    onUserInputRequired,
  });

  handlers["user_input_required"]({
    request_id: 112,
    questions: [
      { id: "q1", header: "Pick one", question: "How?", isOther: false, isSecret: false, options: [{ label: "A", description: "first" }] },
    ],
  });

  expect(onUserInputRequired).toHaveBeenCalledWith({
    requestId: 112,
    questions: [
      { id: "q1", header: "Pick one", question: "How?", isOther: false, isSecret: false, options: [{ label: "A", description: "first" }] },
    ],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/phoenix/__tests__/assistantChannel.test.ts`
Expected: FAIL — `onUserInputRequired` is not a known handler and `user_input_required` is not bound.

- [ ] **Step 3: Add the types**

In `tracker/src/services/assistant.ts`, add (after the `AssistantChatMessage` interface):

```ts
export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserQuestionOption[] | null;
}

export interface UserQuestionsRequest {
  requestId: string | number;
  questions: UserQuestion[];
}

export function normalizeUserQuestionsRequest(payload: {
  request_id?: string | number | null;
  requestId?: string | number | null;
  questions?: unknown;
}): UserQuestionsRequest | null {
  const requestId = payload.requestId ?? payload.request_id;
  if (requestId == null) return null;

  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  const questions = rawQuestions
    .map((raw): UserQuestion | null => {
      const q = raw as Record<string, unknown>;
      const id = typeof q.id === "string" ? q.id : null;
      if (!id) return null;

      const options = Array.isArray(q.options)
        ? q.options
            .map((opt) => {
              const o = opt as Record<string, unknown>;
              return typeof o.label === "string"
                ? { label: o.label, description: typeof o.description === "string" ? o.description : undefined }
                : null;
            })
            .filter((opt): opt is UserQuestionOption => opt !== null)
        : null;

      return {
        id,
        header: typeof q.header === "string" ? q.header : "",
        question: typeof q.question === "string" ? q.question : "",
        isOther: q.isOther === true,
        isSecret: q.isSecret === true,
        options,
      };
    })
    .filter((q): q is UserQuestion => q !== null);

  return { requestId, questions };
}
```

- [ ] **Step 4: Bind the event and add the push helper**

In `tracker/src/services/phoenix/assistantChannel.ts`:

Add the import:

```ts
import {
  normalizeAssistantChatMessage,
  normalizeToolCall,
  normalizeUserQuestionsRequest,
  type AssistantChatMessage,
  type AssistantToolCall,
  type BackendAssistantChatMessageDto,
  type UserQuestionsRequest,
} from "@/services/assistant";
```

Add the handler to the `AssistantChannelHandlers` interface:

```ts
  onUserInputRequired?: (request: UserQuestionsRequest) => void;
```

Add the binding inside `bindAssistantEvents` (next to the `steer_failed` binding):

```ts
  channel.on("user_input_required", (payload) => {
    const request = normalizeUserQuestionsRequest(payload as Parameters<typeof normalizeUserQuestionsRequest>[0]);
    if (request) handlers.onUserInputRequired?.(request);
  });
```

Add an exported push helper at the end of the file:

```ts
export function submitUserInput(
  channel: Channel,
  requestId: string | number,
  answers: Record<string, string>,
): void {
  channel.push("submit_user_input", { request_id: requestId, answers });
}
```

- [ ] **Step 5: Run the test**

Run: `cd tracker && npx vitest run src/services/phoenix/__tests__/assistantChannel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/services/assistant.ts tracker/src/services/phoenix/assistantChannel.ts tracker/src/services/phoenix/__tests__/assistantChannel.test.ts
git commit -m "feat(assistant): client types and binding for user questions"
```

---

## Task 5: UserQuestionsCard component

**Files:**
- Create: `tracker/src/components/assistant/UserQuestionsCard.tsx`
- Test: `tracker/src/components/assistant/__tests__/UserQuestionsCard.test.tsx`

> Verify the import paths `@/components/ui/button` and `@/lib/utils` (`cn`) exist in the repo (they follow the shadcn convention used elsewhere). If `Button` is not present, use a plain `<button className="...">` instead.

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/UserQuestionsCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserQuestionsCard } from "../UserQuestionsCard";
import type { UserQuestionsRequest } from "@/services/assistant";

const optionsRequest: UserQuestionsRequest = {
  requestId: 112,
  questions: [
    {
      id: "q1",
      header: "Pick one",
      question: "How should I proceed?",
      isOther: false,
      isSecret: false,
      options: [
        { label: "Use default", description: "default behavior" },
        { label: "Skip", description: "skip it" },
      ],
    },
  ],
};

describe("UserQuestionsCard", () => {
  it("disables submit until answered, then submits the selected label", async () => {
    const onSubmit = vi.fn();
    render(<UserQuestionsCard request={optionsRequest} onSubmit={onSubmit} />);

    const submit = screen.getByRole("button", { name: /submit answers/i });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Use default/i));
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(112, { q1: "Use default" });
  });

  it("supports an Other free-text answer", async () => {
    const onSubmit = vi.fn();
    const request: UserQuestionsRequest = {
      requestId: 1,
      questions: [{ ...optionsRequest.questions[0], isOther: true }],
    };
    render(<UserQuestionsCard request={request} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByLabelText(/^Other$/i));
    await userEvent.type(screen.getByPlaceholderText(/type your answer/i), "custom path");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(onSubmit).toHaveBeenCalledWith(1, { q1: "custom path" });
  });

  it("renders a free-text input for freeform questions (null options)", async () => {
    const onSubmit = vi.fn();
    const request: UserQuestionsRequest = {
      requestId: 2,
      questions: [
        { id: "f1", header: "Context", question: "What comment?", isOther: false, isSecret: false, options: null },
      ],
    };
    render(<UserQuestionsCard request={request} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/type your answer/i), "post this");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(onSubmit).toHaveBeenCalledWith(2, { f1: "post this" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/UserQuestionsCard.test.tsx`
Expected: FAIL — `UserQuestionsCard` does not exist.

- [ ] **Step 3: Create the component**

Create `tracker/src/components/assistant/UserQuestionsCard.tsx`:

```tsx
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserQuestion, UserQuestionsRequest } from "@/services/assistant";

const OTHER_VALUE = "__other__";

interface UserQuestionsCardProps {
  request: UserQuestionsRequest;
  onSubmit: (requestId: string | number, answers: Record<string, string>) => void;
  disabled?: boolean;
}

interface DraftAnswer {
  selected: string | null;
  otherText: string;
  freeformText: string;
}

function emptyDraft(): DraftAnswer {
  return { selected: null, otherText: "", freeformText: "" };
}

function isFreeform(question: UserQuestion): boolean {
  return question.options == null || question.options.length === 0;
}

function answerValue(question: UserQuestion, draft: DraftAnswer): string | null {
  if (isFreeform(question)) {
    const text = draft.freeformText.trim();
    return text.length > 0 ? text : null;
  }

  if (draft.selected === OTHER_VALUE) {
    const text = draft.otherText.trim();
    return text.length > 0 ? text : null;
  }

  return draft.selected;
}

export function UserQuestionsCard({ request, onSubmit, disabled }: UserQuestionsCardProps) {
  const { questions } = request;
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, emptyDraft()])),
  );

  const updateDraft = (id: string, patch: Partial<DraftAnswer>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyDraft()), ...patch } }));

  const allAnswered = useMemo(
    () => questions.every((question) => answerValue(question, drafts[question.id] ?? emptyDraft()) != null),
    [questions, drafts],
  );

  const active = questions[activeIndex] ?? questions[0];
  if (!active) return null;
  const draft = drafts[active.id] ?? emptyDraft();

  const handleSubmit = () => {
    if (!allAnswered || disabled) return;

    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = answerValue(question, drafts[question.id] ?? emptyDraft());
      if (value != null) answers[question.id] = value;
    }

    onSubmit(request.requestId, answers);
  };

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="user-questions-card">
      {questions.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {questions.map((question, index) => (
            <button
              key={question.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs",
                index === activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                answerValue(question, drafts[question.id] ?? emptyDraft()) != null ? "ring-1 ring-primary/40" : "",
              )}
            >
              {question.header || `Q${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold">{active.header}</p>
        <p className="text-sm text-muted-foreground">{active.question}</p>

        {isFreeform(active) ? (
          <textarea
            className="w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            value={draft.freeformText}
            onChange={(event) => updateDraft(active.id, { freeformText: event.target.value })}
            placeholder="Type your answer"
            disabled={disabled}
          />
        ) : (
          <div className="space-y-1.5">
            {active.options?.map((option) => (
              <label
                key={option.label}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="radio"
                  name={`uq-${active.id}`}
                  className="mt-0.5"
                  checked={draft.selected === option.label}
                  onChange={() => updateDraft(active.id, { selected: option.label })}
                  disabled={disabled}
                />
                <span className="min-w-0">
                  <span className="font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}

            {active.isOther ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                <input
                  type="radio"
                  name={`uq-${active.id}`}
                  className="mt-0.5"
                  checked={draft.selected === OTHER_VALUE}
                  onChange={() => updateDraft(active.id, { selected: OTHER_VALUE })}
                  disabled={disabled}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Other</span>
                  {draft.selected === OTHER_VALUE ? (
                    <input
                      type="text"
                      className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm"
                      value={draft.otherText}
                      onChange={(event) => updateDraft(active.id, { otherText: event.target.value })}
                      placeholder="Type your answer"
                      disabled={disabled}
                    />
                  ) : null}
                </span>
              </label>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={handleSubmit} disabled={!allAnswered || disabled}>
          Submit answers
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/UserQuestionsCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/UserQuestionsCard.tsx tracker/src/components/assistant/__tests__/UserQuestionsCard.test.tsx
git commit -m "feat(assistant): add UserQuestionsCard component"
```

---

## Task 6: Panel integration + history rendering

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- (Replicate to `tracker/src/components/assistant/FreeformAssistantPanel.tsx` and `IssueAuthoringPanel.tsx` if they call `bindAssistantEvents` independently — see Step 6.)

- [ ] **Step 1: Import the card, types, and push helper**

At the top of `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, add:

```tsx
import { UserQuestionsCard } from "@/components/assistant/UserQuestionsCard";
import type { UserQuestionsRequest } from "@/services/assistant";
```

And add `submitUserInput` to the existing import from `@/services/phoenix/assistantChannel` (the file already imports `bindAssistantEvents` from there).

- [ ] **Step 2: Add pending-questions state**

Near the other `useState`/`useRef` declarations (around the `channelRef` at line 122), add:

```tsx
const [pendingQuestions, setPendingQuestions] = useState<UserQuestionsRequest | null>(null);
```

- [ ] **Step 3: Wire the handler in `bindAssistantEvents`**

In the `bindAssistantEvents(channel, { ... })` call (around line 207), add the handler. Also clear pending questions when a turn completes or errors — locate the existing `onAssistantCompleted` and `onAssistantError` handlers and add `setPendingQuestions(null)` at the start of each:

```tsx
      onUserInputRequired: (request) => {
        setPendingQuestions(request);
      },
```

Example of clearing on completion (merge into the existing handlers, do not duplicate them):

```tsx
      onAssistantCompleted: (message) => {
        setPendingQuestions(null);
        // ...existing completion logic...
      },
      onAssistantError: (message) => {
        setPendingQuestions(null);
        // ...existing error logic...
      },
```

- [ ] **Step 4: Add the submit callback**

Near the `steerTurn` callback (around line 397), add:

```tsx
const submitQuestions = useCallback((requestId: string | number, answers: Record<string, string>) => {
  const channel = channelRef.current;
  if (!channel) return;
  submitUserInput(channel, requestId, answers);
  setPendingQuestions(null);
}, []);
```

- [ ] **Step 5: Render the card pinned above the composer**

The composer is rendered inside a dock (around lines 637–674) with `composerNode`. Render the card directly above `composerNode` in each of the three dock branches (page mode, panel mode, inline mode). For example, in the page-mode dock:

```tsx
              <div className="mx-auto w-full max-w-4xl px-4 pb-2 pt-1">
                {pendingQuestions ? (
                  <div className="mb-2">
                    <UserQuestionsCard request={pendingQuestions} onSubmit={submitQuestions} />
                  </div>
                ) : null}
                {composerNode ?? (
                  // ...existing fallback...
                )}
              </div>
```

Apply the same `pendingQuestions ? <UserQuestionsCard .../> : null` block immediately before `composerNode` in the other two dock branches so the card is pinned above the composer in every layout.

- [ ] **Step 6: Render persisted Q&A in history (read-only)**

Find where history messages are rendered (the `AssistantBubble` / message map). For messages whose `metadata.kind === "user_questions"`, render a compact read-only summary instead of the raw content. Add a small inline renderer near the message map:

```tsx
function isUserQuestionsMessage(message: AssistantChatMessage): boolean {
  return (message.metadata as { kind?: string } | undefined)?.kind === "user_questions";
}

function UserQuestionsReceipt({ message }: { message: AssistantChatMessage }) {
  const meta = message.metadata as { questions?: UserQuestion[]; answers?: Record<string, string> } | undefined;
  const questions = meta?.questions ?? [];
  const answers = meta?.answers ?? {};

  return (
    <div className="rounded-lg bg-muted/60 p-2 text-xs" data-testid="user-questions-receipt">
      {questions.length === 0 ? <div className="font-medium">Answered clarifying questions</div> : null}
      {questions.map((question) => (
        <div key={question.id} className="mb-1 last:mb-0">
          <span className="font-medium">{question.header || question.question}</span>
          <span className="ml-1 text-muted-foreground">→ {answers[question.id] ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
```

(Import `UserQuestion` from `@/services/assistant`.) In the message map, branch on `isUserQuestionsMessage(message)` to render `<UserQuestionsReceipt message={message} />` instead of the default bubble.

- [ ] **Step 7: Replicate to the other panels if needed**

Run: `cd tracker && rg -l "bindAssistantEvents" src/components/assistant`
For every panel that calls `bindAssistantEvents` independently (e.g. `FreeformAssistantPanel.tsx`, `IssueAuthoringPanel.tsx`), repeat Steps 1–6. If those panels render `ProjectAssistantPanel` internally, no change is needed there.

- [ ] **Step 8: Type-check and run the frontend suite**

Run: `cd tracker && npx tsc -b && npx vitest run`
Expected: PASS (no type errors; all assistant tests green).

- [ ] **Step 9: Commit**

```bash
git add tracker/src/components/assistant
git commit -m "feat(assistant): render pinned user questions card and history receipts"
```

---

## Task 7: Full quality gates

**Files:** none (verification only)

- [ ] **Step 1: Elixir gates**

Run: `cd elixir && mix specs.check && make all`
Expected: PASS — format check, credo lint, coverage, dialyzer, and `@spec` presence all pass. (No new public `def` was added — `handle_in`/`handle_info` are `@impl` callbacks and the new helpers are `defp`, so no new `@spec` is required.)

- [ ] **Step 2: Frontend gates**

Run: `cd tracker && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, if a dev server is available)**

Start the assistant, send a message that makes Codex ask a clarifying question (or use a model prompt that triggers `requestUserInput`), confirm the pinned card appears above the composer, answer it, and confirm the turn resumes and the Q&A appears in history on reload.

- [ ] **Step 4: Commit any gate fixups**

```bash
git add -A
git commit -m "chore(assistant): satisfy quality gates for user questions"
```

---

## Self-Review

**Spec coverage:**
- Native Codex trigger + classify approval vs clarifying → Task 1 (Steps 5–7).
- Defer reply / resume symmetric to steering → Task 1 (Steps 4, 7) + Task 3 (Step 5).
- All scopes → mechanism lives in `CodingAgent`/`CodexSession`/channel `do_send_message`, shared by every `run_*_turn` (Tasks 1–3); panel wiring covers project/explore/issue/freeform (Task 6, Step 7).
- Pinned card above composer → Task 6 (Step 5).
- Multiple questions (tabs), single-select radio, descriptions, "Other" free-text, freeform → Task 5.
- Persist Q&A in history → Task 3 (Step 6) + Task 6 (Step 6).
- Keep approval auto-answer unchanged → Task 1 (Step 7, first `cond` branch) + existing tests retained (Task 1, Step 8).
- Error handling: no running turn → `ActiveTurnNotAwaitingInput` (Task 3, Steps 1, 5); unknown `request_id` → empty questions, still forwards (Task 3, Step 5); `isSecret` rendered as text (Task 5 renders options/freeform/Other only, no masking).
- Non-goals respected: no multi-select (radio only), no resilience (no cancel/timeout/refresh), orchestrator untouched (`interactive_user_input` defaults `false`).

**Placeholder scan:** No TBD/TODO; every code step contains complete code; test code is concrete with exact assertions and commands.

**Type/name consistency:** `interactive_user_input`, `on_user_input_required`, event `:user_input_required`, message `{:codex_user_input, request_id, answers, reply_to}`, ack `{:user_input_ok, request_id}`, channel events `user_input_required` / `submit_user_input`, assign `:pending_user_inputs`, client types `UserQuestion`/`UserQuestionOption`/`UserQuestionsRequest`, helpers `normalizeUserQuestionsRequest`/`submitUserInput`, and the answer envelope `%{questionId => %{"answers" => [value]}}` are used consistently across all tasks.
