# Project Configuration Editor Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Frontend tests run from `tracker/` with `pnpm exec vitest run <file>`; lint with `pnpm exec eslint <path>`; types with `pnpm exec tsc -b`. Backend tests run from `elixir/` with `mise exec -- mix test <path>`.

**Goal:** Make a project 100% self-configurable from the UI by exposing every per-project `workflow_config` section (plus prompt/hooks/validation) in a reusable tabbed editor used by both the project edit screen and the create flow.

**Architecture:** A single `ProjectConfigEditor` React component renders one tab per config section, driven by a typed `WorkflowConfig` model with prune-on-save (no fabricated defaults). It loads via the existing `GET /projects/:id` (which returns `setup`) and saves via the existing `PUT /projects/:id` (project/tracker) and `PUT /projects/:id/setup` (validated `workflow_config` + prompt + hooks). A dedicated page route `projects/:slug/settings` mounts it; the legacy prompt-only `EditProjectDialog` is retired and `/edit` redirects to `/settings`. The create wizard stays lean and redirects to `/settings` after creation.

**Tech Stack:** React + TypeScript (Vite), react-router-dom, Vitest + Testing Library, Tailwind UI primitives (`tabs`, `input`, `textarea`, `button`, `badge`, `card`). Backend: Elixir/Phoenix (no new endpoints).

Spec: `docs/superpowers/specs/2026-06-03-project-config-editor-design.md`.

---

## File Structure

**Create:**
- `tracker/src/types/workflow-config.ts` — typed `WorkflowConfig` (snake_case keys mirroring the Elixir schema) + `WorkflowConfigForm` shape.
- `tracker/src/lib/workflowConfig.ts` — `workflowConfigToForm`, `buildWorkflowConfig` (prune empties), `pruneEmpty` helper.
- `tracker/src/lib/__tests__/workflowConfig.test.ts`
- `tracker/src/components/projects/config/StateMultiSelect.tsx`
- `tracker/src/components/projects/config/__tests__/StateMultiSelect.test.tsx`
- `tracker/src/components/projects/config/KeyValueMapEditor.tsx`
- `tracker/src/components/projects/config/__tests__/KeyValueMapEditor.test.tsx`
- `tracker/src/components/projects/config/ScalarField.tsx` — generic typed scalar input (string/number/boolean/enum).
- `tracker/src/components/projects/config/sectionFields.ts` — descriptor arrays for scalar fields per section.
- `tracker/src/components/projects/ProjectConfigEditor.tsx` — the tabbed editor.
- `tracker/src/components/projects/__tests__/ProjectConfigEditor.test.tsx`
- `tracker/src/pages/ProjectSettingsPage.tsx`
- `tracker/src/pages/__tests__/ProjectSettingsPage.test.tsx`

**Modify:**
- `tracker/src/types/project-setup.ts` — type `workflowConfig` as `WorkflowConfig`.
- `tracker/src/services/projects.ts:29-34` — type `UpdateProjectSetupInput.workflowConfig` as `WorkflowConfig`.
- `tracker/src/App.tsx:50-55` — add `projects/:projectSlug/settings` route; make `/edit` redirect.
- `tracker/src/components/layout/ProjectWorkspaceLayout.tsx` — gear button navigates to settings; remove inline `EditProjectDialog`.
- `tracker/src/lib/workspaceRoutes.ts:71-73` — add `projectSettingsPath`.
- `tracker/src/components/projects/ProjectWorkspaceWizard.tsx:244-258,283-297` — redirect to settings after create.

**Delete:**
- `tracker/src/components/projects/EditProjectDialog.tsx` and its test `__tests__/EditProjectDialog.test.tsx` (tracker-source UI moves into the editor's Tracker tab).
- `tracker/src/components/projects/EditProjectRoute.tsx` (replaced by redirect; see Task 7).

**Backend (test only):**
- `elixir/test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs` — add a full structured `workflow_config` round-trip case.

---

## Task 1: Typed WorkflowConfig model + form converters

**Files:**
- Create: `tracker/src/types/workflow-config.ts`
- Create: `tracker/src/lib/workflowConfig.ts`
- Test: `tracker/src/lib/__tests__/workflowConfig.test.ts`
- Modify: `tracker/src/types/project-setup.ts`

- [ ] **Step 1: Create the typed model**

`tracker/src/types/workflow-config.ts`:

```ts
export interface WorkflowConfigTracker {
  active_states?: string[];
  dispatch_states?: string[];
  wait_states?: string[];
  terminal_states?: string[];
  field_states?: string[];
}

export interface WorkflowConfigAgent {
  max_turns?: number;
  max_concurrent_agents?: number;
  max_retry_backoff_ms?: number;
  max_concurrent_agents_by_state?: Record<string, number>;
  completion_transitions?: Record<string, string>;
  turn_timeout_ms?: number;
  read_timeout_ms?: number;
  stall_timeout_ms?: number;
}

export interface WorkflowConfigHooks {
  after_create?: string | null;
  before_run?: string | null;
  after_run?: string | null;
  before_remove?: string | null;
  timeout_ms?: number;
}

export interface WorkflowConfigWorkspace {
  root?: string | null;
}

export interface WorkflowConfigEditor {
  enabled?: boolean;
  binary?: string;
  host?: string;
  port?: number;
  auth?: "none" | "password";
  password?: string | null;
  base_url?: string | null;
}

export interface WorkflowConfigDevServer {
  enabled?: boolean;
  port_range?: number[];
  max_concurrent?: number;
  idle_timeout_ms?: number;
  auto_start_on?: Array<"pull_request" | "human_review">;
  base_url?: string | null;
}

export interface WorkflowConfigPublicTunnel {
  enabled?: boolean;
  base_domain?: string;
  namespace?: string | null;
}

export interface WorkflowConfigGithub {
  read_interval_ms?: number;
  mutation_interval_ms?: number;
  max_retries?: number;
  max_backoff_ms?: number;
}

export interface WorkflowConfig {
  tracker?: WorkflowConfigTracker;
  agent?: WorkflowConfigAgent;
  hooks?: WorkflowConfigHooks;
  workspace?: WorkflowConfigWorkspace;
  editor?: WorkflowConfigEditor;
  dev_server?: WorkflowConfigDevServer;
  public_tunnel?: WorkflowConfigPublicTunnel;
  github?: WorkflowConfigGithub;
  // process-level sections (server/observability/polling) are intentionally not modeled here
}
```

`tracker/src/types/project-setup.ts` — change the `workflowConfig` field type:

```ts
import type { WorkflowConfig } from "./workflow-config";
// ...
export interface ProjectSetup {
  id?: string;
  workflowConfig?: WorkflowConfig;
  afterCreateHook?: string | null;
  promptTemplate?: string | null;
  validationCommands: string[];
  scanSummary?: Record<string, unknown>;
}
```

- [ ] **Step 2: Write the failing test for the converters**

`tracker/src/lib/__tests__/workflowConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildWorkflowConfig, workflowConfigToForm } from "@/lib/workflowConfig";

describe("workflowConfig converters", () => {
  it("reads an existing config into form state, defaulting absent collections to empty", () => {
    const form = workflowConfigToForm({
      tracker: { active_states: ["Todo", "In Progress"], terminal_states: ["Done"] },
      agent: { max_turns: 40, completion_transitions: { "In Review": "Done" } },
    });

    expect(form.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(form.tracker.dispatch_states).toEqual([]);
    expect(form.agent.max_turns).toBe(40);
    expect(form.agent.completion_transitions).toEqual({ "In Review": "Done" });
    expect(form.agent.max_concurrent_agents_by_state).toEqual({});
    expect(form.editor.enabled).toBe(false);
  });

  it("builds a config that omits empty strings, empty arrays, empty maps, and undefined numbers", () => {
    const form = workflowConfigToForm({});
    form.tracker.active_states = ["Todo"];
    form.agent.max_turns = 25;

    const built = buildWorkflowConfig(form);

    expect(built).toEqual({
      tracker: { active_states: ["Todo"] },
      agent: { max_turns: 25 },
    });
    expect(built.hooks).toBeUndefined();
    expect(built.editor).toBeUndefined();
  });

  it("round-trips a populated config without inventing defaults", () => {
    const original = {
      tracker: { active_states: ["Todo"], dispatch_states: ["Todo"] },
      hooks: { after_create: "echo hi" },
      editor: { enabled: true, port: 8443, auth: "password" as const },
    };

    expect(buildWorkflowConfig(workflowConfigToForm(original))).toEqual(original);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/lib/__tests__/workflowConfig.test.ts`
Expected: FAIL — `Cannot find module '@/lib/workflowConfig'`.

- [ ] **Step 4: Implement the converters**

`tracker/src/lib/workflowConfig.ts`:

```ts
import type {
  WorkflowConfig,
  WorkflowConfigDevServer,
  WorkflowConfigEditor,
  WorkflowConfigGithub,
  WorkflowConfigHooks,
  WorkflowConfigPublicTunnel,
} from "@/types/workflow-config";

export interface WorkflowConfigForm {
  tracker: {
    active_states: string[];
    dispatch_states: string[];
    wait_states: string[];
    terminal_states: string[];
    field_states: string[];
  };
  agent: {
    max_turns?: number;
    max_concurrent_agents?: number;
    max_retry_backoff_ms?: number;
    turn_timeout_ms?: number;
    read_timeout_ms?: number;
    stall_timeout_ms?: number;
    max_concurrent_agents_by_state: Record<string, number>;
    completion_transitions: Record<string, string>;
  };
  hooks: Required<Pick<WorkflowConfigHooks, "after_create" | "before_run" | "after_run" | "before_remove">> & {
    timeout_ms?: number;
  };
  workspace: { root: string };
  editor: {
    enabled: boolean;
    binary: string;
    host: string;
    port?: number;
    auth: "none" | "password";
    password: string;
    base_url: string;
  };
  dev_server: {
    enabled: boolean;
    port_range: string; // comma-separated; parsed on build
    max_concurrent?: number;
    idle_timeout_ms?: number;
    auto_start_on: Array<"pull_request" | "human_review">;
    base_url: string;
  };
  public_tunnel: { enabled: boolean; base_domain: string; namespace: string };
  github: {
    read_interval_ms?: number;
    mutation_interval_ms?: number;
    max_retries?: number;
    max_backoff_ms?: number;
  };
}

export function workflowConfigToForm(config: WorkflowConfig | undefined): WorkflowConfigForm {
  const c = config ?? {};
  return {
    tracker: {
      active_states: c.tracker?.active_states ?? [],
      dispatch_states: c.tracker?.dispatch_states ?? [],
      wait_states: c.tracker?.wait_states ?? [],
      terminal_states: c.tracker?.terminal_states ?? [],
      field_states: c.tracker?.field_states ?? [],
    },
    agent: {
      max_turns: c.agent?.max_turns,
      max_concurrent_agents: c.agent?.max_concurrent_agents,
      max_retry_backoff_ms: c.agent?.max_retry_backoff_ms,
      turn_timeout_ms: c.agent?.turn_timeout_ms,
      read_timeout_ms: c.agent?.read_timeout_ms,
      stall_timeout_ms: c.agent?.stall_timeout_ms,
      max_concurrent_agents_by_state: c.agent?.max_concurrent_agents_by_state ?? {},
      completion_transitions: c.agent?.completion_transitions ?? {},
    },
    hooks: {
      after_create: c.hooks?.after_create ?? "",
      before_run: c.hooks?.before_run ?? "",
      after_run: c.hooks?.after_run ?? "",
      before_remove: c.hooks?.before_remove ?? "",
      timeout_ms: c.hooks?.timeout_ms,
    },
    workspace: { root: c.workspace?.root ?? "" },
    editor: {
      enabled: c.editor?.enabled ?? false,
      binary: c.editor?.binary ?? "",
      host: c.editor?.host ?? "",
      port: c.editor?.port,
      auth: c.editor?.auth ?? "none",
      password: c.editor?.password ?? "",
      base_url: c.editor?.base_url ?? "",
    },
    dev_server: {
      enabled: c.dev_server?.enabled ?? false,
      port_range: (c.dev_server?.port_range ?? []).join(", "),
      max_concurrent: c.dev_server?.max_concurrent,
      idle_timeout_ms: c.dev_server?.idle_timeout_ms,
      auto_start_on: c.dev_server?.auto_start_on ?? [],
      base_url: c.dev_server?.base_url ?? "",
    },
    public_tunnel: {
      enabled: c.public_tunnel?.enabled ?? false,
      base_domain: c.public_tunnel?.base_domain ?? "",
      namespace: c.public_tunnel?.namespace ?? "",
    },
    github: {
      read_interval_ms: c.github?.read_interval_ms,
      mutation_interval_ms: c.github?.mutation_interval_ms,
      max_retries: c.github?.max_retries,
      max_backoff_ms: c.github?.max_backoff_ms,
    },
  };
}

function pruneEmpty<T extends Record<string, unknown>>(section: T): Partial<T> | undefined {
  const entries = Object.entries(section).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
  });
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

function parsePortRange(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function buildWorkflowConfig(form: WorkflowConfigForm): WorkflowConfig {
  const editor: WorkflowConfigEditor = {
    enabled: form.editor.enabled || undefined,
    binary: form.editor.binary || undefined,
    host: form.editor.host || undefined,
    port: form.editor.port,
    auth: form.editor.auth !== "none" ? form.editor.auth : undefined,
    password: form.editor.password || undefined,
    base_url: form.editor.base_url || undefined,
  };
  const devServer: WorkflowConfigDevServer = {
    enabled: form.dev_server.enabled || undefined,
    port_range: parsePortRange(form.dev_server.port_range).length ? parsePortRange(form.dev_server.port_range) : undefined,
    max_concurrent: form.dev_server.max_concurrent,
    idle_timeout_ms: form.dev_server.idle_timeout_ms,
    auto_start_on: form.dev_server.auto_start_on.length ? form.dev_server.auto_start_on : undefined,
    base_url: form.dev_server.base_url || undefined,
  };
  const tunnel: WorkflowConfigPublicTunnel = {
    enabled: form.public_tunnel.enabled || undefined,
    base_domain: form.public_tunnel.base_domain || undefined,
    namespace: form.public_tunnel.namespace || undefined,
  };
  const github: WorkflowConfigGithub = {
    read_interval_ms: form.github.read_interval_ms,
    mutation_interval_ms: form.github.mutation_interval_ms,
    max_retries: form.github.max_retries,
    max_backoff_ms: form.github.max_backoff_ms,
  };
  const hooks: WorkflowConfigHooks = {
    after_create: form.hooks.after_create || undefined,
    before_run: form.hooks.before_run || undefined,
    after_run: form.hooks.after_run || undefined,
    before_remove: form.hooks.before_remove || undefined,
    timeout_ms: form.hooks.timeout_ms,
  };

  const config: WorkflowConfig = {
    tracker: pruneEmpty(form.tracker),
    agent: pruneEmpty(form.agent),
    hooks: pruneEmpty(hooks as Record<string, unknown>) as WorkflowConfigHooks | undefined,
    workspace: pruneEmpty(form.workspace) as WorkflowConfig["workspace"],
    editor: pruneEmpty(editor as Record<string, unknown>) as WorkflowConfigEditor | undefined,
    dev_server: pruneEmpty(devServer as Record<string, unknown>) as WorkflowConfigDevServer | undefined,
    public_tunnel: pruneEmpty(tunnel as Record<string, unknown>) as WorkflowConfigPublicTunnel | undefined,
    github: pruneEmpty(github as Record<string, unknown>) as WorkflowConfigGithub | undefined,
  };

  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as WorkflowConfig;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tracker && pnpm exec vitest run src/lib/__tests__/workflowConfig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Type-check and commit**

Run: `cd tracker && pnpm exec tsc -b`
Expected: exit 0.

```bash
git add tracker/src/types/workflow-config.ts tracker/src/lib/workflowConfig.ts tracker/src/lib/__tests__/workflowConfig.test.ts tracker/src/types/project-setup.ts
git commit -m "feat(tracker): typed workflow_config model and form converters"
```

---

## Task 2: StateMultiSelect component

**Files:**
- Create: `tracker/src/components/projects/config/StateMultiSelect.tsx`
- Test: `tracker/src/components/projects/config/__tests__/StateMultiSelect.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StateMultiSelect } from "@/components/projects/config/StateMultiSelect";

describe("StateMultiSelect", () => {
  it("renders one toggle per available status and marks selected ones", () => {
    render(
      <StateMultiSelect
        label="Active states"
        available={["Todo", "In Progress", "Done"]}
        value={["In Progress"]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Todo", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In Progress", pressed: true })).toBeInTheDocument();
  });

  it("adds a status on click and removes it on second click", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StateMultiSelect label="Active states" available={["Todo", "Done"]} value={[]} onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(onChange).toHaveBeenLastCalledWith(["Todo"]);

    rerender(<StateMultiSelect label="Active states" available={["Todo", "Done"]} value={["Todo"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/StateMultiSelect.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`tracker/src/components/projects/config/StateMultiSelect.tsx`:

```tsx
interface StateMultiSelectProps {
  label: string;
  description?: string;
  available: string[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function StateMultiSelect({ label, description, available, value, onChange }: StateMultiSelectProps) {
  const selected = new Set(value);

  function toggle(state: string) {
    const next = selected.has(state) ? value.filter((item) => item !== state) : [...value, state];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">No statuses defined for this project yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((state) => {
            const isSelected = selected.has(state);
            return (
              <button
                key={state}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(state)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  isSelected ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {state}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/StateMultiSelect.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/config/StateMultiSelect.tsx tracker/src/components/projects/config/__tests__/StateMultiSelect.test.tsx
git commit -m "feat(tracker): StateMultiSelect for workflow state config"
```

---

## Task 3: KeyValueMapEditor component

**Files:**
- Create: `tracker/src/components/projects/config/KeyValueMapEditor.tsx`
- Test: `tracker/src/components/projects/config/__tests__/KeyValueMapEditor.test.tsx`

Used for `completion_transitions` (state→state) and `max_concurrent_agents_by_state` (state→number). Keys are chosen from the project's statuses; the value editor is configurable (a `<select>` of states, or a number input).

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeyValueMapEditor } from "@/components/projects/config/KeyValueMapEditor";

describe("KeyValueMapEditor", () => {
  it("lists existing entries and removes one", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueMapEditor
        label="Completion transitions"
        keyOptions={["In Review", "Done"]}
        valueKind="state"
        valueOptions={["In Review", "Done"]}
        value={{ "In Review": "Done" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("In Review")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove In Review/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("adds a new key/value entry", async () => {
    const onChange = vi.fn();
    render(
      <KeyValueMapEditor
        label="Concurrency by state"
        keyOptions={["In Progress"]}
        valueKind="number"
        value={{}}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/add key/i), "In Progress");
    await userEvent.type(screen.getByLabelText(/new value/i), "2");
    await userEvent.click(screen.getByRole("button", { name: /add entry/i }));

    expect(onChange).toHaveBeenCalledWith({ "In Progress": 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/KeyValueMapEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`tracker/src/components/projects/config/KeyValueMapEditor.tsx`:

```tsx
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ValueKind = "state" | "number";

interface KeyValueMapEditorProps {
  label: string;
  description?: string;
  keyOptions: string[];
  valueKind: ValueKind;
  valueOptions?: string[];
  value: Record<string, string | number>;
  onChange: (next: Record<string, string | number>) => void;
}

export function KeyValueMapEditor({
  label,
  description,
  keyOptions,
  valueKind,
  valueOptions = [],
  value,
  onChange,
}: KeyValueMapEditorProps) {
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const usedKeys = new Set(Object.keys(value));
  const availableKeys = keyOptions.filter((key) => !usedKeys.has(key));

  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function add() {
    if (!draftKey) return;
    if (valueKind === "number") {
      const parsed = Number.parseInt(draftValue, 10);
      if (!Number.isInteger(parsed) || parsed < 1) return;
      onChange({ ...value, [draftKey]: parsed });
    } else {
      if (!draftValue) return;
      onChange({ ...value, [draftKey]: draftValue });
    }
    setDraftKey("");
    setDraftValue("");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

      <div className="space-y-1">
        {Object.entries(value).map(([key, entryValue]) => (
          <div key={key} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span className="font-medium">{key}</span>
            <span className="text-muted-foreground">→ {String(entryValue)}</span>
            <button
              type="button"
              aria-label={`remove ${key}`}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={() => remove(key)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span>Add key</span>
          <select
            aria-label="add key"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          >
            <option value="">Select state…</option>
            {availableKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        {valueKind === "state" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span>New value</span>
            <select
              aria-label="new value"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
            >
              <option value="">Select state…</option>
              {valueOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span>New value</span>
            <Input
              aria-label="new value"
              type="number"
              min={1}
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              className="h-9 w-24"
            />
          </label>
        )}

        <Button type="button" variant="secondary" size="sm" onClick={add}>
          Add entry
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/KeyValueMapEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/config/KeyValueMapEditor.tsx tracker/src/components/projects/config/__tests__/KeyValueMapEditor.test.tsx
git commit -m "feat(tracker): KeyValueMapEditor for state-keyed config maps"
```

---

## Task 4: ScalarField + section field descriptors

**Files:**
- Create: `tracker/src/components/projects/config/ScalarField.tsx`
- Create: `tracker/src/components/projects/config/sectionFields.ts`
- Test: `tracker/src/components/projects/config/__tests__/ScalarField.test.tsx`

`ScalarField` renders one typed input (string, number, boolean, or enum) from a descriptor, keeping the per-tab JSX small and DRY.

- [ ] **Step 1: Write the failing test**

`tracker/src/components/projects/config/__tests__/ScalarField.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ScalarField } from "@/components/projects/config/ScalarField";

describe("ScalarField", () => {
  it("emits parsed integers for number fields and undefined when cleared", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ScalarField descriptor={{ key: "max_turns", label: "Max turns", kind: "number" }} value={40} onChange={onChange} />,
    );

    const input = screen.getByLabelText("Max turns");
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    rerender(<ScalarField descriptor={{ key: "max_turns", label: "Max turns", kind: "number" }} value={undefined} onChange={onChange} />);
    await userEvent.type(input, "12");
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("renders a checkbox for boolean fields", async () => {
    const onChange = vi.fn();
    render(
      <ScalarField descriptor={{ key: "enabled", label: "Enabled", kind: "boolean" }} value={false} onChange={onChange} />,
    );

    await userEvent.click(screen.getByLabelText("Enabled"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/ScalarField.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ScalarField and descriptors**

`tracker/src/components/projects/config/ScalarField.tsx`:

```tsx
import { useId } from "react";

import { Input } from "@/components/ui/input";

export interface ScalarDescriptor {
  key: string;
  label: string;
  kind: "string" | "number" | "boolean" | "enum";
  options?: string[];
  placeholder?: string;
  description?: string;
}

type ScalarValue = string | number | boolean | undefined;

interface ScalarFieldProps {
  descriptor: ScalarDescriptor;
  value: ScalarValue;
  onChange: (next: ScalarValue) => void;
}

export function ScalarField({ descriptor, value, onChange }: ScalarFieldProps) {
  const id = useId();

  if (descriptor.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={descriptor.label}
        />
        {descriptor.label}
      </label>
    );
  }

  if (descriptor.kind === "enum") {
    return (
      <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
        <span className="font-medium">{descriptor.label}</span>
        <select
          id={id}
          aria-label={descriptor.label}
          className="h-9 rounded-md border bg-background px-2"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {(descriptor.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const isNumber = descriptor.kind === "number";
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="font-medium">{descriptor.label}</span>
      {descriptor.description ? <span className="text-xs text-muted-foreground">{descriptor.description}</span> : null}
      <Input
        id={id}
        aria-label={descriptor.label}
        type={isNumber ? "number" : "text"}
        min={isNumber ? 0 : undefined}
        placeholder={descriptor.placeholder}
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (!isNumber) {
            onChange(raw);
            return;
          }
          if (raw.trim() === "") {
            onChange(undefined);
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          onChange(Number.isInteger(parsed) ? parsed : undefined);
        }}
      />
    </label>
  );
}
```

`tracker/src/components/projects/config/sectionFields.ts`:

```ts
import type { ScalarDescriptor } from "./ScalarField";

export const AGENT_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "max_turns", label: "Max turns", kind: "number" },
  { key: "max_concurrent_agents", label: "Max concurrent agents", kind: "number" },
  { key: "max_retry_backoff_ms", label: "Max retry backoff (ms)", kind: "number" },
  { key: "turn_timeout_ms", label: "Turn timeout (ms)", kind: "number" },
  { key: "read_timeout_ms", label: "Read timeout (ms)", kind: "number" },
  { key: "stall_timeout_ms", label: "Stall timeout (ms)", kind: "number" },
];

export const EDITOR_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "binary", label: "Binary", kind: "string", placeholder: "code-server" },
  { key: "host", label: "Host", kind: "string" },
  { key: "port", label: "Port", kind: "number" },
  { key: "auth", label: "Auth", kind: "enum", options: ["none", "password"] },
  { key: "password", label: "Password", kind: "string" },
  { key: "base_url", label: "Base URL", kind: "string" },
];

export const DEV_SERVER_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "max_concurrent", label: "Max concurrent", kind: "number" },
  { key: "idle_timeout_ms", label: "Idle timeout (ms)", kind: "number" },
  { key: "base_url", label: "Base URL", kind: "string" },
];

export const PUBLIC_TUNNEL_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "base_domain", label: "Base domain", kind: "string" },
  { key: "namespace", label: "Namespace", kind: "string" },
];

export const GITHUB_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "read_interval_ms", label: "Read interval (ms)", kind: "number" },
  { key: "mutation_interval_ms", label: "Mutation interval (ms)", kind: "number" },
  { key: "max_retries", label: "Max retries", kind: "number" },
  { key: "max_backoff_ms", label: "Max backoff (ms)", kind: "number" },
];

export const HOOK_FIELDS = ["after_create", "before_run", "after_run", "before_remove"] as const;

export const DEV_SERVER_AUTO_START_OPTIONS = ["pull_request", "human_review"] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && pnpm exec vitest run src/components/projects/config/__tests__/ScalarField.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/config/ScalarField.tsx tracker/src/components/projects/config/sectionFields.ts tracker/src/components/projects/config/__tests__/ScalarField.test.tsx
git commit -m "feat(tracker): ScalarField renderer and section field descriptors"
```

---

## Task 5: ProjectConfigEditor (tabs + save wiring)

**Files:**
- Create: `tracker/src/components/projects/ProjectConfigEditor.tsx`
- Test: `tracker/src/components/projects/__tests__/ProjectConfigEditor.test.tsx`
- Modify: `tracker/src/services/projects.ts:29-34`

The editor owns: General (name/description/prompt/validation), Tracker source (kind + reused remote field components moved out of `EditProjectDialog`), States, Agent, Hooks, Workspace, Editor & Dev, GitHub. On Save it calls `updateProject` (name/description/tracker) then `updateProjectSetup` (workflow_config + prompt + hooks + validation), surfacing backend validation errors via toast.

- [ ] **Step 1: Type the service input**

`tracker/src/services/projects.ts` — change `UpdateProjectSetupInput`:

```ts
import type { WorkflowConfig } from "@/types/workflow-config";
// ...
export interface UpdateProjectSetupInput {
  workflowConfig?: WorkflowConfig;
  promptTemplate?: string | null;
  afterCreateHook?: string | null;
  validationCommands?: string[];
}
```

(The body of `updateProjectSetup` is unchanged: it already serializes `workflow_config`.)

- [ ] **Step 2: Write the failing test**

`tracker/src/components/projects/__tests__/ProjectConfigEditor.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "3",
    slug: "macro-markets",
    name: "Macro Markets",
    description: "A board",
    tracker: { kind: "local", config: {} },
    workflowStatuses: [
      { id: "1", name: "Todo", category: "active", position: 0, isTerminal: false },
      { id: "2", name: "In Progress", category: "started", position: 1, isTerminal: false },
      { id: "3", name: "Done", category: "completed", position: 2, isTerminal: true },
    ],
    setup: {
      promptTemplate: "Old prompt",
      validationCommands: ["pnpm test"],
      workflowConfig: { tracker: { active_states: ["Todo"] }, agent: { max_turns: 40 } },
    },
    ...overrides,
  };
}

describe("ProjectConfigEditor", () => {
  afterEach(() => vi.clearAllMocks());

  it("hydrates the States tab from existing workflow_config", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    render(<ProjectConfigEditor project={project()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: /states/i }));
    expect(screen.getByRole("button", { name: "Todo", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In Progress", pressed: false })).toBeInTheDocument();
  });

  it("saves project fields and pruned workflow_config", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    const saved = project();
    vi.mocked(projects.updateProject).mockResolvedValue(saved);
    vi.mocked(projects.updateProjectSetup).mockResolvedValue(saved);
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("tab", { name: /states/i }));
    await userEvent.click(screen.getByRole("button", { name: "In Progress" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProject).toHaveBeenCalledTimes(1));
    expect(projects.updateProjectSetup).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        promptTemplate: "Old prompt",
        validationCommands: ["pnpm test"],
        workflowConfig: expect.objectContaining({
          tracker: { active_states: ["Todo", "In Progress"] },
          agent: { max_turns: 40 },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("surfaces a backend validation error without calling onSaved", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.updateProject).mockResolvedValue(project());
    vi.mocked(projects.updateProjectSetup).mockRejectedValue(new Error("invalid workflow_config: agent.max_turns must be positive"));
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProjectSetup).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(await screen.findByText(/invalid workflow_config/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/components/projects/__tests__/ProjectConfigEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement ProjectConfigEditor**

`tracker/src/components/projects/ProjectConfigEditor.tsx`:

```tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { KeyValueMapEditor } from "@/components/projects/config/KeyValueMapEditor";
import { ScalarField } from "@/components/projects/config/ScalarField";
import { StateMultiSelect } from "@/components/projects/config/StateMultiSelect";
import {
  AGENT_SCALAR_FIELDS,
  DEV_SERVER_AUTO_START_OPTIONS,
  DEV_SERVER_SCALAR_FIELDS,
  EDITOR_SCALAR_FIELDS,
  GITHUB_SCALAR_FIELDS,
  HOOK_FIELDS,
  PUBLIC_TUNNEL_SCALAR_FIELDS,
} from "@/components/projects/config/sectionFields";
import { TrackerSourceFields } from "@/components/projects/TrackerSourceFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { buildWorkflowConfig, workflowConfigToForm, type WorkflowConfigForm } from "@/lib/workflowConfig";
import { updateProject, updateProjectSetup } from "@/services/projects";
import type { Project, TrackerKind } from "@/types/project";

interface ProjectConfigEditorProps {
  project: Project;
  onSaved: (project: Project) => void;
  onCancel?: () => void;
}

export function ProjectConfigEditor({ project, onSaved, onCancel }: ProjectConfigEditorProps) {
  const statuses = useMemo(() => (project.workflowStatuses ?? []).map((status) => status.name), [project]);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [trackerKind, setTrackerKind] = useState<TrackerKind>(project.tracker.kind);
  const [trackerConfig, setTrackerConfig] = useState<Record<string, unknown>>(project.tracker.config);
  const [promptTemplate, setPromptTemplate] = useState(project.setup?.promptTemplate ?? "");
  const [validationCommands, setValidationCommands] = useState((project.setup?.validationCommands ?? []).join("\n"));
  const [form, setForm] = useState<WorkflowConfigForm>(() => workflowConfigToForm(project.setup?.workflowConfig));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patch<K extends keyof WorkflowConfigForm>(section: K, changes: Partial<WorkflowConfigForm[K]>) {
    setForm((current) => ({ ...current, [section]: { ...current[section], ...changes } }));
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Project name is required");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.slug, {
        name: trimmedName,
        description: description.trim() || null,
        tracker: { kind: trackerKind, config: trackerKind === "local" ? {} : trackerConfig },
      });
      const saved = await updateProjectSetup(project.slug, {
        promptTemplate,
        validationCommands: validationCommands
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        workflowConfig: buildWorkflowConfig(form),
      });
      onSaved(saved);
      toast.success("Project configuration saved");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to save project configuration";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tracker">Tracker</TabsTrigger>
          <TabsTrigger value="states">States</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="devtools">Editor &amp; Dev</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Description</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Description" />
          </label>
          <div className="space-y-1">
            <p className="text-sm font-medium">Prompt template</p>
            <MarkdownEditor value={promptTemplate} onChange={setPromptTemplate} placeholder="Per-project agent prompt (markdown)" />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Validation commands (one per line)</span>
            <Textarea
              value={validationCommands}
              onChange={(event) => setValidationCommands(event.target.value)}
              aria-label="Validation commands"
            />
          </label>
        </TabsContent>

        <TabsContent value="tracker" className="space-y-4 pt-4">
          <TrackerSourceFields
            slug={project.slug}
            trackerKind={trackerKind}
            config={trackerConfig}
            onKindChange={(kind) => {
              setTrackerKind(kind);
              setTrackerConfig(kind === project.tracker.kind ? project.tracker.config : {});
            }}
            onConfigChange={(changes) => setTrackerConfig((current) => ({ ...current, ...changes }))}
          />
        </TabsContent>

        <TabsContent value="states" className="space-y-4 pt-4">
          <StateMultiSelect label="Active states" available={statuses} value={form.tracker.active_states} onChange={(v) => patch("tracker", { active_states: v })} />
          <StateMultiSelect label="Dispatch states" available={statuses} value={form.tracker.dispatch_states} onChange={(v) => patch("tracker", { dispatch_states: v })} />
          <StateMultiSelect label="Wait states" available={statuses} value={form.tracker.wait_states} onChange={(v) => patch("tracker", { wait_states: v })} />
          <StateMultiSelect label="Terminal states" available={statuses} value={form.tracker.terminal_states} onChange={(v) => patch("tracker", { terminal_states: v })} />
          <StateMultiSelect label="Field states" available={statuses} value={form.tracker.field_states} onChange={(v) => patch("tracker", { field_states: v })} />
        </TabsContent>

        <TabsContent value="agent" className="space-y-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {AGENT_SCALAR_FIELDS.map((descriptor) => (
              <ScalarField
                key={descriptor.key}
                descriptor={descriptor}
                value={form.agent[descriptor.key as keyof WorkflowConfigForm["agent"]] as number | undefined}
                onChange={(value) => patch("agent", { [descriptor.key]: value } as Partial<WorkflowConfigForm["agent"]>)}
              />
            ))}
          </div>
          <KeyValueMapEditor
            label="Completion transitions"
            description="When the agent completes in a state (key), move the issue to the target state (value)."
            keyOptions={statuses}
            valueKind="state"
            valueOptions={statuses}
            value={form.agent.completion_transitions}
            onChange={(value) => patch("agent", { completion_transitions: value as Record<string, string> })}
          />
          <KeyValueMapEditor
            label="Max concurrent agents by state"
            keyOptions={statuses}
            valueKind="number"
            value={form.agent.max_concurrent_agents_by_state}
            onChange={(value) => patch("agent", { max_concurrent_agents_by_state: value as Record<string, number> })}
          />
        </TabsContent>

        <TabsContent value="hooks" className="space-y-4 pt-4">
          {HOOK_FIELDS.map((hook) => (
            <label key={hook} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{hook}</span>
              <Textarea
                value={form.hooks[hook] ?? ""}
                onChange={(event) => patch("hooks", { [hook]: event.target.value } as Partial<WorkflowConfigForm["hooks"]>)}
                aria-label={hook}
                className="font-mono text-xs"
              />
            </label>
          ))}
          <ScalarField
            descriptor={{ key: "timeout_ms", label: "Hook timeout (ms)", kind: "number" }}
            value={form.hooks.timeout_ms}
            onChange={(value) => patch("hooks", { timeout_ms: value as number | undefined })}
          />
        </TabsContent>

        <TabsContent value="workspace" className="space-y-4 pt-4">
          <ScalarField
            descriptor={{ key: "root", label: "Workspace root", kind: "string", placeholder: "/path/to/workspaces" }}
            value={form.workspace.root}
            onChange={(value) => patch("workspace", { root: (value as string) ?? "" })}
          />
        </TabsContent>

        <TabsContent value="devtools" className="space-y-6 pt-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Editor</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {EDITOR_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.editor[descriptor.key as keyof WorkflowConfigForm["editor"]] as never}
                  onChange={(value) => patch("editor", { [descriptor.key]: value } as Partial<WorkflowConfigForm["editor"]>)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Dev server</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {DEV_SERVER_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.dev_server[descriptor.key as keyof WorkflowConfigForm["dev_server"]] as never}
                  onChange={(value) => patch("dev_server", { [descriptor.key]: value } as Partial<WorkflowConfigForm["dev_server"]>)}
                />
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Port range (comma-separated)</span>
              <Input
                value={form.dev_server.port_range}
                onChange={(event) => patch("dev_server", { port_range: event.target.value })}
                aria-label="Port range"
                placeholder="4100, 4101, 4102"
              />
            </label>
            <div className="space-y-1">
              <p className="text-sm font-medium">Auto-start on</p>
              <div className="flex gap-3">
                {DEV_SERVER_AUTO_START_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.dev_server.auto_start_on.includes(option)}
                      onChange={(event) =>
                        patch("dev_server", {
                          auto_start_on: event.target.checked
                            ? [...form.dev_server.auto_start_on, option]
                            : form.dev_server.auto_start_on.filter((item) => item !== option),
                        })
                      }
                      aria-label={option}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Public tunnel</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {PUBLIC_TUNNEL_SCALAR_FIELDS.map((descriptor) => (
                <ScalarField
                  key={descriptor.key}
                  descriptor={descriptor}
                  value={form.public_tunnel[descriptor.key as keyof WorkflowConfigForm["public_tunnel"]] as never}
                  onChange={(value) => patch("public_tunnel", { [descriptor.key]: value } as Partial<WorkflowConfigForm["public_tunnel"]>)}
                />
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="github" className="space-y-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {GITHUB_SCALAR_FIELDS.map((descriptor) => (
              <ScalarField
                key={descriptor.key}
                descriptor={descriptor}
                value={form.github[descriptor.key as keyof WorkflowConfigForm["github"]] as number | undefined}
                onChange={(value) => patch("github", { [descriptor.key]: value } as Partial<WorkflowConfigForm["github"]>)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="button" onClick={() => void handleSave()} disabled={submitting}>
          {submitting ? "Saving..." : "Save configuration"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Extract `TrackerSourceFields` from EditProjectDialog**

Create `tracker/src/components/projects/TrackerSourceFields.tsx` by moving `TrackerSourcePicker` usage + `GitHubTrackerFields` + `LinearTrackerFields` + `ConnectedBoardSummary` + helpers (`initialConfigForKind`, `configString`, `boardUrl`) out of `EditProjectDialog.tsx` into a reusable component with this interface:

```tsx
import { TrackerSourcePicker } from "@/components/projects/TrackerSourcePicker";
import type { TrackerKind } from "@/types/project";

interface TrackerSourceFieldsProps {
  slug: string;
  trackerKind: TrackerKind;
  config: Record<string, unknown>;
  onKindChange: (kind: TrackerKind) => void;
  onConfigChange: (changes: Record<string, unknown>) => void;
}

export function TrackerSourceFields({ slug, trackerKind, config, onKindChange, onConfigChange }: TrackerSourceFieldsProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The slug <code>{slug}</code> is fixed. Switching the source changes where issues are read from.
      </p>
      <TrackerSourcePicker value={trackerKind} onChange={onKindChange} />
      {trackerKind === "github" ? <GitHubTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "linear" ? <LinearTrackerFields config={config} onConfigChange={onConfigChange} /> : null}
      {trackerKind === "local" ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Issues will be stored in Symphony&apos;s local board. Remote configuration is cleared.
        </p>
      ) : null}
    </div>
  );
}
```

Copy `GitHubTrackerFields`, `LinearTrackerFields`, `ConnectedBoardSummary`, `boardUrl`, `configString`, and `DEFAULT_GITHUB_STATUS_FIELD` verbatim from `EditProjectDialog.tsx:168-379` into this file (they already accept `{ config, onConfigChange }`). This is the same code path the existing `EditProjectDialog.test.tsx` exercises, so behavior is preserved.

- [ ] **Step 6: Run the editor + tracker tests**

Run: `cd tracker && pnpm exec vitest run src/components/projects/__tests__/ProjectConfigEditor.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/projects/ProjectConfigEditor.tsx tracker/src/components/projects/TrackerSourceFields.tsx tracker/src/components/projects/__tests__/ProjectConfigEditor.test.tsx tracker/src/services/projects.ts
git commit -m "feat(tracker): ProjectConfigEditor with full per-project config tabs"
```

---

## Task 6: ProjectSettingsPage + route + retire EditProjectDialog

**Files:**
- Create: `tracker/src/pages/ProjectSettingsPage.tsx`
- Test: `tracker/src/pages/__tests__/ProjectSettingsPage.test.tsx`
- Modify: `tracker/src/lib/workspaceRoutes.ts`
- Modify: `tracker/src/App.tsx`
- Modify: `tracker/src/components/layout/ProjectWorkspaceLayout.tsx`
- Delete: `tracker/src/components/projects/EditProjectDialog.tsx`, `__tests__/EditProjectDialog.test.tsx`, `EditProjectRoute.tsx`

- [ ] **Step 1: Add the route helper**

`tracker/src/lib/workspaceRoutes.ts` — add near `projectEditPath` (line 71):

```ts
export function projectSettingsPath(projectSlug: string): string {
  return `/projects/${requireSlug(projectSlug)}/settings`;
}
```

- [ ] **Step 2: Write the failing page test**

`tracker/src/pages/__tests__/ProjectSettingsPage.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${slug}/settings`]}>
      <Routes>
        <Route path="/projects/:projectSlug/settings" element={<ProjectSettingsPage />} />
        <Route path="/projects" element={<div>project list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const project: Project = {
  id: "3",
  slug: "macro-markets",
  name: "Macro Markets",
  description: null,
  tracker: { kind: "local", config: {} },
  workflowStatuses: [],
  setup: { validationCommands: [], workflowConfig: {} },
};

describe("ProjectSettingsPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads the project and renders the config editor", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.getProject).mockResolvedValue(project);

    renderAt("macro-markets");

    await waitFor(() => expect(projects.getProject).toHaveBeenCalledWith("macro-markets"));
    expect(await screen.findByRole("tab", { name: /general/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/pages/__tests__/ProjectSettingsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the page**

`tracker/src/pages/ProjectSettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { PROJECTS_PATH, workspaceBasePath } from "@/lib/workspaceRoutes";
import { getProject } from "@/services/projects";
import type { Project } from "@/types/project";

export function ProjectSettingsPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const slug = projectSlug.trim();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!slug) {
      navigate(PROJECTS_PATH, { replace: true });
      return;
    }
    let active = true;
    void getProject(slug)
      .then((loaded) => active && setProject(loaded))
      .catch((cause) => {
        if (!active) return;
        toast.error(cause instanceof Error ? cause.message : "Unable to load project");
        navigate(PROJECTS_PATH, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [slug, navigate]);

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{project.name} · settings</h1>
        <p className="text-sm text-muted-foreground">Per-project configuration. Process-level settings live in the server environment.</p>
      </header>
      <ProjectConfigEditor
        project={project}
        onCancel={() => navigate(workspaceBasePath(project.slug, "board"))}
        onSaved={(updated) => {
          setProject(updated);
          notifyTrackerProjectsChanged();
          toast.success("Saved");
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Wire the route and redirect, retire the dialog**

In `tracker/src/App.tsx`:
- Add import: `import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";`
- Remove the `EditProjectRoute` import.
- Replace the `:projectSlug/edit` route (line 54) with a redirect, and add a settings route under the workspace layout:

```tsx
// inside <Route path="projects" element={<ProjectListPage />}>
<Route path=":projectSlug/edit" element={<Navigate to="../:projectSlug/settings" replace />} />
```

Because relative `Navigate` cannot interpolate params, instead add a tiny redirect component in `App.tsx`:

```tsx
import { useParams } from "react-router-dom";

function EditToSettingsRedirect() {
  const { projectSlug = "" } = useParams();
  return <Navigate to={`/projects/${projectSlug}/settings`} replace />;
}
```

and use `<Route path=":projectSlug/edit" element={<EditToSettingsRedirect />} />`. Add the settings route under the workspace layout block (after the `assistant` routes, near line 73):

```tsx
<Route path="settings" element={<ProjectSettingsPage />} />
```

In `tracker/src/components/layout/ProjectWorkspaceLayout.tsx`:
- Remove the `EditProjectDialog` import and the `editing` state + the rendered `<EditProjectDialog>` block.
- Change the gear button to navigate to settings:

```tsx
import { useNavigate } from "react-router-dom";
import { projectSettingsPath } from "@/lib/workspaceRoutes";
// ...
const navigate = useNavigate();
// button onClick:
onClick={() => navigate(projectSettingsPath(projectSlug))}
```

Delete the files:

```bash
git rm tracker/src/components/projects/EditProjectDialog.tsx \
       tracker/src/components/projects/__tests__/EditProjectDialog.test.tsx \
       tracker/src/components/projects/EditProjectRoute.tsx
```

- [ ] **Step 6: Run the page test + type-check + lint**

Run: `cd tracker && pnpm exec vitest run src/pages/__tests__/ProjectSettingsPage.test.tsx`
Expected: PASS (1 test).

Run: `cd tracker && pnpm exec tsc -b`
Expected: exit 0 (no dangling references to deleted modules).

Run: `cd tracker && pnpm exec eslint src/App.tsx src/pages/ProjectSettingsPage.tsx src/components/layout/ProjectWorkspaceLayout.tsx`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A tracker/src/App.tsx tracker/src/pages/ProjectSettingsPage.tsx tracker/src/pages/__tests__/ProjectSettingsPage.test.tsx tracker/src/components/layout/ProjectWorkspaceLayout.tsx tracker/src/lib/workspaceRoutes.ts
git commit -m "feat(tracker): project settings page route; retire prompt-only edit dialog"
```

---

## Task 7: Create wizard redirects to settings

**Files:**
- Modify: `tracker/src/components/projects/ProjectWorkspaceWizard.tsx:244-258,283-297`
- Test: extend `tracker/src/components/projects/__tests__/` (new file `ProjectWorkspaceWizardRedirect.test.tsx` if no wizard test exists)

After a successful create (scratch and template paths), navigate to the new project's settings page so the user lands on the pre-filled config editor.

- [ ] **Step 1: Write the failing test**

`tracker/src/components/projects/__tests__/ProjectWorkspaceWizardRedirect.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import * as templates from "@/services/templates";
import * as projectSetup from "@/services/projectSetup";

vi.mock("@/services/templates");
vi.mock("@/services/projectSetup");

describe("ProjectWorkspaceWizard create redirect", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects to the new project's settings page after creating from a template", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    vi.mocked(templates.listTemplates).mockResolvedValue([
      { id: "t1", slug: "macro", name: "Macro", description: null, repositories: [] },
    ]);
    vi.mocked(templates.instantiateTemplate).mockResolvedValue({
      id: "9",
      slug: "macro-markets",
      name: "Macro Markets",
      description: null,
      tracker: { kind: "local", config: {} },
    });

    render(
      <MemoryRouter initialEntries={["/projects/new"]}>
        <Routes>
          <Route path="/projects/new" element={<ProjectWorkspaceWizard open onOpenChange={vi.fn()} />} />
          <Route path="/projects/:projectSlug/settings" element={<div>settings for macro-markets</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Macro"));
    await userEvent.type(screen.getByPlaceholderText("Project name"), "Macro Markets");
    await userEvent.type(screen.getByPlaceholderText("project-slug"), "macro-markets");
    await userEvent.click(screen.getByRole("button", { name: /create from template/i }));

    await waitFor(() => expect(screen.getByText("settings for macro-markets")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tracker && pnpm exec vitest run src/components/projects/__tests__/ProjectWorkspaceWizardRedirect.test.tsx`
Expected: FAIL — wizard navigates to `/board`, so the settings text never appears.

- [ ] **Step 3: Update the wizard navigation**

In `tracker/src/components/projects/ProjectWorkspaceWizard.tsx`, add the route helper import:

```ts
import { projectSettingsPath } from "@/lib/workspaceRoutes";
```

In `handleSubmit` success (scratch path, replace lines 247-252):

```ts
      onCreated?.(project);
      reset();
      setOpen(false);
      toast.success("Workspace project created");
      navigate(projectSettingsPath(project.slug));
```

In `handleInstantiateTemplate` success (template path, replace lines 286-291):

```ts
      onCreated?.(project);
      reset();
      setOpen(false);
      toast.success("Project created from template");
      navigate(projectSettingsPath(project.slug));
```

(The remote-tracker branch in `handleSubmit` at lines 212-215 should also navigate: add `navigate(projectSettingsPath(project.slug));` after `toast.success("Project connected");`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tracker && pnpm exec vitest run src/components/projects/__tests__/ProjectWorkspaceWizardRedirect.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/projects/ProjectWorkspaceWizard.tsx tracker/src/components/projects/__tests__/ProjectWorkspaceWizardRedirect.test.tsx
git commit -m "feat(tracker): redirect to project settings after creation"
```

---

## Task 8: Backend round-trip test for full structured workflow_config

**Files:**
- Modify: `elixir/test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`

Confirms `PUT /projects/:id/setup` accepts and persists a fully-populated in-scope `workflow_config` and that `GET /projects/:id` returns it unchanged.

- [ ] **Step 1: Read the existing test to match fixtures/setup**

Run: `cd elixir && rg -n "describe|setup|conn" test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs | head -n 40`
Expected: shows the existing `describe` blocks and the project-seeding `setup` helper to reuse.

- [ ] **Step 2: Add the failing test**

Add inside the existing top-level `describe` (match the file's existing project-seed helper name; the snippet below assumes a seeded `project` with slug from setup context):

```elixir
  test "persists and returns a fully structured workflow_config", %{conn: conn, project: project} do
    workflow_config = %{
      "tracker" => %{
        "active_states" => ["Todo", "In Progress"],
        "dispatch_states" => ["Todo"],
        "terminal_states" => ["Done"]
      },
      "agent" => %{
        "max_turns" => 25,
        "completion_transitions" => %{"In Review" => "Done"},
        "max_concurrent_agents_by_state" => %{"In Progress" => 2}
      },
      "hooks" => %{"after_create" => "echo hi"},
      "editor" => %{"enabled" => true, "port" => 8443, "auth" => "password"},
      "dev_server" => %{"enabled" => true, "auto_start_on" => ["pull_request"]},
      "public_tunnel" => %{"enabled" => true, "base_domain" => "preview.example.com"},
      "github" => %{"max_retries" => 5}
    }

    conn =
      put(conn, ~p"/api/tracker/v1/projects/#{project.slug}/setup", %{
        "setup" => %{"workflow_config" => workflow_config, "prompt_template" => "Hello"}
      })

    assert %{"data" => %{"setup" => setup}} = json_response(conn, 200)
    assert setup["workflow_config"]["tracker"]["active_states"] == ["Todo", "In Progress"]
    assert setup["workflow_config"]["agent"]["completion_transitions"] == %{"In Review" => "Done"}
    assert setup["workflow_config"]["editor"]["auth"] == "password"
    assert setup["prompt_template"] == "Hello"

    show = get(conn, ~p"/api/tracker/v1/projects/#{project.slug}")
    assert %{"data" => %{"setup" => persisted}} = json_response(show, 200)
    assert persisted["workflow_config"]["github"]["max_retries"] == 5
  end
```

If the file's `setup` block does not already provide `%{project: project}`, reuse its existing seeding pattern (read in Step 1) and adapt the key names accordingly. Do not invent a new helper if one exists.

- [ ] **Step 3: Run the test to verify it passes (or fails meaningfully)**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`
Expected: PASS. If it FAILS on a schema rejection, that reveals a real gap (e.g. a key the schema rejects) — investigate `Config.validate_workflow_config/1` before adjusting the fixture.

- [ ] **Step 4: Commit**

```bash
git add elixir/test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs
git commit -m "test(tracker): round-trip a full structured workflow_config through setup API"
```

---

## Final verification

- [ ] **Run the full frontend suite**

Run: `cd tracker && pnpm test`
Expected: all tests pass (no references to deleted `EditProjectDialog`).

- [ ] **Type-check and lint the frontend**

Run: `cd tracker && pnpm exec tsc -b && pnpm exec eslint .`
Expected: exit 0.

- [ ] **Run the affected backend test**

Run: `cd elixir && mise exec -- mix test test/symphony_elixir_web/controllers/tracker/project_setup_update_test.exs`
Expected: PASS.

- [ ] **Manual smoke (optional)**

Open `/tracker/projects/<slug>/settings`, edit a state and a number, Save, confirm a toast and that `GET /projects/:id` shows the change. Visit `/tracker/projects/<slug>/edit` and confirm redirect to `/settings`.

---

## Self-Review

**Spec coverage:**
- Dedicated tabbed page at `/settings` → Task 6.
- Reusable editor shared by edit + create → Tasks 5, 6, 7.
- All in-scope sections (tracker/agent/hooks/workspace/editor/dev_server/public_tunnel/github) → Tasks 1, 4, 5.
- Prompt + validation_commands in General → Task 5.
- Tracker source editing preserved → Task 5 (TrackerSourceFields extraction).
- Reuse existing validated persistence endpoints → Tasks 5, 8.
- Typed `WorkflowConfig` (snake_case, lossless) → Task 1.
- Client validation (subset/number bounds via inputs) + server error surfacing → Tasks 2, 3, 4, 5.
- Create stays lean + redirect → Task 7.
- Process-level sections excluded → not modeled (Task 1) and absent from tabs (Task 5).
- Legacy `EditProjectDialog` retired, `/edit` redirects → Task 6.

**Placeholder scan:** No `TBD`/`TODO`; every code step has complete code. Task 8 Step 2 explicitly instructs reusing the existing seed helper (read in Step 1) rather than a vague placeholder.

**Type consistency:** `WorkflowConfig`/`WorkflowConfigForm` defined in Task 1 and consumed consistently in Tasks 4–7; `ScalarDescriptor` defined in Task 4 and used in Task 5; `projectSettingsPath` defined in Task 6 Step 1 and used in Tasks 6–7.
