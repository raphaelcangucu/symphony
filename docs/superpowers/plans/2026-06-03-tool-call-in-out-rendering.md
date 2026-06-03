# Tool Call IN/OUT Rendering Implementation Plan

**Goal:** Render every tool call as a single transcript-style block with a header, an `IN` section, and an `OUT` section across both the assistant chat and the execution session log.

**Architecture:** A shared React `ToolCallBlock` component is fed a common `ToolCallView` view-model. The execution session log pairs `tool_call`/`tool_result` rollout entries by `call_id` (backend emits `call_id`, frontend merges) and maps the pair to a `ToolCallView`. The assistant chat gains backend-captured tool `arguments` (IN) and a derived `output` string (OUT) that flow through the existing channel/persistence untouched, then map to the same `ToolCallView`; action tools render expanded, read tools collapsed.

**Tech Stack:** Elixir/Phoenix (channels, ExUnit), React 19 + Vite + Tailwind + lucide-react (Vitest + Testing Library).

Spec: `docs/superpowers/specs/2026-06-03-tool-call-in-out-rendering-design.md`

---

## File Structure

**New**
- `tracker/src/components/shared/ToolCallBlock.tsx` — shared block UI + `ToolCallView`/`ToolBlockLanguage` types.
- `tracker/src/components/shared/__tests__/ToolCallBlock.test.tsx` — component tests.
- `tracker/src/components/issues/issue-detail/sessionToolCall.ts` — pairing + execution adapter (`pairSessionLogItems`, `sessionPairToView`).
- `tracker/src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts` — pairing/adapter tests.
- `tracker/src/components/assistant/assistantToolCall.ts` — assistant adapter (`isActionTool`, `assistantToolCallToView`).
- `tracker/src/components/assistant/__tests__/assistantToolCall.test.ts` — adapter tests.
- `elixir/lib/symphony_elixir/assistant/tool_call_presenter.ex` — pure derivation of `arguments`/`output` from payload+result.
- `elixir/test/symphony_elixir/assistant/tool_call_presenter_test.exs` — presenter tests.

**Modified**
- `tracker/src/types/session-log.ts` — add `callId` to `SessionLogEntry` + normalize it.
- `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx` — render paired items.
- `tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx` — drop the in-card tool rendering (handled by `ToolCallBlock`).
- `tracker/src/services/assistant.ts` — `AssistantToolCall.arguments`/`output` + DTO + normalize.
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — replace `ToolCallSummary` with `ToolCallBlock`.
- `elixir/lib/symphony_elixir/codex/session_log.ex` — thread `call_id` through tool entries.
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` — capture `arguments`/`output` via the presenter.

No DB migration. `Message`/`History`/`AssistantChannel` pass new keys through opaquely.

---

## Task 1: Shared `ToolCallBlock` component

**Files:**
- Create: `tracker/src/components/shared/ToolCallBlock.tsx`
- Test: `tracker/src/components/shared/__tests__/ToolCallBlock.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tracker/src/components/shared/__tests__/ToolCallBlock.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallBlock, type ToolCallView } from "@/components/shared/ToolCallBlock";

const baseView: ToolCallView = {
  toolType: "Bash",
  description: "Pint and commit B1",
  status: "completed",
  input: { value: "./vendor/bin/pint", language: "bash" },
  output: { value: "PASS", language: "text" },
  defaultCollapsed: false,
};

describe("ToolCallBlock", () => {
  it("renders header, IN and OUT when expanded", () => {
    render(<ToolCallBlock view={baseView} />);
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Pint and commit B1")).toBeInTheDocument();
    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
    expect(screen.getByText("./vendor/bin/pint")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("starts collapsed when defaultCollapsed is true and expands on click", () => {
    render(<ToolCallBlock view={{ ...baseView, defaultCollapsed: true }} />);
    expect(screen.queryByText("IN")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bash/i }));
    expect(screen.getByText("IN")).toBeInTheDocument();
  });

  it("truncates long output and reveals it via show more", () => {
    const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    render(<ToolCallBlock view={{ ...baseView, output: { value: longOutput, language: "text" } }} />);
    expect(screen.queryByText("line 39")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByText(/line 39/)).toBeInTheDocument();
  });

  it("shows a failed badge for failed status", () => {
    render(<ToolCallBlock view={{ ...baseView, status: "failed" }} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/shared/__tests__/ToolCallBlock.test.tsx`
Expected: FAIL — cannot resolve `@/components/shared/ToolCallBlock`.

- [ ] **Step 3: Write the component**

```tsx
// tracker/src/components/shared/ToolCallBlock.tsx
import { ChevronDown, Loader2, TerminalSquare, Wrench } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type ToolBlockLanguage = "bash" | "json" | "diff" | "markdown" | "text";

export type ToolBlockStatus = "running" | "completed" | "failed" | null;

export interface ToolBlockSection {
  value: string;
  language: ToolBlockLanguage;
}

export interface ToolCallView {
  toolType: string;
  description: string | null;
  status: ToolBlockStatus;
  input: ToolBlockSection | null;
  output: ToolBlockSection | null;
  defaultCollapsed: boolean;
}

const MAX_LINES = 20;
const MAX_CHARS = 2048;

export function ToolCallBlock({ view }: { view: ToolCallView }) {
  const [open, setOpen] = useState(!view.defaultCollapsed);
  const failed = view.status === "failed";
  const running = view.status === "running";

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-sky-500/20 bg-sky-500/5",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="mt-0.5 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : view.toolType === "Bash" ? <TerminalSquare className="size-3.5" /> : <Wrench className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-xs font-semibold text-foreground">{view.toolType}</span>
          {view.description ? <span className="ml-2 text-[11px] text-muted-foreground">{view.description}</span> : null}
        </span>
        {view.status ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
              failed ? "border-destructive/40 text-destructive" : "border-border/60 text-muted-foreground",
            )}
          >
            {view.status}
          </span>
        ) : null}
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
          {view.input ? <Section label="IN" section={view.input} /> : null}
          {view.output ? <Section label="OUT" section={view.output} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function Section({ label, section }: { label: string; section: ToolBlockSection }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, truncated } = clamp(section.value, expanded);

  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
        {visible}
      </pre>
      {truncated ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
          onClick={() => setExpanded(true)}
        >
          … show more
        </button>
      ) : null}
    </div>
  );
}

function clamp(value: string, expanded: boolean): { visible: string; truncated: boolean } {
  if (expanded) return { visible: value, truncated: false };

  const lines = value.split("\n");
  const tooManyLines = lines.length > MAX_LINES;
  const tooLong = value.length > MAX_CHARS;
  if (!tooManyLines && !tooLong) return { visible: value, truncated: false };

  const byLines = lines.slice(0, MAX_LINES).join("\n");
  const clamped = byLines.length > MAX_CHARS ? byLines.slice(0, MAX_CHARS) : byLines;
  return { visible: clamped, truncated: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/shared/__tests__/ToolCallBlock.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/shared/ToolCallBlock.tsx tracker/src/components/shared/__tests__/ToolCallBlock.test.tsx
git commit -m "feat(tracker): shared ToolCallBlock with IN/OUT sections"
```

---

## Task 2: Execution backend — emit `call_id` on tool entries

**Files:**
- Modify: `elixir/lib/symphony_elixir/codex/session_log.ex` (`entry/4`, the `parse_response_item` tool clauses)
- Test: `elixir/test/symphony_elixir/codex/session_log_test.exs`

- [ ] **Step 1: Write the failing test**

Append to `elixir/test/symphony_elixir/codex/session_log_test.exs` inside the module:

```elixir
  test "parse_line threads call_id through tool entries for pairing" do
    call =
      SessionLog.parse_line(
        ~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}","call_id":"call_1"}})
      )

    output =
      SessionLog.parse_line(
        ~s({"type":"response_item","payload":{"type":"function_call_output","output":"ok","call_id":"call_1"}})
      )

    assert call["call_id"] == "call_1"
    assert call["language"] == "bash"
    assert output["call_id"] == "call_1"
  end

  test "parse_line tolerates tool entries without call_id" do
    call =
      SessionLog.parse_line(
        ~s({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}"}})
      )

    assert call["call_id"] == nil
    assert call["kind"] == "tool_call"
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/codex/session_log_test.exs`
Expected: FAIL — `call["call_id"]` is `nil` for the first test (key absent).

- [ ] **Step 3: Implement `call_id` threading**

In `elixir/lib/symphony_elixir/codex/session_log.ex`, update `entry/4` to include `call_id`:

```elixir
  defp entry(kind, title, body, opts \\ []) do
    body = if is_binary(body), do: String.trim(body), else: nil

    %{
      "kind" => kind,
      "title" => title,
      "body" => if(body in [nil, ""], do: nil, else: body),
      "language" => Keyword.get(opts, :language, language_for(body)),
      "status" => Keyword.get(opts, :status),
      "collapsed" => Keyword.get(opts, :collapsed, output_long?(body)),
      "call_id" => Keyword.get(opts, :call_id)
    }
  end
```

Update the four tool clauses to pass `call_id`:

```elixir
  defp parse_response_item(%{"type" => "function_call", "name" => name} = payload) when is_binary(name) do
    args = Map.get(payload, "arguments")

    entry("tool_call", name, format_tool_input(args),
      language: tool_language(name, args),
      status: "running",
      collapsed: false,
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "function_call_output", "output" => output} = payload) when is_binary(output) do
    entry("tool_result", "Command output", output,
      language: "text",
      status: "completed",
      collapsed: output_long?(output),
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "custom_tool_call", "name" => name} = payload) when is_binary(name) do
    input = Map.get(payload, "input")
    status = Map.get(payload, "status")

    entry("tool_call", name, format_tool_input(input),
      language: tool_language(name, input),
      status: normalize_status(status),
      collapsed: false,
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "custom_tool_call_output", "output" => output} = payload) when is_binary(output) do
    entry("tool_result", "Tool output", output,
      language: "text",
      status: "completed",
      collapsed: output_long?(output),
      call_id: Map.get(payload, "call_id")
    )
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/codex/session_log_test.exs`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/codex/session_log.ex elixir/test/symphony_elixir/codex/session_log_test.exs
git commit -m "feat(codex): emit call_id on session-log tool entries for pairing"
```

---

## Task 3: Execution frontend — `callId` type + pairing transform

**Files:**
- Modify: `tracker/src/types/session-log.ts`
- Create: `tracker/src/components/issues/issue-detail/sessionToolCall.ts`
- Test: `tracker/src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts`

- [ ] **Step 1: Add `callId` to the type and normalizer**

In `tracker/src/types/session-log.ts`, extend the interface and normalizer:

```ts
export interface SessionLogEntry {
  kind: SessionLogEntryKind;
  title: string;
  body: string | null;
  language: SessionLogEntryLanguage;
  status: SessionLogEntryStatus | null;
  collapsed: boolean;
  callId: string | null;
}
```

In `normalizeSessionLogEntry`, add to the returned object:

```ts
    callId: typeof record.call_id === "string" ? record.call_id : typeof record.callId === "string" ? record.callId : null,
```

In `legacyEntry`, add `callId: null,` to both returned objects.

- [ ] **Step 2: Write the failing pairing test**

```ts
// tracker/src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts
import { describe, expect, it } from "vitest";

import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
import type { SessionLogEntry } from "@/types/session-log";

function entry(partial: Partial<SessionLogEntry>): SessionLogEntry {
  return {
    kind: "event",
    title: "",
    body: null,
    language: "text",
    status: null,
    collapsed: false,
    callId: null,
    ...partial,
  };
}

describe("pairSessionLogItems", () => {
  it("merges a tool_call with its tool_result by callId", () => {
    const items = pairSessionLogItems([
      entry({ kind: "tool_call", title: "exec_command", body: '{"cmd":"pwd"}', language: "bash", status: "running", callId: "c1" }),
      entry({ kind: "tool_result", title: "Command output", body: "/home", status: "completed", callId: "c1" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "toolCall" });
    if (items[0].type !== "toolCall") throw new Error("expected toolCall");
    expect(items[0].call.callId).toBe("c1");
    expect(items[0].result?.body).toBe("/home");
  });

  it("renders an unpaired tool_call as running with no result", () => {
    const items = pairSessionLogItems([
      entry({ kind: "tool_call", title: "exec_command", body: '{"cmd":"pwd"}', language: "bash", status: "running", callId: "c2" }),
    ]);
    if (items[0].type !== "toolCall") throw new Error("expected toolCall");
    expect(items[0].result).toBeNull();
  });

  it("keeps legacy entries without callId as plain entries", () => {
    const items = pairSessionLogItems([entry({ kind: "tool_call", title: "legacy", body: "x", callId: null })]);
    expect(items[0].type).toBe("entry");
  });

  it("maps a paired bash call to a ToolCallView", () => {
    const view = sessionPairToView(
      entry({ kind: "tool_call", title: "exec_command", body: "pwd\nls", language: "bash", status: "running", callId: "c3" }),
      entry({ kind: "tool_result", title: "Command output", body: "/home", status: "completed", callId: "c3" }),
    );

    expect(view.toolType).toBe("Bash");
    expect(view.description).toBe("pwd");
    expect(view.input?.value).toBe("pwd\nls");
    expect(view.output?.value).toBe("/home");
    expect(view.status).toBe("completed");
    expect(view.defaultCollapsed).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts`
Expected: FAIL — cannot resolve `sessionToolCall`.

- [ ] **Step 4: Implement the pairing + adapter**

```ts
// tracker/src/components/issues/issue-detail/sessionToolCall.ts
import type { ToolBlockLanguage, ToolCallView } from "@/components/shared/ToolCallBlock";
import type { SessionLogEntry, SessionLogEntryLanguage } from "@/types/session-log";

export type SessionLogRenderItem =
  | { type: "entry"; entry: SessionLogEntry }
  | { type: "toolCall"; call: SessionLogEntry; result: SessionLogEntry | null };

export function pairSessionLogItems(entries: SessionLogEntry[]): SessionLogRenderItem[] {
  const consumedResultIndexes = new Set<number>();
  const items: SessionLogRenderItem[] = [];

  entries.forEach((entry, index) => {
    if (consumedResultIndexes.has(index)) return;

    if (entry.kind === "tool_call" && entry.callId) {
      const resultIndex = entries.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.kind === "tool_result" && candidate.callId === entry.callId,
      );
      const result = resultIndex === -1 ? null : entries[resultIndex];
      if (resultIndex !== -1) consumedResultIndexes.add(resultIndex);
      items.push({ type: "toolCall", call: entry, result });
      return;
    }

    items.push({ type: "entry", entry });
  });

  return items;
}

export function sessionPairToView(call: SessionLogEntry, result: SessionLogEntry | null): ToolCallView {
  return {
    toolType: toolTypeLabel(call.title),
    description: deriveDescription(call.body),
    status: pairStatus(call, result),
    input: call.body ? { value: call.body, language: toBlockLanguage(call.language) } : null,
    output: result?.body ? { value: result.body, language: toBlockLanguage(result.language) } : null,
    defaultCollapsed: false,
  };
}

function toolTypeLabel(title: string): string {
  if (title === "exec_command" || title === "shell") return "Bash";
  return humanize(title);
}

function deriveDescription(body: string | null): string | null {
  if (!body) return null;
  const decoded = decodeCommand(body);
  const firstLine = decoded.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

function decodeCommand(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.cmd === "string") return parsed.cmd;
  } catch {
    // body is not JSON; use as-is
  }
  return body;
}

function pairStatus(call: SessionLogEntry, result: SessionLogEntry | null): ToolCallView["status"] {
  if (result?.status === "failed") return "failed";
  if (result) return "completed";
  if (call.status === "failed") return "failed";
  return "running";
}

function toBlockLanguage(language: SessionLogEntryLanguage): ToolBlockLanguage {
  if (language === "bash" || language === "json" || language === "diff" || language === "markdown") return language;
  return "text";
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add tracker/src/types/session-log.ts tracker/src/components/issues/issue-detail/sessionToolCall.ts tracker/src/components/issues/issue-detail/__tests__/sessionToolCall.test.ts
git commit -m "feat(tracker): pair session-log tool calls by callId into ToolCallView"
```

---

## Task 4: Execution frontend — render paired blocks

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx`
- Modify: `tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx`

- [ ] **Step 1: Render paired items in `IssueSessionLog`**

Replace the imports and the entries `.map(...)` block in `tracker/src/components/issues/issue-detail/IssueSessionLog.tsx`:

```tsx
import { useEffect, useRef } from "react";

import { SessionLogEntryCard } from "@/components/issues/issue-detail/SessionLogEntryCard";
import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import type { SessionLogEntry } from "@/types/session-log";
```

Then, inside the component, compute the render items and map them:

```tsx
  const items = pairSessionLogItems(entries);
```

```tsx
          {items.length > 0 ? (
            items.map((item, index) =>
              item.type === "toolCall" ? (
                <ToolCallBlock view={sessionPairToView(item.call, item.result)} key={`tool-${item.call.callId}-${index}`} />
              ) : (
                <SessionLogEntryCard entry={item.entry} key={`${item.entry.kind}-${item.entry.title}-${index}`} />
              ),
            )
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Waiting for session output…</p>
          )}
```

Keep the existing `useEffect` autoscroll keyed on `entries`.

- [ ] **Step 2: Simplify `SessionLogEntryCard`**

In `tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx`, remove the `tool_call`/`tool_result` branch (lines handling `entry.kind === "tool_call" || entry.kind === "tool_result"`) since paired tool calls now render via `ToolCallBlock`. Any unpaired legacy `tool_call`/`tool_result` without a `callId` falls through to the generic `CollapsibleCard` event branch, which already renders a `CodeBody`. Update the unused-import list accordingly (`Wrench`/`TerminalSquare` may become unused — remove them if eslint flags them).

Concretely, delete this block:

```tsx
  if (entry.kind === "tool_call" || entry.kind === "tool_result") {
    const Icon = entry.kind === "tool_call" ? Wrench : TerminalSquare;
    const statusLabel =
      entry.status === "running" ? "Running" : entry.status === "completed" ? "Completed" : entry.status === "failed" ? "Failed" : null;

    return (
      <CollapsibleCard
        open={open}
        onToggle={() => setOpen((current) => !current)}
        title={entry.title}
        subtitle={entry.kind === "tool_call" ? "Tool call" : "Tool result"}
        tone="tool"
        status={statusLabel}
        icon={<Icon className="size-3.5" />}
      >
        {entry.body ? <CodeBody language={entry.language} value={entry.body} /> : null}
      </CollapsibleCard>
    );
  }
```

- [ ] **Step 3: Run the existing session-log tests + typecheck**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail && npm run lint`
Expected: PASS; lint clean (no unused `Wrench`/`TerminalSquare`).

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/issues/issue-detail/IssueSessionLog.tsx tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx
git commit -m "feat(tracker): render execution tool calls as paired IN/OUT blocks"
```

---

## Task 5: Assistant backend — capture `arguments` and `output`

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/tool_call_presenter.ex`
- Test: `elixir/test/symphony_elixir/assistant/tool_call_presenter_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex` (`tool_call_from_payload/3`)

- [ ] **Step 1: Write the failing presenter test**

```elixir
# elixir/test/symphony_elixir/assistant/tool_call_presenter_test.exs
defmodule SymphonyElixir.Assistant.ToolCallPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ToolCallPresenter

  test "arguments/1 reads params.arguments from the payload" do
    payload = %{"params" => %{"name" => "move_issue", "arguments" => %{"identifier" => "MAC-1", "status" => "In Progress"}}}
    assert ToolCallPresenter.arguments(payload) == %{"identifier" => "MAC-1", "status" => "In Progress"}
  end

  test "arguments/1 returns nil when absent" do
    assert ToolCallPresenter.arguments(%{"params" => %{}}) == nil
    assert ToolCallPresenter.arguments(%{}) == nil
  end

  test "output/1 returns the tool result message on success" do
    result = %{"success" => true, "toolResult" => %{"tool" => "move_issue", "message" => "Moved issue MAC-1 to In Progress.", "data" => %{}}}
    assert ToolCallPresenter.output(result) == "Moved issue MAC-1 to In Progress."
  end

  test "output/1 returns the error message on failure" do
    result = %{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => ~s({"error":{"message":"Issue not found."}})}]}
    assert ToolCallPresenter.output(result) == "Issue not found."
  end

  test "output/1 returns nil for empty result" do
    assert ToolCallPresenter.output(%{}) == nil
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_call_presenter_test.exs`
Expected: FAIL — module `ToolCallPresenter` is undefined.

- [ ] **Step 3: Implement the presenter**

```elixir
# elixir/lib/symphony_elixir/assistant/tool_call_presenter.ex
defmodule SymphonyElixir.Assistant.ToolCallPresenter do
  @moduledoc """
  Pure derivation of a tool call's presentable input (arguments) and output
  (result message / error) for the assistant chat IN/OUT block.
  """

  @spec arguments(map()) :: map() | nil
  def arguments(payload) when is_map(payload) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}

    case Map.get(params, "arguments") || Map.get(params, :arguments) do
      args when is_map(args) and map_size(args) > 0 -> args
      _ -> nil
    end
  end

  def arguments(_payload), do: nil

  @spec output(map()) :: String.t() | nil
  def output(result) when is_map(result) do
    cond do
      success?(result) -> success_message(result)
      Map.has_key?(result, "contentItems") or Map.has_key?(result, :contentItems) -> error_message(result)
      true -> nil
    end
  end

  def output(_result), do: nil

  defp success?(result) do
    Map.get(result, "success") == true or Map.get(result, :success) == true
  end

  defp success_message(result) do
    tool_result = Map.get(result, "toolResult") || Map.get(result, :toolResult) || %{}

    case Map.get(tool_result, "message") || Map.get(tool_result, :message) do
      message when is_binary(message) and message != "" -> message
      _ -> nil
    end
  end

  defp error_message(result) do
    items = Map.get(result, "contentItems") || Map.get(result, :contentItems) || []

    items
    |> Enum.find_value(fn item ->
      item |> text_field() |> decode_error_message()
    end)
  end

  defp text_field(item) when is_map(item), do: Map.get(item, "text") || Map.get(item, :text)
  defp text_field(_item), do: nil

  defp decode_error_message(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, %{"error" => %{"message" => message}}} when is_binary(message) -> message
      {:ok, %{"error" => message}} when is_binary(message) -> message
      _ -> nil
    end
  end

  defp decode_error_message(_text), do: nil
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/tool_call_presenter_test.exs`
Expected: PASS (5 tests).

- [ ] **Step 5: Integrate into `tool_call_from_payload/3`**

In `elixir/lib/symphony_elixir/assistant/codex_session.ex`, add the alias near the top (with the other `alias` lines) and extend the builder:

```elixir
  alias SymphonyElixir.Assistant.ToolCallPresenter
```

```elixir
  defp tool_call_from_payload(payload, event, result) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}
    name = Map.get(params, "name") || Map.get(params, "tool") || Map.get(params, :name) || Map.get(params, :tool) || "unknown"

    %{
      name: name,
      status: tool_call_status(event),
      arguments: ToolCallPresenter.arguments(payload),
      output: ToolCallPresenter.output(result),
      result: result
    }
  end
```

- [ ] **Step 6: Run the codex_session tests**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs test/symphony_elixir/assistant/tool_call_presenter_test.exs`
Expected: PASS (existing codex_session tests unaffected; presenter tests pass).

- [ ] **Step 7: Format, specs, commit**

Run: `cd elixir && mix format && mix specs.check`
Expected: format clean; specs.check passes (public funcs have `@spec`).

```bash
git add elixir/lib/symphony_elixir/assistant/tool_call_presenter.ex elixir/lib/symphony_elixir/assistant/codex_session.ex elixir/test/symphony_elixir/assistant/tool_call_presenter_test.exs
git commit -m "feat(assistant): capture tool call arguments and output for IN/OUT"
```

---

## Task 6: Assistant frontend — extend `AssistantToolCall`

**Files:**
- Modify: `tracker/src/services/assistant.ts` (`AssistantToolCall`, `BackendAssistantToolCallDto`, `normalizeToolCall`)
- Test: `tracker/src/services/__tests__/assistant.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("assistant service", ...)` block in `tracker/src/services/__tests__/assistant.test.ts`:

```ts
  it("normalizes tool call arguments and output", async () => {
    vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          assistant_message: "done",
          tool_calls: [
            {
              name: "move_issue",
              status: "complete",
              arguments: { identifier: "MAC-1", status: "In Progress" },
              output: "Moved issue MAC-1 to In Progress.",
              result: {},
            },
          ],
        },
      },
    });

    const response = await sendAssistantMessage("macro-markets", { message: "move MAC-1" });

    expect(response.toolCalls[0].arguments).toEqual({ identifier: "MAC-1", status: "In Progress" });
    expect(response.toolCalls[0].output).toBe("Moved issue MAC-1 to In Progress.");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/services/__tests__/assistant.test.ts`
Expected: FAIL — `arguments`/`output` are `undefined` (not on the type, not normalized).

- [ ] **Step 3: Extend type, DTO, and normalizer**

In `tracker/src/services/assistant.ts`, extend `AssistantToolCall`:

```ts
export interface AssistantToolCall {
  name: string;
  status: AssistantToolStatus;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  result: {
    issue?: Issue;
    issues?: Issue[];
    comment?: Comment;
    agentExecutions?: unknown[];
    [key: string]: unknown;
  };
}
```

Extend `BackendAssistantToolCallDto` (near line 124):

```ts
interface BackendAssistantToolCallDto {
  name?: string | null;
  status?: string | null;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  result?: {
    issue?: BackendIssueDto | null;
    issues?: BackendIssueDto[] | null;
    comment?: BackendCommentDto | null;
    [key: string]: unknown;
  } | null;
}
```

Extend `normalizeToolCall`:

```ts
export function normalizeToolCall(dto: BackendAssistantToolCallDto): AssistantToolCall {
  const result = dto.result ?? {};

  return {
    name: dto.name ?? "unknown",
    status: normalizeToolStatus(dto.status),
    arguments: dto.arguments ?? null,
    output: typeof dto.output === "string" ? dto.output : null,
    result: {
      ...result,
      issue: result.issue ? normalizeIssue(result.issue) : undefined,
      issues: Array.isArray(result.issues) ? result.issues.map(normalizeIssue) : undefined,
      comment: result.comment ? normalizeComment(result.comment) : undefined,
      agentExecutions: result.agentExecutions ?? result.agent_executions ?? undefined,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/services/__tests__/assistant.test.ts`
Expected: PASS (existing + new test).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/services/assistant.ts tracker/src/services/__tests__/assistant.test.ts
git commit -m "feat(tracker): normalize assistant tool call arguments and output"
```

---

## Task 7: Assistant frontend — render `ToolCallBlock` with action/read split

**Files:**
- Create: `tracker/src/components/assistant/assistantToolCall.ts`
- Test: `tracker/src/components/assistant/__tests__/assistantToolCall.test.ts`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`

- [ ] **Step 1: Write the failing adapter test**

```ts
// tracker/src/components/assistant/__tests__/assistantToolCall.test.ts
import { describe, expect, it } from "vitest";

import { assistantToolCallToView, isActionTool } from "@/components/assistant/assistantToolCall";
import type { AssistantToolCall } from "@/services/assistant";

function toolCall(partial: Partial<AssistantToolCall>): AssistantToolCall {
  return { name: "list_issues", status: "complete", result: {}, ...partial };
}

describe("assistant tool call adapter", () => {
  it("classifies action vs read tools", () => {
    expect(isActionTool("move_issue")).toBe(true);
    expect(isActionTool("dispatch_codex")).toBe(true);
    expect(isActionTool("create_issue")).toBe(true);
    expect(isActionTool("list_issues")).toBe(false);
    expect(isActionTool("get_issue")).toBe(false);
  });

  it("expands action tools and shows arguments + output", () => {
    const view = assistantToolCallToView(
      toolCall({
        name: "move_issue",
        status: "complete",
        arguments: { identifier: "MAC-1", status: "In Progress" },
        output: "Moved issue MAC-1 to In Progress.",
      }),
    );

    expect(view.toolType).toBe("Move issue");
    expect(view.status).toBe("completed");
    expect(view.defaultCollapsed).toBe(false);
    expect(view.input?.language).toBe("json");
    expect(view.input?.value).toContain("MAC-1");
    expect(view.output?.value).toBe("Moved issue MAC-1 to In Progress.");
  });

  it("collapses read tools by default", () => {
    const view = assistantToolCallToView(toolCall({ name: "list_issues", status: "complete" }));
    expect(view.defaultCollapsed).toBe(true);
  });

  it("maps error status to failed", () => {
    const view = assistantToolCallToView(toolCall({ name: "move_issue", status: "error", output: "Issue not found." }));
    expect(view.status).toBe("failed");
    expect(view.output?.value).toBe("Issue not found.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/assistantToolCall.test.ts`
Expected: FAIL — cannot resolve `assistantToolCall`.

- [ ] **Step 3: Implement the adapter**

```ts
// tracker/src/components/assistant/assistantToolCall.ts
import type { ToolCallView } from "@/components/shared/ToolCallBlock";
import type { AssistantToolCall, AssistantToolStatus } from "@/services/assistant";

const ACTION_TOOLS = new Set<string>([
  "create_issue",
  "create_draft_issue",
  "update_issue",
  "move_issue",
  "dispatch_codex",
  "add_comment",
]);

const ACTION_PREFIXES = ["create_", "update_", "move_", "dispatch_", "provision_", "add_"];

export function isActionTool(name: string): boolean {
  if (ACTION_TOOLS.has(name)) return true;
  return ACTION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function assistantToolCallToView(toolCall: AssistantToolCall): ToolCallView {
  const action = isActionTool(toolCall.name);
  const input = serializeArguments(toolCall.arguments);

  return {
    toolType: humanize(toolCall.name),
    description: null,
    status: mapStatus(toolCall.status),
    input: input ? { value: input, language: "json" } : null,
    output: toolCall.output ? { value: toolCall.output, language: "text" } : null,
    defaultCollapsed: !action,
  };
}

function serializeArguments(args: AssistantToolCall["arguments"]): string | null {
  if (!args || typeof args !== "object" || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function mapStatus(status: AssistantToolStatus): ToolCallView["status"] {
  if (status === "running") return "running";
  if (status === "error") return "failed";
  return "completed";
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/assistantToolCall.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use the block in `ProjectAssistantPanel`**

In `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, add imports near the other component imports:

```tsx
import { ToolCallBlock } from "@/components/shared/ToolCallBlock";
import { assistantToolCallToView } from "@/components/assistant/assistantToolCall";
```

Replace the tool-calls render block (the `message.toolCalls.map(...)` using `ToolCallSummary`):

```tsx
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
            ))}
          </div>
        ) : null}
```

Delete the now-unused `ToolCallSummary` function (lines defining `function ToolCallSummary(...)`). Remove the `AssistantToolCall` import only if it becomes unused (it is still referenced by `updateStreamingToolCall`, so keep it).

- [ ] **Step 6: Run assistant tests + lint + typecheck**

Run: `cd tracker && npx vitest run src/components/assistant && npm run lint && npm run build`
Expected: PASS; lint clean; `tsc -b` succeeds (no unused `ToolCallSummary`).

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/assistant/assistantToolCall.ts tracker/src/components/assistant/__tests__/assistantToolCall.test.ts tracker/src/components/assistant/ProjectAssistantPanel.tsx
git commit -m "feat(tracker): render assistant tool calls as IN/OUT blocks"
```

---

## Task 8: Full verification

**Files:** none (gates only)

- [ ] **Step 1: Frontend gates**

Run: `cd tracker && npm run test && npm run lint && npm run build`
Expected: all Vitest suites pass; eslint clean; production build succeeds.

- [ ] **Step 2: Backend gates**

Run: `cd elixir && make all`
Expected: format check, lint, coverage, and dialyzer all pass.

- [ ] **Step 3: Manual smoke (documented, not automated)**

1. Open an issue with an active execution → Execution tab → Session log: Bash tool calls render as one block with `Bash` + derived command description, `IN` (command) and `OUT` (stdout), expanded, long output truncated with "show more".
2. In the assistant chat, send a message that moves/creates an issue → the action tool renders expanded with `IN` (arguments JSON) and `OUT` (result message); a `list_issues` read renders collapsed (header only) and expands on click.

- [ ] **Step 4: Final commit (if any gate produced formatting fixes)**

```bash
git add -A
git commit -m "chore: verification fixups for tool call IN/OUT rendering"
```

---

## Self-Review

**Spec coverage:**
- Shared `ToolCallBlock` (spec §Architecture/Shared component) → Task 1.
- Execution `call_id` pairing (spec §Surface 1) → Tasks 2–4.
- Assistant `arguments`/`output` capture + flow (spec §Surface 2 backend) → Tasks 5–6.
- Action-expanded / read-collapsed classification (spec §Relevant vs collapsed) → Task 7.
- Expanded-by-default + truncation + failed/running states (spec §Goals 4) → Task 1.
- Error handling: unpaired call → running (Task 3); failed → red + message (Tasks 1, 5, 7); legacy no-callId fallback (Tasks 3, 4); large OUT truncation (Task 1) → covered.
- Testing (spec §Testing): backend session_log (Task 2), presenter (Task 5), ToolCallBlock (Task 1), pairing (Task 3), assistant adapter (Task 7), normalize (Task 6); manual smoke (Task 8).

**Refinement vs spec:** the spec suggested the assistant header `description` = result message; to avoid duplicating the message (which is shown in `OUT`), the assistant adapter sets `description: null` and places the message in `OUT`. Execution still derives a header `description` from the command. This is a deliberate, minor improvement and is reflected in Task 7.

**Type consistency:** `ToolCallView`/`ToolBlockLanguage`/`ToolBlockSection` defined in Task 1 are imported unchanged by Tasks 3 and 7. `SessionLogEntry.callId` added in Task 3 is consumed by Tasks 3–4. `AssistantToolCall.arguments`/`output` added in Task 6 are consumed by Task 7. `ToolCallPresenter.arguments/1` and `output/1` defined in Task 5 match their call sites in `codex_session.ex`.

**Placeholder scan:** no TBD/TODO; every code step contains full content.
