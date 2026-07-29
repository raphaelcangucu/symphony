# Unified Composer and Turn Rail Implementation Plan

**Goal:** Build one compact Assistant/Execution composer with queue-first active-run behavior, conversation permissions, native goal controls, a consolidated action menu, and Codex-style turn navigation.

**Architecture:** Keep `AssistantComposer` as the proven textarea/attachment engine while extracting a provider-neutral `UnifiedComposer` shell and small focused controls around it. Persist permission in thread metadata, derive provider capabilities in one pure module, and let Assistant/Execution adapters own transport. Add `TurnNavigationRail` beside the existing message list; do not alter the existing per-message `AssistantTurnTimeline`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind, Radix UI, Phoenix/Elixir, Ecto metadata, ExUnit.

---

## Scope and sequencing

The plan is intentionally split into backend contract, pure frontend domain,
focused controls, adapter integration, transcript navigation, and final
regression validation. Every task leaves the tree testable and commits only its
own files. Existing unrelated `mobile/` and `elixir/dev/mobile_e2e_seed.exs`
changes must remain unstaged.

### Task 1: Persist provider-neutral permission on the conversation

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify: `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
- Modify: `tracker/src/types/assistant-thread.ts`
- Modify: `tracker/src/services/assistantThreads.ts`
- Modify: `tracker/src/services/__tests__/assistantThreads.test.ts`

- [ ] **Step 1: Write failing controller and service tests**

Add an ExUnit case that updates and reloads a thread permission:

```elixir
test "PATCH persists permission_level in thread metadata", %{conn: conn, thread: thread} do
  conn =
    patch(conn, ~p"/api/tracker/v1/assistant/threads/#{thread.id}", %{
      "permission_level" => "full_access"
    })

  assert %{"data" => %{"permission_level" => "full_access"}} = json_response(conn, 200)
  assert {:ok, persisted} = History.get_thread(thread.id)
  assert History.thread_permission_level(persisted) == "full_access"
end

test "PATCH rejects an unknown permission_level", %{conn: conn, thread: thread} do
  conn =
    patch(conn, ~p"/api/tracker/v1/assistant/threads/#{thread.id}", %{
      "permission_level" => "unsafe"
    })

  assert %{"error" => %{"message" => message}} = json_response(conn, 422)
  assert message =~ "permission_level"
end
```

Add Vitest coverage for DTO normalization and PATCH payload:

```ts
expect(
  normalizeAssistantThread({
    id: 7,
    scope: "freeform",
    status: "active",
    permission_level: "approve_for_me",
  }),
).toMatchObject({ permissionLevel: "approve_for_me" });

await updateAssistantThread(7, { permissionLevel: "full_access" });
expect(http.patch).toHaveBeenCalledWith(
  "/api/tracker/v1/assistant/threads/7",
  { permission_level: "full_access" },
);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd elixir && mix test test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs
cd tracker && npm test -- src/services/__tests__/assistantThreads.test.ts
```

Expected: ExUnit fails because `permission_level` is not accepted/presented;
Vitest fails because the DTO and update input do not contain the field.

- [ ] **Step 3: Add the metadata contract**

Add to `History`:

```elixir
@permission_levels ~w(ask_for_approval approve_for_me full_access)

@spec thread_permission_level(Thread.t()) :: String.t() | nil
def thread_permission_level(%Thread{metadata: %{"permission_level" => level}})
    when level in @permission_levels,
    do: level

def thread_permission_level(_thread), do: nil

@spec set_thread_permission_level(Thread.t(), String.t()) ::
        {:ok, Thread.t()} | {:error, :invalid_permission_level | term()}
def set_thread_permission_level(%Thread{} = thread, level)
    when level in @permission_levels do
  mutate_metadata(thread, fn current ->
    {:update, Map.put(current.metadata || %{}, "permission_level", level), nil}
  end)
  |> without_mutation_value()
end

def set_thread_permission_level(%Thread{}, _level),
  do: {:error, :invalid_permission_level}
```

Parse `permission_level` in `AssistantThreadController.update/2`, call
`History.set_thread_permission_level/2` after the agent update, and render a
validation message for `:invalid_permission_level`. Present it with:

```elixir
permission_level:
  History.thread_permission_level(thread)
```

Extend the TypeScript contract:

```ts
export type ComposerPermissionLevel =
  | "ask_for_approval"
  | "approve_for_me"
  | "full_access";

export interface AssistantThread {
  // existing fields
  permissionLevel: ComposerPermissionLevel | null;
}
```

Add `permission_level` to `BackendAssistantThreadDto`,
`permissionLevel` to `UpdateAssistantThreadInput`, and normalize only the three
stable values.

- [ ] **Step 4: Run focused backend/frontend tests**

Run the two commands from Step 2.

Expected: both suites pass.

- [ ] **Step 5: Commit the thread contract**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex \
  elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex \
  elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs \
  tracker/src/types/assistant-thread.ts \
  tracker/src/services/assistantThreads.ts \
  tracker/src/services/__tests__/assistantThreads.test.ts
git commit -m "feat(composer): persist conversation permission"
```

### Task 2: Define provider-neutral capabilities and permission mapping

**Files:**
- Create: `tracker/src/lib/composerCapabilities.ts`
- Create: `tracker/src/lib/__tests__/composerCapabilities.test.ts`
- Modify: `tracker/src/lib/agentModes.ts`
- Modify: `tracker/src/lib/__tests__/executionMode.test.ts`

- [ ] **Step 1: Write failing capability tests**

```ts
import {
  composerCapabilitiesFor,
  permissionLevelForMode,
  executionModeForPermission,
} from "@/lib/composerCapabilities";

it("uses full access as the fallback permission", () => {
  expect(composerCapabilitiesFor("codex").defaultPermission).toBe("full_access");
});

it.each(["codex", "claude", "cursor"] as const)(
  "exposes stable permission rows for %s",
  (agent) => {
    expect(composerCapabilitiesFor(agent).permissions.map((entry) => entry.id))
      .toEqual(["ask_for_approval", "approve_for_me", "full_access"]);
  },
);

it("keeps unsupported levels visible and disabled", () => {
  const capabilities = composerCapabilitiesFor("cursor");
  expect(capabilities.permissions).toContainEqual(
    expect.objectContaining({ id: "approve_for_me", available: false }),
  );
});

it("maps legacy execution modes without leaking yolo copy", () => {
  expect(permissionLevelForMode("yolo")).toBe("full_access");
  expect(executionModeForPermission("full_access")).toBe("yolo");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd tracker && npm test -- src/lib/__tests__/composerCapabilities.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure domain module**

```ts
import type { ComposerPermissionLevel } from "@/types/assistant-thread";
import type { AgentKind, ExecutionMode } from "@/types/issue";

export interface ComposerPermissionOption {
  id: ComposerPermissionLevel;
  available: boolean;
  unavailableReason?: string;
}

export interface ComposerCapabilities {
  queue: boolean;
  steer: boolean;
  stop: boolean;
  permissions: readonly ComposerPermissionOption[];
  defaultPermission: ComposerPermissionLevel;
}

const permissionIds: readonly ComposerPermissionLevel[] = [
  "ask_for_approval",
  "approve_for_me",
  "full_access",
];

export function composerCapabilitiesFor(agent: AgentKind): ComposerCapabilities {
  const approveForMeAvailable = agent !== "cursor";
  return {
    queue: true,
    steer: agent === "codex" || agent === "claude",
    stop: true,
    defaultPermission: "full_access",
    permissions: permissionIds.map((id) => ({
      id,
      available: id !== "approve_for_me" || approveForMeAvailable,
      unavailableReason:
        id === "approve_for_me" && !approveForMeAvailable
          ? "Unavailable for this agent"
          : undefined,
    })),
  };
}

export function permissionLevelForMode(mode: ExecutionMode): ComposerPermissionLevel {
  if (mode === "plan") return "ask_for_approval";
  if (mode === "build") return "approve_for_me";
  return "full_access";
}

export function executionModeForPermission(level: ComposerPermissionLevel): ExecutionMode {
  if (level === "ask_for_approval") return "plan";
  if (level === "approve_for_me") return "build";
  return "yolo";
}
```

Update operator-facing metadata in `agentModes.ts` so labels resolve to the
neutral permission copy while transport IDs remain `plan`, `build`, and
`yolo`.

- [ ] **Step 4: Run capability and execution-mode tests**

```bash
cd tracker && npm test -- \
  src/lib/__tests__/composerCapabilities.test.ts \
  src/lib/__tests__/executionMode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit capability normalization**

```bash
git add tracker/src/lib/composerCapabilities.ts \
  tracker/src/lib/__tests__/composerCapabilities.test.ts \
  tracker/src/lib/agentModes.ts \
  tracker/src/lib/__tests__/executionMode.test.ts
git commit -m "feat(composer): normalize agent capabilities"
```

### Task 3: Build the permission menu and registry-backed `+` menu

**Files:**
- Create: `tracker/src/components/assistant/ComposerPermissionMenu.tsx`
- Create: `tracker/src/components/assistant/ComposerAddMenu.tsx`
- Create: `tracker/src/components/assistant/composerActions.ts`
- Create: `tracker/src/components/assistant/__tests__/ComposerPermissionMenu.test.tsx`
- Create: `tracker/src/components/assistant/__tests__/ComposerAddMenu.test.tsx`
- Modify: `tracker/src/locales/en/translation.json`
- Modify: `tracker/src/locales/pt-BR/translation.json`

- [ ] **Step 1: Write failing menu tests**

```tsx
render(
  <ComposerPermissionMenu
    value="full_access"
    options={[
      { id: "ask_for_approval", available: true },
      {
        id: "approve_for_me",
        available: false,
        unavailableReason: "Unavailable for this agent",
      },
      { id: "full_access", available: true },
    ]}
    onChange={onChange}
  />,
);
await user.click(screen.getByRole("button", { name: /full access/i }));
expect(screen.getByRole("menuitemradio", { name: /approve for me/i }))
  .toBeDisabled();
expect(screen.getByText(/unavailable for this agent/i)).toBeVisible();
```

```tsx
render(
  <ComposerAddMenu
    context={{ hasWorkspace: true, supportsGoal: true }}
    handlers={handlers}
  />,
);
await user.click(screen.getByRole("button", { name: /add/i }));
expect(screen.getByRole("menuitem", { name: /files and folders/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /context/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /diff/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /knowledge base/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /magic/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /goal/i })).toBeVisible();
expect(screen.getByRole("menuitem", { name: /commands and skills/i })).toBeVisible();
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/ComposerPermissionMenu.test.tsx \
  src/components/assistant/__tests__/ComposerAddMenu.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the action registry and menus**

Define stable action IDs:

```ts
export type ComposerActionId =
  | "files"
  | "context"
  | "diff"
  | "kb"
  | "magic"
  | "goal"
  | "commands";

export interface ComposerActionContext {
  hasWorkspace: boolean;
  supportsGoal: boolean;
}

export const composerActionIds: readonly ComposerActionId[] = [
  "files",
  "context",
  "diff",
  "kb",
  "magic",
  "goal",
  "commands",
];
```

Implement both menus with the existing Radix `DropdownMenu` wrappers. The
permission menu uses `DropdownMenuRadioItem`; disabled rows include visible
secondary text. `ComposerAddMenu` omits Diff only when `hasWorkspace` is false
and disables Goal when `supportsGoal` is false. Handlers call the existing file
input, context sheet, `GitDiffLauncher`, `KnowledgeBaseModal`, Magic palette,
goal dialog, and slash/skill palette callbacks.

- [ ] **Step 4: Run menu tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit focused controls**

```bash
git add tracker/src/components/assistant/ComposerPermissionMenu.tsx \
  tracker/src/components/assistant/ComposerAddMenu.tsx \
  tracker/src/components/assistant/composerActions.ts \
  tracker/src/components/assistant/__tests__/ComposerPermissionMenu.test.tsx \
  tracker/src/components/assistant/__tests__/ComposerAddMenu.test.tsx \
  tracker/src/locales/en/translation.json \
  tracker/src/locales/pt-BR/translation.json
git commit -m "feat(composer): add compact action menus"
```

### Task 4: Replace queue chips with actionable queued guidance

**Files:**
- Create: `tracker/src/components/assistant/QueuedGuidanceList.tsx`
- Create: `tracker/src/components/assistant/__tests__/QueuedGuidanceList.test.tsx`
- Modify: `tracker/src/components/assistant/queuedMessageStorage.ts`
- Modify: `tracker/src/components/assistant/__tests__/QueuedMessageChips.test.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`

- [ ] **Step 1: Write failing queue interaction tests**

```tsx
render(
  <QueuedGuidanceList
    items={[queuedItem]}
    canSteer
    queueingEnabled
    onPromote={onPromote}
    onResend={onResend}
    onEdit={onEdit}
    onRemove={onRemove}
    onOpenSideChat={onOpenSideChat}
    onQueueingEnabledChange={onQueueingEnabledChange}
  />,
);
expect(screen.getByRole("button", { name: /steer now/i })).toBeVisible();
await user.click(screen.getByRole("button", { name: /steer now/i }));
expect(onPromote).toHaveBeenCalledWith(queuedItem.id);
```

Render again with `canSteer={false}` and assert `Send again` calls `onResend`.
Add a rejection test proving a failed promotion retains the item and shows the
canonical error.

- [ ] **Step 2: Run queue tests and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/QueuedGuidanceList.test.tsx
```

Expected: FAIL because `QueuedGuidanceList` does not exist.

- [ ] **Step 3: Implement stable queued items and actions**

Extend the stored record:

```ts
export interface StoredQueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
  state: "queued" | "promoting" | "failed";
  error: string | null;
  createdAt: string;
}
```

`QueuedGuidanceList` renders one compact row per item with a direct capability
action, remove, and overflow actions for edit, side chat, and queue toggle.
Promotion changes only the matching stable ID. On failure it restores
`state: "queued"` and keeps the payload.

Replace `QueuedMessageChips` in Assistant and the index-keyed execution queue
block with this component. Keep the existing storage key and transport
callbacks so reload behavior is preserved.

- [ ] **Step 4: Run queue and execution composer tests**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/QueuedGuidanceList.test.tsx \
  src/components/assistant/__tests__/QueuedMessageChips.test.tsx \
  src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit queue UI**

```bash
git add tracker/src/components/assistant/QueuedGuidanceList.tsx \
  tracker/src/components/assistant/__tests__/QueuedGuidanceList.test.tsx \
  tracker/src/components/assistant/queuedMessageStorage.ts \
  tracker/src/components/assistant/__tests__/QueuedMessageChips.test.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx
git commit -m "feat(composer): add actionable guidance queue"
```

### Task 5: Extract the unified shell and enforce queue-first keyboard routing

**Files:**
- Create: `tracker/src/components/assistant/UnifiedComposer.tsx`
- Create: `tracker/src/components/assistant/unifiedComposerState.ts`
- Create: `tracker/src/components/assistant/__tests__/UnifiedComposer.test.tsx`
- Create: `tracker/src/components/assistant/__tests__/unifiedComposerState.test.ts`
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx`
- Modify: `tracker/src/components/assistant/ComposerToolbar.tsx`
- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`

- [ ] **Step 1: Write failing state-machine and interaction tests**

```ts
expect(
  deriveUnifiedComposerState({
    runActive: true,
    queueingEnabled: true,
    canSteer: true,
    pending: false,
  }),
).toMatchObject({
  enterIntent: "queue",
  primaryAction: "stop",
});

expect(
  deriveUnifiedComposerState({
    runActive: false,
    queueingEnabled: true,
    canSteer: true,
    pending: false,
  }),
).toMatchObject({
  enterIntent: "send",
  primaryAction: "send",
});
```

In the component test, type text during an active run, press Enter, assert
`onQueue` fires and `onSteer` does not. Click the circular primary button and
assert `onStop`. Press Shift+Enter and assert the draft contains a newline.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/unifiedComposerState.test.ts \
  src/components/assistant/__tests__/UnifiedComposer.test.tsx
```

Expected: FAIL because the shell/state module does not exist.

- [ ] **Step 3: Implement the state model**

```ts
export interface UnifiedComposerStateInput {
  runActive: boolean;
  queueingEnabled: boolean;
  canSteer: boolean;
  pending: boolean;
}

export interface UnifiedComposerState {
  enterIntent: "send" | "queue" | "steer" | "blocked";
  primaryAction: "send" | "stop";
  composerDisabled: boolean;
}

export function deriveUnifiedComposerState(
  input: UnifiedComposerStateInput,
): UnifiedComposerState {
  if (!input.runActive) {
    return {
      enterIntent: "send",
      primaryAction: "send",
      composerDisabled: input.pending,
    };
  }
  if (input.queueingEnabled) {
    return {
      enterIntent: "queue",
      primaryAction: "stop",
      composerDisabled: false,
    };
  }
  return {
    enterIntent: input.canSteer ? "steer" : "blocked",
    primaryAction: "stop",
    composerDisabled: !input.canSteer,
  };
}
```

- [ ] **Step 4: Implement `UnifiedComposer`**

Compose the existing textarea/attachment engine with:

```tsx
<QueuedGuidanceList {...queueProps} />
<UnifiedGoalStrip {...goalProps} />
<AssistantComposer
  {...composerProps}
  persistLocalComposerState={false}
  toolbarAfterAttach={
    <>
      <ComposerPermissionMenu {...permissionProps} />
      <AgentModelEffortMenu {...modelProps} />
    </>
  }
  toolbarBeforeAttach={<ComposerAddMenu {...addMenuProps} />}
  submitActions={
    <ComposerPrimaryAction
      action={state.primaryAction}
      pending={pending}
      onStop={onStop}
    />
  }
  onSubmit={routeSubmit}
/>
```

Move presentation-only toolbar branches out of `AssistantComposer`; keep its
textarea resizing, draft, attachment, mention, slash, Magic, and voice logic
unchanged. Update both caller surfaces to mount `UnifiedComposer`.

- [ ] **Step 5: Run composer suites**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/unifiedComposerState.test.ts \
  src/components/assistant/__tests__/UnifiedComposer.test.tsx \
  src/components/assistant/__tests__/AssistantComposer.test.tsx \
  src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx \
  src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
```

Expected: PASS, including the new queue-first assertion.

- [ ] **Step 6: Commit the unified shell**

```bash
git add tracker/src/components/assistant/UnifiedComposer.tsx \
  tracker/src/components/assistant/unifiedComposerState.ts \
  tracker/src/components/assistant/__tests__/UnifiedComposer.test.tsx \
  tracker/src/components/assistant/__tests__/unifiedComposerState.test.ts \
  tracker/src/components/assistant/AssistantComposer.tsx \
  tracker/src/components/assistant/ComposerToolbar.tsx \
  tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx
git commit -m "refactor(composer): share assistant and execution shell"
```

### Task 6: Reuse native goal controls in a compact strip

**Files:**
- Create: `tracker/src/components/assistant/UnifiedGoalStrip.tsx`
- Create: `tracker/src/components/assistant/__tests__/UnifiedGoalStrip.test.tsx`
- Modify: `tracker/src/components/shared/GoalPill.tsx`
- Modify: `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`
- Modify: `tracker/src/components/assistant/IssueAuthoringPanel.tsx`

- [ ] **Step 1: Write failing goal-control tests**

Render active, paused, editable, and clearable goal states. Assert:

```tsx
expect(screen.getByRole("button", { name: /pause goal/i })).toBeVisible();
expect(screen.getByRole("button", { name: /edit goal/i })).toBeVisible();
expect(screen.getByRole("button", { name: /remove goal/i })).toBeVisible();
```

For a paused goal, assert Resume replaces Pause. For missing capabilities,
assert the corresponding action is absent.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/UnifiedGoalStrip.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the strip as a presentation wrapper**

`UnifiedGoalStrip` accepts the existing `GoalPill` callback contract:

```ts
export interface UnifiedGoalStripProps {
  objective: string | null;
  running: boolean;
  timeUsedSeconds: number | null;
  onPause?: () => void;
  onResume?: () => void;
  onEditObjective?: (objective: string) => void;
  onRemove?: () => void;
}
```

Reuse the existing edit dialog and service callbacks. Render Pause or Play in
the first action slot, then Edit and Remove. Do not render runtime Stop here;
that remains the unified primary composer action.

- [ ] **Step 4: Run goal and execution tests**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/UnifiedGoalStrip.test.tsx \
  src/components/issues/issue-detail/__tests__/GoalControls.test.tsx \
  src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit goal presentation**

```bash
git add tracker/src/components/assistant/UnifiedGoalStrip.tsx \
  tracker/src/components/assistant/__tests__/UnifiedGoalStrip.test.tsx \
  tracker/src/components/shared/GoalPill.tsx \
  tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx \
  tracker/src/components/assistant/IssueAuthoringPanel.tsx
git commit -m "refactor(composer): compact native goal controls"
```

### Task 7: Add the Codex-style turn navigation rail

**Files:**
- Create: `tracker/src/components/assistant/TurnNavigationRail.tsx`
- Create: `tracker/src/components/assistant/turnNavigation.ts`
- Create: `tracker/src/components/assistant/__tests__/TurnNavigationRail.test.tsx`
- Create: `tracker/src/components/assistant/__tests__/turnNavigation.test.ts`
- Modify: `tracker/src/components/assistant/AssistantMessageList.tsx`
- Modify: `tracker/src/components/assistant/AssistantChatMessageBubble.tsx`
- Modify: `tracker/src/components/assistant/ExecutionSessionPanel.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/src/components/assistant/AssistantSessionShell.tsx`

- [ ] **Step 1: Write failing turn-grouping tests**

```ts
expect(
  buildTurnNavigationItems([
    userMessage("u1", "First prompt"),
    assistantMessage("a1", "First response"),
    userMessage("u2", "Second prompt"),
    assistantMessage("a2", "Second response"),
  ]),
).toEqual([
  {
    id: "turn-u1",
    anchorId: "message-u1",
    prompt: "First prompt",
    responsePreview: "First response",
  },
  {
    id: "turn-u2",
    anchorId: "message-u2",
    prompt: "Second prompt",
    responsePreview: "Second response",
  },
]);
```

Add fixtures for attachment-only prompts, tool-only responses, and adapted
session-log messages.

- [ ] **Step 2: Run grouping tests and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/turnNavigation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement grouping and anchors**

Create:

```ts
export interface TurnNavigationItem {
  id: string;
  anchorId: string;
  prompt: string;
  responsePreview: string;
}

export function buildTurnNavigationItems(
  messages: readonly AssistantChatMessage[],
): TurnNavigationItem[] {
  const turns: TurnNavigationItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        id: `turn-${message.id}`,
        anchorId: `message-${message.id}`,
        prompt: message.content.trim() || "Attachment",
        responsePreview: "",
      });
      continue;
    }
    const current = turns.at(-1);
    if (current && !current.responsePreview) {
      current.responsePreview = message.content.trim();
    }
  }
  return turns;
}
```

Set `id={`message-${message.id}`}` on each user message anchor without changing
the existing `AssistantTurnTimeline`.

- [ ] **Step 4: Write and implement rail interaction tests**

Test native buttons, `aria-current`, hover/focus preview, and scroll:

```tsx
await user.click(screen.getByRole("button", { name: /go to turn 2/i }));
expect(document.getElementById("message-u2")?.scrollIntoView)
  .toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
```

Implement one group of horizontal marks per turn. Use `IntersectionObserver`
against user anchors to update `aria-current`; fall back to click selection
when the observer is unavailable. Render the prompt and response prefix in a
Radix hover card/popover.

- [ ] **Step 5: Integrate both transcript sources**

Interactive history passes `messages`. Execution converts the adapted feed
with the existing `messagesFromSessionLogFeed()` helper before calling
`buildTurnNavigationItems`. Mount the rail beside the message column inside
the existing single scroll container. On narrow screens reduce the gutter; do
not add overflow or a second scrollbar.

- [ ] **Step 6: Run rail and message regression tests**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/turnNavigation.test.ts \
  src/components/assistant/__tests__/TurnNavigationRail.test.tsx \
  src/components/assistant/__tests__/AssistantMessageList.test.tsx \
  src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx \
  src/components/assistant/__tests__/ExecutionSessionPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit turn navigation**

```bash
git add tracker/src/components/assistant/TurnNavigationRail.tsx \
  tracker/src/components/assistant/turnNavigation.ts \
  tracker/src/components/assistant/__tests__/TurnNavigationRail.test.tsx \
  tracker/src/components/assistant/__tests__/turnNavigation.test.ts \
  tracker/src/components/assistant/AssistantMessageList.tsx \
  tracker/src/components/assistant/AssistantChatMessageBubble.tsx \
  tracker/src/components/assistant/ExecutionSessionPanel.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/AssistantSessionShell.tsx
git commit -m "feat(assistant): add turn navigation rail"
```

### Task 8: Wire permission persistence and conversation defaults

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/src/components/assistant/ExecutionSessionPanel.tsx`
- Modify: `tracker/src/components/assistant/UnifiedComposer.tsx`
- Modify: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
- Modify: `tracker/src/components/assistant/__tests__/ExecutionSessionPanel.test.tsx`
- Modify: `tracker/src/services/settings.ts`

- [ ] **Step 1: Write failing persistence tests**

Test these transitions:

```tsx
// Existing conversation value wins.
renderPanel({ thread: { permissionLevel: "ask_for_approval" } });
expect(screen.getByRole("button", { name: /ask for approval/i })).toBeVisible();

// Missing conversation value uses agent default, then full-access fallback.
renderPanel({ thread: { permissionLevel: null }, agentDefault: null });
expect(screen.getByRole("button", { name: /full access/i })).toBeVisible();

await user.selectOptions(permissionMenu, "approve_for_me");
expect(updateAssistantThread).toHaveBeenCalledWith(threadId, {
  permissionLevel: "approve_for_me",
});
```

Add an agent-switch case where the selected permission is incompatible and
assert submission is blocked until an enabled option is selected.

- [ ] **Step 2: Run panel tests and verify failure**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx \
  src/components/assistant/__tests__/ExecutionSessionPanel.test.tsx
```

Expected: FAIL because panels do not hydrate or persist `permissionLevel`.

- [ ] **Step 3: Implement hydration and optimistic persistence**

Derive initial permission in this order:

```ts
const permission =
  thread.permissionLevel ??
  agentSettings.defaultPermission ??
  "full_access";
```

On change, optimistically update the menu, PATCH the thread, and roll back to
the last server-confirmed value on failure with an inline/toast error. Convert
the neutral permission to the existing execution mode only at the transport
boundary with `executionModeForPermission`.

- [ ] **Step 4: Run panel and service tests**

Run the Step 2 command plus:

```bash
cd tracker && npm test -- src/services/__tests__/assistantThreads.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit conversation wiring**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/ExecutionSessionPanel.tsx \
  tracker/src/components/assistant/UnifiedComposer.tsx \
  tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx \
  tracker/src/components/assistant/__tests__/ExecutionSessionPanel.test.tsx \
  tracker/src/services/settings.ts
git commit -m "feat(composer): restore conversation permissions"
```

### Task 9: Full regression, accessibility, and visual validation

**Files:**
- Modify: `tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx`
- Modify: `tracker/src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx`
- Modify: `tracker/src/components/assistant/__tests__/AssistantSessionShell.test.tsx`
- Modify: `tracker/src/locales/en/translation.json`
- Modify: `tracker/src/locales/pt-BR/translation.json`

- [ ] **Step 1: Add cross-feature regression assertions**

Cover the final acceptance matrix:

```ts
expect(primaryToolbar()).toHaveAccessibleControls([
  "Add",
  "Full access",
  "Model and effort",
  "Record voice",
  "Stop",
]);
expect(addMenu()).toExpose([
  "Files and folders",
  "Context",
  "Diff",
  "Knowledge Base",
  "Magic",
  "Goal",
  "Commands and skills",
]);
```

Assert Escape closes menus, focus returns to triggers, disabled permission
reasons are visible, and reduced-motion mode uses non-animated turn scrolling.

- [ ] **Step 2: Run all focused frontend suites**

```bash
cd tracker && npm test -- \
  src/components/assistant/__tests__ \
  src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx \
  src/components/issues/issue-detail/__tests__/GoalControls.test.tsx \
  src/lib/__tests__/composerCapabilities.test.ts \
  src/services/__tests__/assistantThreads.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck/build and lint**

```bash
cd tracker && npm run build
cd tracker && npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Run focused backend tests**

```bash
cd elixir && mix test \
  test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs \
  test/symphony_elixir/assistant/history_test.exs
```

Expected: PASS.

- [ ] **Step 5: Perform browser visual QA**

Run the tracker locally, then verify Assistant and Execution at 1440 px,
1024 px, 736 px, and 390 px:

- only one chat scroll container;
- turn rail marks align with each user turn;
- hover/focus previews match prompt/response prefixes;
- composer row contains only `+`, permission, model/effort, voice, and the
  circular primary action;
- active run shows Stop while Enter queues;
- goal strip shows Pause/Play, Edit, and Remove without a second Stop;
- long goals, prompts, queue rows, and translated labels do not clip.

Capture screenshots for the final evidence bundle.

- [ ] **Step 6: Review the diff against every acceptance criterion**

```bash
git diff --check
git status --short
```

Confirm no unrelated `mobile/` files or
`elixir/dev/mobile_e2e_seed.exs` are staged.

- [ ] **Step 7: Commit final regression coverage**

```bash
git add tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx \
  tracker/src/components/issues/issue-detail/__tests__/ExecutionControlComposer.test.tsx \
  tracker/src/components/assistant/__tests__/AssistantSessionShell.test.tsx \
  tracker/src/locales/en/translation.json \
  tracker/src/locales/pt-BR/translation.json
git commit -m "test(composer): cover unified interaction contract"
```
