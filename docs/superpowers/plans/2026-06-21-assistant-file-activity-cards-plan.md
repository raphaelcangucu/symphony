# Assistant File-Activity Cards Implementation Plan

**Goal:** Render the assistant's file reads, file edits, and shell commands as compact, Cursor-style cards in the chat, and surface Codex's native file/command operations (which are invisible today).

**Architecture:** Reuse the existing tool-call pipeline (approach A). A pure Elixir presenter translates Codex native item events into the existing `tool_call` shape; the relay delegates to it. On the frontend, a pure classifier turns file-operation tool calls into a view model, and a `FileActivityCard` renders it; non-file tool calls keep using `ToolCallBlock`.

**Tech Stack:** Elixir (Phoenix channel relay, ExUnit), React + TypeScript (Vite, Vitest, Testing Library), i18next, lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-21-assistant-file-activity-cards-design.md`

**Scope note (deliberate deviation from spec §4.1):** The `turn/diff/updated` enrichment is **deferred to Phase 2**. Keeping per-event translation pure (no collector/cross-event state) makes the entire backend logic unit-testable and the relay change a minimal, obviously-correct delegation. The diff + `+N −M` counts come from the per-item file-change completion event instead. If a real rollout shows file-change completions arrive without a diff, wire `turn/diff/updated` enrichment then.

---

## Task 1: i18n keys for file-activity cards

**Files:**
- Modify: `tracker/locales/en/tracker.json` (inside the existing `issue.toolCall` object, ~`:279-325`)
- Modify: `tracker/locales/pt-BR/tracker.json` (inside the existing `issue.toolCall` object, ~`:279-325`)

These keys are referenced by Task 3's card. Add them first so later code resolves real strings.

- [ ] **Step 1: Add the `fileActivity` block to the English locale**

In `tracker/locales/en/tracker.json`, find the `"toolCall"` object (it contains `"status"`, `"tools"`, `"input": "IN"`, `"output": "OUT"`, `"showMore"`). Add a `"fileActivity"` sibling key right after `"showMore"`:

```json
      "showMore": "… show more",
      "fileActivity": {
        "read": "Read",
        "edited": "Edited",
        "command": "Ran",
        "files_one": "{{count}} file",
        "files_other": "{{count}} files",
        "running": "Working…",
        "expand": "Toggle details"
      }
```

Also add three tool-name labels inside the existing `"tools"` object (alphabetical placement is fine):

```json
        "apply_patch": "Edit files",
        "read_workspace_file": "Read file",
        "shell": "Run command",
```

- [ ] **Step 2: Add the same block to the pt-BR locale**

In `tracker/locales/pt-BR/tracker.json`, find the `"toolCall"` object (`"showMore": "… mostrar mais"`). Add after `"showMore"`:

```json
      "showMore": "… mostrar mais",
      "fileActivity": {
        "read": "Leu",
        "edited": "Editou",
        "command": "Rodou",
        "files_one": "{{count}} arquivo",
        "files_other": "{{count}} arquivos",
        "running": "Trabalhando…",
        "expand": "Alternar detalhes"
      }
```

And inside the pt-BR `"tools"` object:

```json
        "apply_patch": "Editar arquivos",
        "read_workspace_file": "Ler arquivo",
        "shell": "Rodar comando",
```

- [ ] **Step 3: Verify both JSON files are still valid**

Run: `cd tracker && node -e "JSON.parse(require('fs').readFileSync('locales/en/tracker.json','utf8')); JSON.parse(require('fs').readFileSync('locales/pt-BR/tracker.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no parse error).

- [ ] **Step 4: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "feat(assistant): add i18n keys for file-activity cards"
```

---

## Task 2: `fileActivity` classifier (frontend, pure)

Turns a tool call into a `FileActivityView`, or `null` when it isn't file activity. This is the brain of the frontend feature and is exercised first against **reads**, which already arrive in the chat today.

**Files:**
- Create: `tracker/src/components/assistant/fileActivity.ts`
- Test: `tracker/src/components/assistant/__tests__/fileActivity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/fileActivity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import type { AssistantToolCall } from "@/services/assistant";

function call(partial: Partial<AssistantToolCall>): AssistantToolCall {
  return { name: "read_workspace_file", status: "complete", result: {}, ...partial };
}

describe("fileActivityFromToolCall", () => {
  it("returns null for non-file tools", () => {
    expect(fileActivityFromToolCall(call({ name: "list_issues" }))).toBeNull();
    expect(fileActivityFromToolCall(call({ name: "update_issue" }))).toBeNull();
  });

  it("maps a read with a line range", () => {
    const view = fileActivityFromToolCall(
      call({
        name: "read_workspace_file",
        arguments: { path: "front/README.md", start_line: 1, end_line: 60 },
        output: "line 1\nline 2",
      }),
    );
    expect(view?.kind).toBe("read");
    expect(view?.path).toBe("front/README.md");
    expect(view?.lineRange).toBe("L1–60");
    expect(view?.body).toEqual({ value: "line 1\nline 2", language: "text" });
  });

  it("formats partial line ranges", () => {
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex", start_line: 5 } }))?.lineRange).toBe("L5–");
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex", end_line: 9 } }))?.lineRange).toBe("L–9");
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex" } }))?.lineRange).toBeNull();
  });

  it("maps an edit with diff counts", () => {
    const view = fileActivityFromToolCall(
      call({
        name: "apply_patch",
        status: "complete",
        result: { diff: "@@\n+a\n+b\n-c", additions: 2, deletions: 1, paths: ["lib/foo.ex"] },
      }),
    );
    expect(view?.kind).toBe("edit");
    expect(view?.title).toBe("lib/foo.ex");
    expect(view?.additions).toBe(2);
    expect(view?.deletions).toBe(1);
    expect(view?.body).toEqual({ value: "@@\n+a\n+b\n-c", language: "diff" });
  });

  it("labels a multi-file edit by count", () => {
    const view = fileActivityFromToolCall(
      call({ name: "apply_patch", result: { paths: ["a.ex", "b.ex"], additions: 3, deletions: 0 } }),
    );
    expect(view?.kind).toBe("edit");
    expect(view?.path).toBeNull();
    expect(view?.title).toBe("2 files");
  });

  it("maps a command with output", () => {
    const view = fileActivityFromToolCall(
      call({ name: "shell", status: "complete", arguments: { command: "mix test" }, output: "1 passed" }),
    );
    expect(view?.kind).toBe("command");
    expect(view?.title).toBe("mix test");
    expect(view?.body).toEqual({ value: "1 passed", language: "bash" });
  });

  it("maps running and error statuses", () => {
    expect(fileActivityFromToolCall(call({ status: "running" }))?.status).toBe("running");
    expect(fileActivityFromToolCall(call({ name: "apply_patch", status: "error" }))?.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/fileActivity.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/assistant/fileActivity"`.

- [ ] **Step 3: Implement the classifier**

Create `tracker/src/components/assistant/fileActivity.ts`:

```ts
import type { AssistantToolCall, AssistantToolStatus } from "@/services/assistant";

export type FileActivityKind = "read" | "edit" | "command";

export interface FileActivityView {
  kind: FileActivityKind;
  /** Primary label: filename, "N files", or the command. */
  title: string;
  /** Single-file path for read/edit; null for multi-file or command. */
  path: string | null;
  /** "L1–60" / "L5–" / "L–9" for reads; null otherwise. */
  lineRange: string | null;
  additions: number | null;
  deletions: number | null;
  status: "running" | "complete" | "error";
  body: { value: string; language: "diff" | "bash" | "text" } | null;
}

const READ_TOOLS = new Set(["read_workspace_file", "read_file"]);
const EDIT_TOOLS = new Set(["apply_patch", "edit_file", "write_file"]);
const COMMAND_TOOLS = new Set(["shell", "exec_command", "bash"]);

export function fileActivityFromToolCall(call: AssistantToolCall): FileActivityView | null {
  const status = mapStatus(call.status);
  if (READ_TOOLS.has(call.name)) return readView(call, status);
  if (EDIT_TOOLS.has(call.name)) return editView(call, status);
  if (COMMAND_TOOLS.has(call.name)) return commandView(call, status);
  return null;
}

function mapStatus(status: AssistantToolStatus): FileActivityView["status"] {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "complete";
}

function readView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const path = stringOrNull(args.path);
  const start = numberOrNull(args.start_line);
  const end = numberOrNull(args.end_line);
  return {
    kind: "read",
    title: path ?? "file",
    path,
    lineRange: lineRange(start, end),
    additions: null,
    deletions: null,
    status,
    body: call.output ? { value: call.output, language: "text" } : null,
  };
}

function editView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const result = (call.result ?? {}) as Record<string, unknown>;
  const paths = Array.isArray(result.paths) ? (result.paths.filter((p) => typeof p === "string") as string[]) : [];
  const single = paths.length === 1 ? paths[0] : null;
  const diff = stringOrNull(result.diff);
  return {
    kind: "edit",
    title: single ?? (paths.length > 1 ? `${paths.length} files` : "file"),
    path: single,
    lineRange: null,
    additions: numberOrNull(result.additions),
    deletions: numberOrNull(result.deletions),
    status,
    body: diff ? { value: diff, language: "diff" } : null,
  };
}

function commandView(call: AssistantToolCall, status: FileActivityView["status"]): FileActivityView {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const command = stringOrNull(args.command) ?? "";
  return {
    kind: "command",
    title: command || "command",
    path: null,
    lineRange: null,
    additions: null,
    deletions: null,
    status,
    body: call.output ? { value: call.output, language: "bash" } : null,
  };
}

function lineRange(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  return `L${start ?? ""}–${end ?? ""}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/fileActivity.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/fileActivity.ts tracker/src/components/assistant/__tests__/fileActivity.test.ts
git commit -m "feat(assistant): add file-activity classifier for tool calls"
```

---

## Task 3: `FileActivityCard` component (frontend)

A compact, collapsible card with a file-aware header (icon + filename + line range or `+N −M`), expandable to the content/diff/output.

**Files:**
- Create: `tracker/src/components/assistant/FileActivityCard.tsx`
- Test: `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { FileActivityCard } from "@/components/assistant/FileActivityCard";
import type { FileActivityView } from "@/components/assistant/fileActivity";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";

function view(partial: Partial<FileActivityView>): FileActivityView {
  return {
    kind: "read",
    title: "front/README.md",
    path: "front/README.md",
    lineRange: "L1–60",
    additions: null,
    deletions: null,
    status: "complete",
    body: null,
    ...partial,
  };
}

describe("FileActivityCard", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a read header with line range", () => {
    renderWithI18n(<FileActivityCard view={view({})} />);
    expect(screen.getByText("front/README.md")).toBeInTheDocument();
    expect(screen.getByText("L1–60")).toBeInTheDocument();
  });

  it("renders edit add/remove counts", () => {
    renderWithI18n(
      <FileActivityCard view={view({ kind: "edit", title: "lib/foo.ex", path: "lib/foo.ex", lineRange: null, additions: 12, deletions: 3 })} />,
    );
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
  });

  it("is collapsed by default and expands the body on click", () => {
    renderWithI18n(<FileActivityCard view={view({ body: { value: "hello body", language: "text" } })} />);
    expect(screen.queryByText("hello body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hello body")).toBeInTheDocument();
  });

  it("shows a running indicator", () => {
    renderWithI18n(<FileActivityCard view={view({ status: "running" })} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/FileActivityCard.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/assistant/FileActivityCard"`.

- [ ] **Step 3: Implement the component**

Create `tracker/src/components/assistant/FileActivityCard.tsx`:

```tsx
import { ChevronDown, FileText, Loader2, Pencil, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { FileActivityView } from "@/components/assistant/fileActivity";
import { cn } from "@/lib/utils";

export function FileActivityCard({ view }: { view: FileActivityView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = view.status === "running";
  const failed = view.status === "error";
  const verb =
    view.kind === "read"
      ? t("issue.toolCall.fileActivity.read")
      : view.kind === "edit"
        ? t("issue.toolCall.fileActivity.edited")
        : t("issue.toolCall.fileActivity.command");

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border/60 bg-muted/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-busy={running}
        aria-label={t("issue.toolCall.fileActivity.expand")}
      >
        <span className="shrink-0 text-muted-foreground">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <ActivityIcon kind={view.kind} />}
        </span>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{verb}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={view.title}>
          {view.title}
        </span>
        {view.lineRange ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{view.lineRange}</span> : null}
        {view.additions != null && view.additions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-500">+{view.additions}</span>
        ) : null}
        {view.deletions != null && view.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[11px] font-semibold text-rose-500">−{view.deletions}</span>
        ) : null}
        {view.body ? (
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        ) : null}
      </button>
      {open && view.body ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          {view.body.language === "diff" ? <DiffBody value={view.body.value} /> : <PlainBody value={view.body.value} />}
        </div>
      ) : null}
    </article>
  );
}

function ActivityIcon({ kind }: { kind: FileActivityView["kind"] }) {
  if (kind === "edit") return <Pencil className="size-3.5" />;
  if (kind === "command") return <TerminalSquare className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function PlainBody({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
      {value}
    </pre>
  );
}

function DiffBody({ value }: { value: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5">
      {value.split("\n").map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap break-words",
            line.startsWith("+") && !line.startsWith("+++") && "text-emerald-300",
            line.startsWith("-") && !line.startsWith("---") && "text-rose-300",
            line.startsWith("@@") && "text-sky-300",
            !/^[+\-@]/.test(line) && "text-slate-300",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/FileActivityCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/FileActivityCard.tsx tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx
git commit -m "feat(assistant): add FileActivityCard component"
```

---

## Task 4: Render the card in the chat bubble

Make `AssistantBubble` choose `FileActivityCard` for file-operation tool calls and keep `ToolCallBlock` for everything else.

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (imports near `:29-36`; `AssistantBubble` tool-call map at `:1281-1287`)
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx` (add one test)

- [ ] **Step 1: Write the failing integration test**

Append this test inside the top-level `describe` in `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx` (mirror the existing `assistant_completed` test at `:117`):

```tsx
  it("renders file-edit tool calls as a file-activity card and keeps other tools generic", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 42,
        role: "assistant",
        content: "Done.",
        tool_calls: [
          { name: "apply_patch", status: "complete", result: { paths: ["lib/foo.ex"], additions: 12, deletions: 3, diff: "@@\n+a" } },
          { name: "list_issues", status: "complete", result: { issues: [] } },
        ],
      },
    });

    expect(await screen.findByText("lib/foo.ex")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    // Non-file tool call still uses the generic block.
    expect(screen.getByText("List issues")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "file-activity card"`
Expected: FAIL — `lib/foo.ex` not found (the edit renders as a generic `ToolCallBlock`, not a card).

- [ ] **Step 3: Add the import**

In `tracker/src/components/assistant/ProjectAssistantPanel.tsx`, near the other assistant imports (around `:30`), add:

```tsx
import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import { FileActivityCard } from "@/components/assistant/FileActivityCard";
```

- [ ] **Step 4: Switch on file activity in `AssistantBubble`**

Replace the tool-call map block (currently `:1281-1287`):

```tsx
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
            ))}
          </div>
        ) : null}
```

with:

```tsx
        {message.toolCalls.length ? (
          <div className={cn("mt-3 space-y-2 border-t pt-2", isUser && "border-white/20")}>
            {message.toolCalls.map((toolCall, index) => {
              const activity = fileActivityFromToolCall(toolCall);
              return activity ? (
                <FileActivityCard view={activity} key={`fa-${toolCall.name}-${index}`} />
              ) : (
                <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
              );
            })}
          </div>
        ) : null}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "file-activity card"`
Expected: PASS.

- [ ] **Step 6: Run the full panel test file to confirm no regressions**

Run: `cd tracker && npm test -- src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: PASS (all existing tests still green).

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(assistant): render file-activity cards in the chat bubble"
```

---

## Task 5: `FileActivityPresenter` (Elixir, pure)

Translates Codex's native `item/started` / `item/completed` command and file-change events into the assistant tool-call shape. This is the entire backend brain; it is pure (no collector/cross-event state) so it is fully unit-testable. Reads are **not** handled here — they already arrive as MCP `read_workspace_file` tool calls.

**Files:**
- Create: `elixir/lib/symphony_elixir/assistant/file_activity_presenter.ex`
- Test: `elixir/test/symphony_elixir/assistant/file_activity_presenter_test.exs`

> **Confirm field shapes:** The presenter assumes Codex sends, inside `params.item`, a `type` (`command_execution` / `file_change`, matched case-insensitively), an `id`, a `status`, a `command` (string or argv list), an `aggregatedOutput`/`output`, an `exitCode`, and a `unifiedDiff`/`diff` plus optional `changes: [%{path}]`. If you can capture a real rollout (`~/.codex/sessions/**/rollout-*.jsonl`) or app-server log, confirm these keys; only the small `get/2` fallback lists need updating if they differ.

- [ ] **Step 1: Write the failing test**

Create `elixir/test/symphony_elixir/assistant/file_activity_presenter_test.exs`:

```elixir
defmodule SymphonyElixir.Assistant.FileActivityPresenterTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.FileActivityPresenter, as: P

  defp event(method, item) do
    %{event: :notification, payload: %{"method" => method, "params" => %{"item" => item}}}
  end

  test "ignores unrelated events" do
    assert P.from_event(%{payload: %{"method" => "item/agentMessage/delta"}}) == :ignore
    assert P.from_event(event("item/started", %{"type" => "reasoning"})) == :ignore
    assert P.from_event(%{}) == :ignore
    assert P.from_event("nope") == :ignore
  end

  test "translates a started command" do
    assert {:started, tc} =
             P.from_event(event("item/started", %{"id" => "i1", "type" => "command_execution", "command" => "mix test"}))

    assert tc.name == "shell"
    assert tc.status == "running"
    assert tc.id == "i1"
    assert tc.arguments == %{"command" => "mix test"}
  end

  test "translates a completed command with argv, output, and exit code" do
    item = %{
      "id" => "i1",
      "type" => "command_execution",
      "status" => "completed",
      "command" => ["mix", "test"],
      "aggregatedOutput" => "1 passed",
      "exitCode" => 0
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.status == "complete"
    assert tc.arguments == %{"command" => "mix test"}
    assert tc.output == "1 passed"
    assert tc.result == %{"exit_code" => 0}
  end

  test "marks a failed command as error" do
    item = %{"id" => "i1", "type" => "command_execution", "status" => "failed", "command" => "false"}
    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.status == "error"
  end

  test "translates a completed file change with diff counts and explicit paths" do
    diff = "--- a/lib/foo.ex\n+++ b/lib/foo.ex\n@@\n+added one\n+added two\n-removed"

    item = %{
      "id" => "f1",
      "type" => "file_change",
      "status" => "completed",
      "unifiedDiff" => diff,
      "changes" => [%{"path" => "lib/foo.ex"}]
    }

    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.name == "apply_patch"
    assert tc.status == "complete"
    assert tc.result["additions"] == 2
    assert tc.result["deletions"] == 1
    assert tc.result["paths"] == ["lib/foo.ex"]
    assert tc.result["diff"] == diff
  end

  test "derives file paths from the diff when changes are absent (camelCase type)" do
    diff = "--- a/lib/a.ex\n+++ b/lib/a.ex\n@@\n+x"
    item = %{"id" => "f2", "type" => "fileChange", "status" => "completed", "diff" => diff}
    assert {:completed, tc} = P.from_event(event("item/completed", item))
    assert tc.result["paths"] == ["lib/a.ex"]
  end

  test "started file change reports file_count without a diff" do
    item = %{"id" => "f3", "type" => "file_change", "changes" => [%{"path" => "a.ex"}, %{"path" => "b.ex"}]}
    assert {:started, tc} = P.from_event(event("item/started", item))
    assert tc.status == "running"
    assert tc.arguments == %{"paths" => ["a.ex", "b.ex"], "file_count" => 2}
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd elixir && mix test test/symphony_elixir/assistant/file_activity_presenter_test.exs`
Expected: FAIL — `module SymphonyElixir.Assistant.FileActivityPresenter is not available`.

- [ ] **Step 3: Implement the presenter**

Create `elixir/lib/symphony_elixir/assistant/file_activity_presenter.ex`:

```elixir
defmodule SymphonyElixir.Assistant.FileActivityPresenter do
  @moduledoc """
  Pure translation of Codex native command/file-change item events into the
  assistant chat's tool-call shape, so file activity renders as cards.

  Reads are intentionally NOT handled here: they already reach the chat as MCP
  `read_workspace_file` tool calls. This module only surfaces Codex's native
  command execution and file changes, which are otherwise invisible in the chat.
  """

  @type tool_call :: %{
          id: String.t() | nil,
          name: String.t(),
          status: String.t(),
          arguments: map() | nil,
          output: String.t() | nil,
          result: map()
        }

  @spec from_event(term()) :: {:started, tool_call()} | {:completed, tool_call()} | :ignore
  def from_event(message) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}
    method = Map.get(payload, "method") || Map.get(payload, :method)
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}

    case method do
      "item/started" -> from_item(params, :started)
      "item/completed" -> from_item(params, :completed)
      _ -> :ignore
    end
  end

  def from_event(_message), do: :ignore

  defp from_item(params, phase) when is_map(params) do
    item = Map.get(params, "item") || Map.get(params, :item) || %{}

    case classify(get(item, ["type", :type])) do
      :command -> {phase_tag(phase), command_call(item, phase)}
      :file_change -> {phase_tag(phase), file_change_call(item, phase)}
      :other -> :ignore
    end
  end

  defp from_item(_params, _phase), do: :ignore

  defp command_call(item, phase) do
    %{
      id: get(item, ["id", :id]),
      name: "shell",
      status: phase_status(phase, item),
      arguments: %{"command" => command_text(item)},
      output: if(phase == :completed, do: command_output(item), else: nil),
      result: command_result(item, phase)
    }
  end

  defp file_change_call(item, phase) do
    paths = change_paths(item)
    diff = diff_of(item)
    {additions, deletions} = diff_counts(diff)

    result =
      if phase == :completed do
        %{"diff" => diff, "additions" => additions, "deletions" => deletions, "paths" => paths}
      else
        %{"paths" => paths}
      end

    %{
      id: get(item, ["id", :id]),
      name: "apply_patch",
      status: phase_status(phase, item),
      arguments: %{"paths" => paths, "file_count" => length(paths)},
      output: nil,
      result: result
    }
  end

  defp classify(type) when is_binary(type) do
    normalized = type |> String.downcase() |> String.replace(~r/[^a-z]/, "")

    cond do
      String.contains?(normalized, "command") -> :command
      String.contains?(normalized, "filechange") -> :file_change
      String.contains?(normalized, "patch") -> :file_change
      true -> :other
    end
  end

  defp classify(_type), do: :other

  defp phase_tag(:started), do: :started
  defp phase_tag(:completed), do: :completed

  defp phase_status(:started, _item), do: "running"

  defp phase_status(:completed, item) do
    case get(item, ["status", :status]) do
      "failed" -> "error"
      "error" -> "error"
      _ -> "complete"
    end
  end

  defp command_text(item) do
    case get(item, ["command", :command, "parsedCmd", :parsedCmd, "cmd", :cmd]) do
      cmd when is_binary(cmd) -> cmd
      list when is_list(list) -> list |> Enum.filter(&is_binary/1) |> Enum.join(" ")
      _ -> nil
    end
  end

  defp command_output(item) do
    case get(item, ["aggregatedOutput", :aggregatedOutput, "output", :output]) do
      output when is_binary(output) -> output
      _ -> nil
    end
  end

  defp command_result(item, :completed) do
    case get(item, ["exitCode", :exitCode, "exit_code", :exit_code]) do
      code when is_integer(code) -> %{"exit_code" => code}
      _ -> %{}
    end
  end

  defp command_result(_item, :started), do: %{}

  defp change_paths(item) do
    from_changes =
      case get(item, ["changes", :changes]) do
        list when is_list(list) -> list |> Enum.map(&get(&1, ["path", :path])) |> Enum.reject(&is_nil/1)
        _ -> []
      end

    if from_changes == [], do: paths_from_diff(diff_of(item)), else: from_changes
  end

  defp diff_of(item), do: get(item, ["unifiedDiff", :unifiedDiff, "diff", :diff])

  defp paths_from_diff(diff) when is_binary(diff) do
    diff
    |> String.split("\n")
    |> Enum.filter(&String.starts_with?(&1, "+++ "))
    |> Enum.map(fn line ->
      line
      |> String.replace_prefix("+++ ", "")
      |> String.replace_prefix("b/", "")
      |> String.replace_prefix("a/", "")
      |> String.trim()
    end)
    |> Enum.reject(&(&1 == "" or &1 == "/dev/null"))
  end

  defp paths_from_diff(_diff), do: []

  defp diff_counts(diff) when is_binary(diff) do
    lines = String.split(diff, "\n")
    additions = Enum.count(lines, &(String.starts_with?(&1, "+") and not String.starts_with?(&1, "+++")))
    deletions = Enum.count(lines, &(String.starts_with?(&1, "-") and not String.starts_with?(&1, "---")))
    {additions, deletions}
  end

  defp diff_counts(_diff), do: {0, 0}

  defp get(map, keys) when is_map(map), do: Enum.find_value(keys, fn key -> Map.get(map, key) end)
  defp get(_map, _keys), do: nil
end
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd elixir && mix test test/symphony_elixir/assistant/file_activity_presenter_test.exs`
Expected: PASS (all cases).

- [ ] **Step 5: Confirm specs pass for the new public function**

Run: `cd elixir && mix specs.check`
Expected: PASS (the single public `from_event/1` has an adjacent `@spec`).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/file_activity_presenter.ex elixir/test/symphony_elixir/assistant/file_activity_presenter_test.exs
git commit -m "feat(assistant): add FileActivityPresenter for codex file ops"
```

---

## Task 6: Relay Codex file ops through the chat channel

Delegate to the presenter at the top of `relay_codex_event/3`; on a completed op, merge it into the collector (so it persists in the assistant message) and fire the existing tool-call callbacks (so it renders live and pushes via the channel). The pushed payload uses the already-wired `tool_call_started` / `tool_call_completed` channel events (`assistant_channel.ex:548-549`, `:999-1000`) — no channel changes.

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/codex_session.ex` (alias at `:4`; `relay_codex_event/3` at `:765-767`)
- Test: `tracker/src/services/__tests__/assistant.test.ts` (add a normalize test proving the structured fields survive the wire)

- [ ] **Step 1: Add the alias**

In `elixir/lib/symphony_elixir/assistant/codex_session.ex`, extend the assistant alias (`:4`):

```elixir
  alias SymphonyElixir.Assistant.{
    FileActivityPresenter,
    History,
    IssueDocuments,
    ProjectExploreWorkspace,
    ThreadDocuments,
    ToolCallPresenter,
    ToolExecutor
  }
```

- [ ] **Step 2: Delegate to the presenter in the relay**

Replace the head of `relay_codex_event/3` (`:765-769`):

```elixir
  defp relay_codex_event(message, collector, opts) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}
    method = Map.get(payload, "method") || Map.get(payload, :method)

    cond do
      method == "item/agentMessage/delta" ->
```

with (insert the `file_activity` binding and two new `cond` clauses **before** the `item/agentMessage/delta` clause):

```elixir
  defp relay_codex_event(message, collector, opts) when is_map(message) do
    payload = Map.get(message, :payload) || Map.get(message, "payload") || %{}
    method = Map.get(payload, "method") || Map.get(payload, :method)
    file_activity = FileActivityPresenter.from_event(message)

    cond do
      match?({:started, _}, file_activity) ->
        {:started, tool_call} = file_activity
        maybe_call(opts, :on_tool_call_started, tool_call)

      match?({:completed, _}, file_activity) ->
        {:completed, tool_call} = file_activity

        Agent.update(collector, fn state ->
          %{state | tool_calls: upsert_tool_call_by_id(state.tool_calls, Map.get(tool_call, :id), tool_call)}
        end)

        maybe_call(opts, :on_tool_call_completed, tool_call)

      method == "item/agentMessage/delta" ->
```

(Leave the rest of the `cond` unchanged. The two new clauses sit at the top; everything from `item/agentMessage/delta` down is untouched.)

- [ ] **Step 3: Run the existing Elixir suite for the session to confirm no regression**

Run: `cd elixir && mix test test/symphony_elixir/assistant/codex_session_test.exs`
Expected: PASS (existing tests unaffected; the new clauses return `:ignore`-fast for every non-file event).

- [ ] **Step 4: Write the failing frontend normalize test**

In `tracker/src/services/__tests__/assistant.test.ts`, add the import and a new describe block:

```ts
import { normalizeToolCall } from "@/services/assistant";

describe("normalizeToolCall file activity", () => {
  it("preserves apply_patch diff/counts/paths and command args over the wire", () => {
    const edit = normalizeToolCall({
      name: "apply_patch",
      status: "complete",
      arguments: { paths: ["lib/foo.ex"], file_count: 1 },
      result: { diff: "@@\n+a", additions: 1, deletions: 0, paths: ["lib/foo.ex"] },
    });
    expect(edit.name).toBe("apply_patch");
    expect(edit.result.diff).toBe("@@\n+a");
    expect(edit.result.additions).toBe(1);
    expect(edit.result.paths).toEqual(["lib/foo.ex"]);
    expect(edit.arguments).toEqual({ paths: ["lib/foo.ex"], file_count: 1 });

    const cmd = normalizeToolCall({
      name: "shell",
      status: "complete",
      arguments: { command: "mix test" },
      output: "1 passed",
      result: { exit_code: 0 },
    });
    expect(cmd.arguments).toEqual({ command: "mix test" });
    expect(cmd.output).toBe("1 passed");
    expect(cmd.result.exit_code).toBe(0);
  });
});
```

- [ ] **Step 5: Run the normalize test**

Run: `cd tracker && npm test -- src/services/__tests__/assistant.test.ts -t "file activity"`
Expected: PASS (the existing `normalizeToolCall` already spreads unknown `result` keys and copies `arguments`/`output`, so this should pass immediately — it locks the data contract against future regressions).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/codex_session.ex tracker/src/services/__tests__/assistant.test.ts
git commit -m "feat(assistant): relay codex file ops as tool calls in the chat"
```

---

## Task 7: Full gates, manual smoke, and docs

**Files:**
- Modify (if needed): `elixir/README.md` (one line under the assistant section noting file-activity cards)

- [ ] **Step 1: Run the full frontend suite**

Run: `cd tracker && npm test`
Expected: PASS (all suites, including the new `fileActivity`, `FileActivityCard`, panel, and normalize tests).

- [ ] **Step 2: Run the frontend type/lint build**

Run: `cd tracker && npm run build`
Expected: `tsc -b` and `vite build` succeed with no type errors.

- [ ] **Step 3: Run the Elixir gate**

Run: `cd elixir && make all`
Expected: format check, lint, coverage, and dialyzer pass; `mix specs.check` passes (covered by `make all` or run separately).

- [ ] **Step 4: Manual smoke (UI)**

Start the dev serve, open `http://localhost:4000/tracker/projects/:project/assistant/issue/:id`, and prompt the assistant to read a file and make a small edit (e.g. "read README.md lines 1-20, then add a trailing newline"). Confirm:
- A read renders as `Read README.md · L1–20`, expandable to the content.
- An edit renders as `Edited <file> · +N −M`, expandable to a tinted diff.
- A shell command renders as `Ran <command>`, expandable to output.
- Non-file tool calls (e.g. `list_issues`) still render as the generic block.
- Refreshing the page keeps the completed cards (persisted via `tool_calls`).

If a card is missing or empty, capture the Codex event (`~/.codex/sessions/**/rollout-*.jsonl` or the app-server log) and adjust the `get/2` fallback key lists in `FileActivityPresenter` to match the real field names; re-run Task 5's tests.

- [ ] **Step 5: Add a docs note (only if behavior is worth documenting)**

In `elixir/README.md`, under the assistant section, add a short line:

```markdown
- Assistant file activity (Codex reads, edits, and shell commands) renders as
  compact, expandable cards in the chat, surfaced by relaying Codex item events
  through the existing tool-call pipeline.
```

- [ ] **Step 6: Commit**

```bash
git add elixir/README.md
git commit -m "docs(assistant): note file-activity cards in the chat"
```

---

## Self-Review

**Spec coverage:**
- §4 (relay command + file change) → Task 5 (presenter) + Task 6 (relay wiring). Reads need no backend (already MCP tool calls) → handled by Task 2/4.
- §4.1 `turn/diff/updated` enrichment → intentionally deferred to Phase 2 (documented in the header note); per-item completion diff covers v1.
- §5 (classifier + view model) → Task 2.
- §6 (`FileActivityCard`) → Task 3; bubble wiring → Task 4.
- §8 (i18n) → Task 1.
- §9 (error handling/edge cases: missing diff, multi-file, big output, dedup by id, classifier miss, history reload) → covered by Task 2 (null-safe view), Task 3 (collapse/empty body), Task 5 (defensive `get`/diff), Task 6 (`upsert_tool_call_by_id`).
- §10 (testing) → Tasks 2,3,4,5,6 tests; §11 file map matches the files created/modified across tasks; §12 build order matches Task order (reads-first → presenter → relay).

**Placeholder scan:** No TBD/TODO; every code step has complete code; the one "confirm field shapes" note is an explicit, bounded verification step with a concrete fallback location, not a missing implementation.

**Type consistency:** `FileActivityView` fields (`kind`, `title`, `path`, `lineRange`, `additions`, `deletions`, `status`, `body`) are identical in Task 2 (definition), Task 3 (test + component), and Task 4 (usage). `fileActivityFromToolCall` and `FileActivityCard` names are consistent across tasks. The presenter `from_event/1` return shape (`{:started|:completed, tool_call}` / `:ignore`) matches the relay consumption in Task 6, and the tool-call atom keys (`:id/:name/:status/:arguments/:output/:result`) match what `upsert_tool_call_by_id/3` and the channel push expect.

