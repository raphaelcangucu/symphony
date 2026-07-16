# Tool Call Typed Cards — Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo’s real tools (package manager, test runner, linter).
>
> **WSL:** Never run full/batch/parallel test suites. Run **one** targeted Vitest file or `-t` filter at a time, sequentially.

**Goal:** Replace raw ENT/SAÍ JSON tool dumps with typed, human-readable cards (assistant + autonomous) via a shared `canonicalizeToolCall` layer, including KB, DevEnv, Tunnel, and a TurnSummaryStrip.

**Architecture:** Normalize Cursor/Codex/Claude tool shapes into `ToolPresentation`, route in `ToolActivityItem` / session-log path to family-specific cards (or `GenericToolCard`), prove UX on `/dev/tool-call-proposals` with CDE-1180 fixtures before/while wiring production.

**Tech Stack:** React + TypeScript, Vitest, Tailwind, existing `ActivityDisclosure` / `FileActivityCard` / i18next, Vite tracker app.

**Spec:** [`../specs/2026-07-16-tool-call-typed-cards-design.md`](../specs/2026-07-16-tool-call-typed-cards-design.md)  
**Mock:** [`../mocks/2026-07-16-tool-call-cards-mock.html`](../mocks/2026-07-16-tool-call-cards-mock.html)

---

## File map

| Path | Role |
|------|------|
| `tracker/src/lib/toolCallPresentation.ts` | Types: `ToolFamily`, `ToolPresentation`, badges/links |
| `tracker/src/lib/toolCallCanonicalize.ts` | Name aliases, family, field extract, unwrap, heuristics |
| `tracker/src/lib/__tests__/toolCallCanonicalize.test.ts` | Unit tests for canonicalize |
| `tracker/src/lib/toolCallTurnSummary.ts` | Aggregate “Worked for…” from presentations |
| `tracker/src/lib/__tests__/toolCallTurnSummary.test.ts` | Unit tests for turn summary |
| `tracker/src/components/assistant/fileActivity.ts` | Extend READ/COMMAND/EDIT name sets for Cursor/Claude aliases |
| `tracker/src/components/agent-activity/typed-tools/TypedToolCardShell.tsx` | Shared row chrome over `ActivityDisclosure` |
| `tracker/src/components/agent-activity/typed-tools/CommandToolCard.tsx` | `command` (+ PR badge) |
| `tracker/src/components/agent-activity/typed-tools/SearchToolCard.tsx` | `search` |
| `tracker/src/components/agent-activity/typed-tools/PreviewToolCard.tsx` | `preview` + health-wait |
| `tracker/src/components/agent-activity/typed-tools/BoardToolCard.tsx` | `board_query` / `board_action` / `acceptance` |
| `tracker/src/components/agent-activity/typed-tools/EvidenceToolCard.tsx` | `evidence` |
| `tracker/src/components/agent-activity/typed-tools/KbToolCard.tsx` | `kb` |
| `tracker/src/components/agent-activity/typed-tools/DevEnvToolCard.tsx` | `devenv` |
| `tracker/src/components/agent-activity/typed-tools/TunnelToolCard.tsx` | `tunnel` |
| `tracker/src/components/agent-activity/typed-tools/GenericToolCard.tsx` | `generic_mcp` / `other` (evolves ToolCallBlock UX) |
| `tracker/src/components/agent-activity/typed-tools/TurnSummaryStrip.tsx` | End-of-turn strip |
| `tracker/src/components/agent-activity/typed-tools/renderTypedToolCard.tsx` | `family` → card switch |
| `tracker/src/components/agent-activity/ToolActivityItem.tsx` | Router: task → fileActivity → typed → fallback |
| `tracker/src/components/assistant/assistantToolCall.ts` | Optional: feed canonicalize; keep view cache |
| `tracker/src/components/issues/issue-detail/sessionToolCall.ts` | Session pair → minimal call → canonicalize |
| `tracker/src/components/agent-activity/SessionLogTranscript.tsx` or timeline host | Mount TurnSummaryStrip when turn completes |
| `tracker/src/pages/ToolCallProposalsPage.tsx` | Dev sandbox before/after |
| `tracker/src/App.tsx` | Route `dev/tool-call-proposals` |
| `tracker/locales/en/tracker.json` + `pt-BR/tracker.json` | `issue.toolCall.typed.*` keys |

---

### Task 1: `ToolPresentation` types

**Files:**
- Create: `tracker/src/lib/toolCallPresentation.ts`
- Create: `tracker/src/lib/__tests__/toolCallPresentation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { isToolFamily } from "@/lib/toolCallPresentation";

describe("toolCallPresentation", () => {
  it("recognizes known families", () => {
    expect(isToolFamily("command")).toBe(true);
    expect(isToolFamily("kb")).toBe(true);
    expect(isToolFamily("not-a-family")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tracker/`):

```bash
npm test -- src/lib/__tests__/toolCallPresentation.test.ts
```

Expected: FAIL — module or `isToolFamily` not found.

- [ ] **Step 3: Write minimal types**

```typescript
// tracker/src/lib/toolCallPresentation.ts
export const TOOL_FAMILIES = [
  "command",
  "file_read",
  "file_edit",
  "search",
  "preview",
  "board_query",
  "board_action",
  "evidence",
  "acceptance",
  "kb",
  "devenv",
  "tunnel",
  "task",
  "create_plan",
  "generic_mcp",
  "other",
] as const;

export type ToolFamily = (typeof TOOL_FAMILIES)[number];

export function isToolFamily(value: string): value is ToolFamily {
  return (TOOL_FAMILIES as readonly string[]).includes(value);
}

export type ToolPresentationStatus = "running" | "completed" | "failed";

export interface ToolPresentationBadge {
  kind: "ok" | "warn" | "run" | "fail" | "neutral";
  label: string;
}

export interface ToolPresentationLink {
  label: string;
  href: string;
}

export interface ToolPresentation {
  family: ToolFamily;
  /** Resolved tool name after Mcp→toolName unwrap (e.g. manage_preview). */
  toolName: string;
  title: string;
  summary: string | null;
  status: ToolPresentationStatus | null;
  badges: ToolPresentationBadge[];
  links: ToolPresentationLink[];
  /** Short human body (stdout head, steps text, etc.). */
  body: string | null;
  /** Full raw for “Detalhes técnicos”. */
  raw: string | null;
  /** Structured extras for specialized cards. */
  meta: Record<string, unknown>;
  outputTruncated?: boolean;
  outputByteSize?: number | null;
  kbPath?: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/lib/__tests__/toolCallPresentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/toolCallPresentation.ts tracker/src/lib/__tests__/toolCallPresentation.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): add ToolPresentation types for typed tool cards

EOF
)"
```

---

### Task 2: Canonicalize — family + MCP unwrap of name

**Files:**
- Create: `tracker/src/lib/toolCallCanonicalize.ts`
- Create: `tracker/src/lib/__tests__/toolCallCanonicalize.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { canonicalizeToolCall } from "@/lib/toolCallCanonicalize";

describe("canonicalizeToolCall family", () => {
  it("maps Bash description to command family", () => {
    const p = canonicalizeToolCall({
      name: "Bash",
      arguments: {
        description: "Run GranteeAutocomplete unit tests",
        command: "yarn test components/shared/GroupShare/GranteeAutocomplete.test.js",
      },
      status: "completed",
      output: JSON.stringify({
        success: { exitCode: 0, executionTime: 4356, stdout: "PASS\nTests: 4 passed" },
      }),
    });
    expect(p.family).toBe("command");
    expect(p.title).toBe("Run GranteeAutocomplete unit tests");
    expect(p.meta.exitCode).toBe(0);
  });

  it("resolves Cursor Mcp wrapper via toolName", () => {
    const p = canonicalizeToolCall({
      name: "Mcp",
      arguments: {
        toolName: "manage_preview",
        args: { action: "status" },
      },
      status: "completed",
      output: JSON.stringify({
        success: {
          content: [
            {
              text: {
                text: JSON.stringify({
                  data: {
                    identifier: "CDE-1180",
                    servers: [{ port: 4301, status: "starting", url: "https://example.test/" }],
                  },
                  message: "Preview status",
                  tool: "manage_preview",
                }),
              },
            },
          ],
        },
      }),
    });
    expect(p.toolName).toBe("manage_preview");
    expect(p.family).toBe("preview");
    expect(p.meta.action).toBe("status");
    expect(p.links.some((l) => l.href.includes("example.test"))).toBe(true);
  });

  it("maps kb_* to kb family", () => {
    const p = canonicalizeToolCall({
      name: "kb_create_page",
      arguments: {
        repository: "advising",
        path: "superpowers/specs/2026-07-16-cde-1180.md",
        title: "CDE-1180 design",
      },
      status: "completed",
      output: null,
    });
    expect(p.family).toBe("kb");
    expect(p.kbPath).toContain("superpowers/specs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/__tests__/toolCallCanonicalize.test.ts
```

Expected: FAIL — `canonicalizeToolCall` missing.

- [ ] **Step 3: Implement canonicalize (core)**

Implement in `toolCallCanonicalize.ts`:

```typescript
import type { ToolFamily, ToolPresentation, ToolPresentationStatus } from "@/lib/toolCallPresentation";

export interface CanonicalToolInput {
  name: string;
  arguments?: Record<string, unknown> | null;
  output?: string | null;
  status?: string | null;
  result?: unknown;
  outputTruncated?: boolean;
  outputByteSize?: number | null;
}

export function canonicalizeToolCall(input: CanonicalToolInput): ToolPresentation {
  const args = asRecord(input.arguments);
  const { toolName, innerArgs } = resolveToolNameAndArgs(input.name, args);
  const family = familyFor(toolName, innerArgs, input.output ?? null);
  const status = mapStatus(input.status);
  const unwrapped = unwrapOutput(input.output ?? null);
  const built = buildForFamily(family, toolName, innerArgs, unwrapped, status);
  return {
    ...built,
    toolName,
    family,
    status,
    outputTruncated: input.outputTruncated,
    outputByteSize: input.outputByteSize ?? null,
    raw: input.output ?? (args ? JSON.stringify(args, null, 2) : null),
  };
}

function resolveToolNameAndArgs(name: string, args: Record<string, unknown>) {
  if (name === "Mcp" || name === "mcp") {
    const toolName =
      stringOrNull(args.toolName) ?? stringOrNull(args.name) ?? "Mcp";
    const inner = asRecord(args.args) ?? args;
    return { toolName, innerArgs: inner };
  }
  return { toolName: name, innerArgs: args };
}

function familyFor(toolName: string, args: Record<string, unknown>, output: string | null): ToolFamily {
  const n = toolName.toLowerCase();
  if (["bash", "shell", "exec_command"].includes(n)) {
    if (isHealthWaitCommand(stringOrNull(args.command) ?? "")) return "preview";
    return "command";
  }
  if (["read", "read_file", "read_workspace_file"].includes(n)) return "file_read";
  if (["edit", "write", "apply_patch", "edit_file", "write_file"].includes(n)) return "file_edit";
  if (["grep", "glob", "semsearch", "semanticsearch"].includes(n)) return "search";
  if (n === "manage_preview" || n === "list_previews") return "preview";
  if (n === "get_evidence_status" || n === "check_handoff_gate") return "evidence";
  if (n === "update_acceptance_criteria") return "acceptance";
  if (n === "manage_dev_env") return "devenv";
  if (n === "manage_tunnel") return "tunnel";
  if (n.startsWith("kb_")) return "kb";
  if (n === "task" || n === "todowrite" || n === "taskcreate" || n === "taskupdate" || n === "update_plan")
    return "task";
  if (n === "createplan" || n === "create_plan" || n.includes("createplan")) return "create_plan";
  if (n === "set_issue_status" || n === "move_issue" || n.startsWith("dispatch_")) return "board_action";
  if (n.startsWith("list_") || n.startsWith("get_") || n === "list_comments") return "board_query";
  if (n.startsWith("create_") || n.startsWith("update_") || n.startsWith("add_") || n.startsWith("delete_"))
    return "board_action";
  void output;
  return "generic_mcp";
}

// Implement helpers: asRecord, stringOrNull, mapStatus, unwrapOutput,
// buildForFamily (per-family title/summary/badges/links/meta),
// isHealthWaitCommand (curl+sleep+seq), extractPreviewLinks, extractExitCode, etc.
// Strip never-show keys from raw display helpers: parsingResult, conversationId,
// hardTimeout, fileOutputThresholdBytes, closeStdin, skipApproval, …
```

Fill `buildForFamily` so the three tests in Step 1 pass (command title from `description`, preview links from unwrapped servers, kbPath from args.path).

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/__tests__/toolCallCanonicalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/toolCallCanonicalize.ts tracker/src/lib/__tests__/toolCallCanonicalize.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): canonicalize tool calls into typed presentations

EOF
)"
```

---

### Task 3: Heuristics — health-wait, PR link, destructive KB

**Files:**
- Modify: `tracker/src/lib/toolCallCanonicalize.ts`
- Modify: `tracker/src/lib/__tests__/toolCallCanonicalize.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
it("classifies curl+sleep health loops as preview health-wait", () => {
  const p = canonicalizeToolCall({
    name: "Bash",
    arguments: {
      description: "Wait for preview health endpoint",
      command: 'for i in $(seq 1 60); do curl -sf http://127.0.0.1:4301/health && break; sleep 3; done',
    },
    status: "running",
  });
  expect(p.family).toBe("preview");
  expect(p.meta.healthWait).toBe(true);
  expect(p.title.toLowerCase()).toMatch(/health|aguard/i);
});

it("adds PR link badge from gh pr list stdout", () => {
  const p = canonicalizeToolCall({
    name: "Bash",
    arguments: { description: "Check if PR exists", command: "gh pr list --json number,url,state" },
    status: "completed",
    output: JSON.stringify({
      success: {
        exitCode: 0,
        stdout: '[{"number":9918,"state":"OPEN","url":"https://github.com/org/repo/pull/9918"}]',
      },
    }),
  });
  expect(p.links.some((l) => l.href.includes("/pull/9918"))).toBe(true);
});

it("marks kb_delete_folder as destructive", () => {
  const p = canonicalizeToolCall({
    name: "kb_delete_folder",
    arguments: { path: "docs/tmp", repository: "advising" },
    status: "completed",
  });
  expect(p.badges.some((b) => b.kind === "warn")).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL on new assertions**

```bash
npm test -- src/lib/__tests__/toolCallCanonicalize.test.ts
```

- [ ] **Step 3: Implement heuristics** in `isHealthWaitCommand`, PR JSON parse from stdout/interleavedOutput, and warn badge for `kb_delete_*`.

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- src/lib/__tests__/toolCallCanonicalize.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/toolCallCanonicalize.ts tracker/src/lib/__tests__/toolCallCanonicalize.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): add health-wait, PR link, and KB destructive heuristics

EOF
)"
```

---

### Task 4: Extend `fileActivity` aliases

**Files:**
- Modify: `tracker/src/components/assistant/fileActivity.ts`
- Modify: `tracker/src/components/assistant/__tests__/fileActivity.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
it("treats Cursor Read as file read activity", () => {
  const view = fileActivityFromToolCall({
    id: "1",
    name: "Read",
    status: "completed",
    arguments: { path: "shared/GroupShare/GranteeAutocomplete.js" },
    output: "export function …",
  } as AssistantToolCall);
  expect(view?.kind).toBe("read");
  expect(view?.title).toContain("GranteeAutocomplete.js");
});

it("treats Claude Bash as command activity", () => {
  const view = fileActivityFromToolCall({
    id: "2",
    name: "Bash",
    status: "completed",
    arguments: { command: "pwd", description: "Print cwd" },
    output: "/tmp",
  } as AssistantToolCall);
  expect(view?.kind).toBe("command");
});
```

(Adjust `AssistantToolCall` shape to match `services/assistant.ts`.)

- [ ] **Step 2: Run**

```bash
npm test -- src/components/assistant/__tests__/fileActivity.test.ts
```

Expected: FAIL on Read/Bash.

- [ ] **Step 3: Extend sets**

```typescript
const READ_TOOLS = new Set(["read_workspace_file", "read_file", "Read", "read"]);
const EDIT_TOOLS = new Set(["apply_patch", "edit_file", "write_file", "edit", "write", "Write"]);
const COMMAND_TOOLS = new Set(["shell", "exec_command", "bash", "Bash", "Shell"]);
```

Prefer `description` as `title` when present in `commandView`.

- [ ] **Step 4: Run — PASS**

```bash
npm test -- src/components/assistant/__tests__/fileActivity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/fileActivity.ts tracker/src/components/assistant/__tests__/fileActivity.test.ts
git commit -m "$(cat <<'EOF'
fix(tracker): recognize Cursor/Claude file and bash aliases in fileActivity

EOF
)"
```

---

### Task 5: `TypedToolCardShell` + `renderTypedToolCard`

**Files:**
- Create: `tracker/src/components/agent-activity/typed-tools/TypedToolCardShell.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/renderTypedToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/GenericToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/__tests__/GenericToolCard.test.tsx`

- [ ] **Step 1: Failing test — GenericToolCard shows title, hides raw by default**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenericToolCard } from "@/components/agent-activity/typed-tools/GenericToolCard";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

const presentation: ToolPresentation = {
  family: "generic_mcp",
  toolName: "scan_project_setup",
  title: "Scan project setup",
  summary: "advising",
  status: "completed",
  badges: [{ kind: "ok", label: "ok" }],
  links: [],
  body: null,
  raw: '{"noise":true}',
  meta: {},
};

describe("GenericToolCard", () => {
  it("shows human title and not raw JSON by default", () => {
    render(<GenericToolCard presentation={presentation} />);
    expect(screen.getByText("Scan project setup")).toBeTruthy();
    expect(screen.queryByText('{"noise":true}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/agent-activity/typed-tools/__tests__/GenericToolCard.test.tsx
```

- [ ] **Step 3: Implement shell + GenericToolCard**

`TypedToolCardShell`: wraps `ActivityDisclosure` with icon slot, verb (uppercase muted), title, summary, badge row, optional links, details = body + collapsible raw labeled via i18n key `issue.toolCall.typed.technicalDetails`.

`GenericToolCard`: uses shell with Wrench icon; details show `presentation.body` then `<pre>` of `raw` only when expanded (defaultCollapsed true).

`renderTypedToolCard(presentation, props)`: for now only handle `generic_mcp` / `other` → GenericToolCard; return `null` for others (filled in later tasks).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/agent-activity/typed-tools
git commit -m "$(cat <<'EOF'
feat(tracker): add TypedToolCardShell and GenericToolCard

EOF
)"
```

---

### Task 6: Command + Search + Preview cards

**Files:**
- Create: `tracker/src/components/agent-activity/typed-tools/CommandToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/SearchToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/PreviewToolCard.tsx`
- Modify: `tracker/src/components/agent-activity/typed-tools/renderTypedToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/__tests__/CommandToolCard.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("renders command description and exit badge", () => {
  render(
    <CommandToolCard
      presentation={{
        family: "command",
        toolName: "Bash",
        title: "Run GranteeAutocomplete unit tests",
        summary: "yarn test · GranteeAutocomplete.test.js",
        status: "completed",
        badges: [{ kind: "ok", label: "exit 0" }],
        links: [],
        body: "PASS 4 tests",
        raw: null,
        meta: { exitCode: 0 },
      }}
    />,
  );
  expect(screen.getByText("Run GranteeAutocomplete unit tests")).toBeTruthy();
  expect(screen.getByText(/exit 0/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/agent-activity/typed-tools/__tests__/CommandToolCard.test.tsx
```

- [ ] **Step 3: Implement three cards** using `TypedToolCardShell`:
- Command: TerminalSquare; show links (PR); body = stdout head.
- Search: Search icon; title = pattern; summary = path/scope.
- Preview: if `meta.healthWait` → running copy “Aguardando health check”; else action + identifier; render `links` as open URL.

Wire in `renderTypedToolCard`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/agent-activity/typed-tools
git commit -m "$(cat <<'EOF'
feat(tracker): add Command, Search, and Preview typed tool cards

EOF
)"
```

---

### Task 7: Board + Evidence + Acceptance cards

**Files:**
- Create: `tracker/src/components/agent-activity/typed-tools/BoardToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/EvidenceToolCard.tsx`
- Modify: `tracker/src/components/agent-activity/typed-tools/renderTypedToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/__tests__/BoardToolCard.test.tsx`

- [ ] **Step 1: Failing test** — `set_issue_status` presentation shows “CDE-1180” and “Em andamento”.

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/agent-activity/typed-tools/__tests__/BoardToolCard.test.tsx
```

- [ ] **Step 3: Implement**
- `BoardToolCard` for `board_query` | `board_action` | `acceptance` (verb from family; acceptance uses warn styling when `meta.error`).
- `EvidenceToolCard` for gate satisfied / violations list in details.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/agent-activity/typed-tools
git commit -m "$(cat <<'EOF'
feat(tracker): add board and evidence typed tool cards

EOF
)"
```

---

### Task 8: KB + DevEnv + Tunnel cards

**Files:**
- Create: `tracker/src/components/agent-activity/typed-tools/KbToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/DevEnvToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/TunnelToolCard.tsx`
- Modify: `tracker/src/components/agent-activity/typed-tools/renderTypedToolCard.tsx`
- Create: `tracker/src/components/agent-activity/typed-tools/__tests__/KbToolCard.test.tsx`

- [ ] **Step 1: Failing test** — KbCard shows path chip and “abrir no KB” when `kbPath` + `onOpenKbPath` provided.

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/agent-activity/typed-tools/__tests__/KbToolCard.test.tsx
```

- [ ] **Step 3: Implement**
- KbToolCard: BookOpen; path chip; optional `onOpenKbPath(kbPath)`.
- DevEnvToolCard: list steps from `meta.steps` (`{description, command, status?}[]`); warm_up shows port/status.
- TunnelToolCard: running badge + public URL link.

Pass `onOpenKbPath` through `renderTypedToolCard` props.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/agent-activity/typed-tools
git commit -m "$(cat <<'EOF'
feat(tracker): add KB, DevEnv, and Tunnel typed tool cards

EOF
)"
```

---

### Task 9: Wire router in `ToolActivityItem`

**Files:**
- Modify: `tracker/src/components/agent-activity/ToolActivityItem.tsx`
- Create: `tracker/src/components/agent-activity/__tests__/ToolActivityItem.typed.test.tsx`
- Modify: `tracker/src/components/assistant/ToolActivityTimeline.tsx` (or wherever `fileActivityFromToolCall` / views are built) to also compute `presentation` via `canonicalizeToolCall`

**Routing order (must match spec):**

1. `taskSnapshot` + task tool → `AgentTaskInlineCard`
2. `view.kind === "create_plan"` → existing `ToolCallBlock` / CreatePlan path (unchanged)
3. `fileActivity` for `file_read` / `file_edit` / plain `command` **without** `meta.healthWait` → `FileActivityCard` (keep)
4. Else if `presentation` and `renderTypedToolCard` returns non-null → typed card
5. Else → `ToolCallBlock` / kill wrapper as today

- [ ] **Step 1: Failing test** — item with `presentation.family === "preview"` renders Preview title, not raw `parsingResult`.

Build presentation in the test and pass as new optional prop `presentation?: ToolPresentation | null` on `ToolActivityItem` to keep the unit test local; production parent fills it.

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/agent-activity/__tests__/ToolActivityItem.typed.test.tsx
```

- [ ] **Step 3: Implement prop + router branch**; in timeline parent:

```typescript
const presentation = canonicalizeToolCall({
  name: call.name,
  arguments: call.arguments ?? {},
  output: call.output,
  status: call.status,
  result: call.result,
  outputTruncated: call.output_truncated,
  outputByteSize: call.output_byte_size,
});
```

(Field names must match `AssistantToolCall` — adapt.)

Skip typed card when `presentation.family` is `task` | `create_plan` (handled above). For `file_read`/`file_edit`/`command` prefer FileActivityCard when `fileActivity` non-null **and** not health-wait.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/agent-activity tracker/src/components/assistant
git commit -m "$(cat <<'EOF'
feat(tracker): route assistant tool activity through typed cards

EOF
)"
```

---

### Task 10: Wire autonomous session log

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/sessionToolCall.ts`
- Modify: `tracker/src/components/agent-activity/SessionToolActivityGroup.tsx` and/or `SessionLogTranscript.tsx` / item renderer
- Create: `tracker/src/components/issues/issue-detail/__tests__/sessionToolCall.typed.test.ts`

- [ ] **Step 1: Failing test**

```typescript
it("session pair for Bash produces command presentation with description title", () => {
  const pair = {
    call: {
      kind: "tool_call",
      title: "Bash",
      body: JSON.stringify({
        description: "Run GranteeAutocomplete unit tests",
        command: "yarn test …",
      }),
      callId: "c1",
      language: "bash",
    },
    result: {
      kind: "tool_result",
      title: "Bash",
      body: JSON.stringify({ success: { exitCode: 0, stdout: "PASS" } }),
      callId: "c1",
    },
  };
  const { presentation } = sessionPairToTyped(pair); // new helper
  expect(presentation.family).toBe("command");
  expect(presentation.title).toBe("Run GranteeAutocomplete unit tests");
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/components/issues/issue-detail/__tests__/sessionToolCall.typed.test.ts
```

- [ ] **Step 3: Implement `sessionPairToTyped`**
- Parse `call.body` JSON when possible → arguments.
- Map `title` → name (`Bash` / `Mcp` / …).
- Use result body as output.
- Pass `presentation` into the same `ToolActivityItem` used by session groups (or session-specific item that already wraps ToolCallBlock).

Ensure defaultCollapsed for autonomous can stay expanded for running tools only; completed typed cards default collapsed like assistant.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail tracker/src/components/agent-activity
git commit -m "$(cat <<'EOF'
feat(tracker): typed tool cards on autonomous session log

EOF
)"
```

---

### Task 11: `TurnSummaryStrip`

**Files:**
- Create: `tracker/src/lib/toolCallTurnSummary.ts`
- Create: `tracker/src/lib/__tests__/toolCallTurnSummary.test.ts`
- Create: `tracker/src/components/agent-activity/typed-tools/TurnSummaryStrip.tsx`
- Modify: assistant turn footer / `AssistantTurnTimeline` or message bubble end

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { summarizeToolPresentations } from "@/lib/toolCallTurnSummary";

it("aggregates family counts and formats duration", () => {
  const summary = summarizeToolPresentations(
    [
      { family: "command" },
      { family: "command" },
      { family: "kb" },
      { family: "preview" },
    ] as ToolPresentation[],
    { durationMs: 128000 },
  );
  expect(summary.headline).toMatch(/2m|1m 28s|128/);
  expect(summary.chips).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: expect.stringMatching(/2/) }),
    ]),
  );
});
```

Use a stable formatter: `Worked for 2m 8s` from ms.

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- src/lib/__tests__/toolCallTurnSummary.test.ts
```

- [ ] **Step 3: Implement** `summarizeToolPresentations` + presentational `TurnSummaryStrip` (dashed border strip matching mock). Mount at end of a completed assistant turn when `toolCalls.length > 0` and turn not streaming.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/lib/toolCallTurnSummary.ts tracker/src/lib/__tests__/toolCallTurnSummary.test.ts tracker/src/components/agent-activity/typed-tools/TurnSummaryStrip.tsx tracker/src/components/assistant
git commit -m "$(cat <<'EOF'
feat(tracker): add Worked for turn summary strip

EOF
)"
```

---

### Task 12: Dev sandbox `/dev/tool-call-proposals`

**Files:**
- Create: `tracker/src/pages/ToolCallProposalsPage.tsx`
- Modify: `tracker/src/App.tsx` (import + route next to `dev/assistant-session-proposals`)
- Create: `tracker/src/pages/toolCallProposalFixtures.ts` — fixtures from CDE-1180 + KB/DevEnv samples

- [ ] **Step 1: Add page that renders two columns**
- Left: existing `ToolCallBlock` via `assistantToolCallToView` / raw JSON strings (before).
- Right: `canonicalizeToolCall` → `renderTypedToolCard` + `TurnSummaryStrip` (after).
- Tabs: `mixed` | `bash` | `mcp` | `extras` (same as HTML mock).

No Phoenix. Use static fixture objects.

- [ ] **Step 2: Register route**

```tsx
<Route path="dev/tool-call-proposals" element={<ToolCallProposalsPage />} />
```

- [ ] **Step 3: Manual check**

```bash
npm run dev
```

Open `http://localhost:5173/tracker/dev/tool-call-proposals` (adjust base path if tracker is mounted under `/tracker`). Confirm before/after for mixed + extras tabs.

- [ ] **Step 4: Commit**

```bash
git add tracker/src/pages/ToolCallProposalsPage.tsx tracker/src/pages/toolCallProposalFixtures.ts tracker/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): add /dev/tool-call-proposals typed cards sandbox

EOF
)"
```

---

### Task 13: i18n keys

**Files:**
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`

Add under `issue.toolCall.typed` (exact nesting to match existing `issue.toolCall`):

```json
{
  "technicalDetails": "Technical details",
  "workedFor": "Worked for {{duration}}",
  "families": {
    "command": "Command",
    "search": "Search",
    "preview": "Preview",
    "board": "Board",
    "evidence": "Evidence",
    "acceptance": "Acceptance",
    "kb": "Knowledge base",
    "devenv": "Dev environment",
    "tunnel": "Tunnel"
  },
  "healthWait": "Waiting for health check",
  "openUrl": "Open URL",
  "openInKb": "Open in KB",
  "destructive": "Destructive",
  "readCluster": "Read {{count}} files"
}
```

pt-BR equivalents (Comando, Busca, Preview, Board, Evidence, …, “Aguardando health check”, “Abrir URL”, “Abrir no KB”, “Destrutivo”, “Leu {{count}} arquivos”, “Trabalhou {{duration}}”).

- [ ] **Step 1: Add keys**
- [ ] **Step 2: Replace hardcoded card verbs** to `t("issue.toolCall.typed.families.*")` where cards still use English literals from earlier tasks.
- [ ] **Step 3: Commit**

```bash
git add tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json tracker/src/components/agent-activity/typed-tools
git commit -m "$(cat <<'EOF'
feat(tracker): i18n for typed tool call cards

EOF
)"
```

---

### Task 14: Spec status + smoke checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-tool-call-typed-cards-design.md` — Status → `implemented` when done (or `in progress` at start of execution).

- [ ] **Step 1: Manual smoke (no full suite)**
1. `/dev/tool-call-proposals` — all four tabs.
2. Interactive assistant turn with Bash + MCP — cards not JSON.
3. Autonomous `surface=autonomous` on an issue with recent tools — same.
4. CreatePlan / Task still work.
5. Kill button still shows on running tools.

- [ ] **Step 2: Run one regression file**

```bash
npm test -- src/components/shared/__tests__/ToolCallBlock.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Final commit** if status/docs tweaks remain.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `canonicalizeToolCall` | 2–3 |
| Families including kb/devenv/tunnel | 2, 8 |
| Health-wait / PR / destructive | 3 |
| Cards tipados | 5–8 |
| GenericToolCard fallback | 5 |
| Assistant router | 9 |
| Autonomous session log | 10 |
| Worked for… | 11 |
| Sandbox `/dev/tool-call-proposals` | 12 |
| Cursor/Claude aliases in file activity | 4 |
| i18n | 13 |
| Keep Task/CreatePlan | 9 (explicit skip) |
| Tests + WSL single-file | every task |

## Placeholder / consistency notes

- `AssistantToolCall` field names for truncation may be `outputTruncated` vs `output_truncated` — match `services/assistant.ts` when wiring Task 9.
- `sessionPairToTyped` is a **new** export; keep `sessionPairToView` for backward compatibility until all callers pass presentation.
- Do not delete `ToolCallBlock`; GenericToolCard and CreatePlan still use it or share Section helpers if useful.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-tool-call-typed-cards-plan.md`.

Documents:
- Plan: `docs/superpowers/plans/2026-07-16-tool-call-typed-cards-plan.md`
- Spec: `docs/superpowers/specs/2026-07-16-tool-call-typed-cards-design.md`
- Mock: `docs/superpowers/mocks/2026-07-16-tool-call-cards-mock.html`
