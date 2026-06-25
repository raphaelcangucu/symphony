# Authoring vs. Execution — Session Log Separation + Authoring Digest

- **Date:** 2026-06-22
- **Status:** Draft — pending review
- **Area:** Codex session resolution (`elixir/`), orchestrator prompt assembly (`PromptBuilder`/`AgentRunner`), tracker Agent tab (`tracker/`)
- **Observed on:** `http://localhost:4000/tracker/projects/distributionmachine/board/issues/DIS-6/agent?agent=execution`

## 1. Summary

Authoring (the issue assistant chat) and Execution (the orchestrator dispatch) are
**conceptually separate phases** and already use **separate Codex threads**, but they
**share one per-issue workspace** and therefore **one Codex session sidecar**
(`.symphony/codex-session.json`). Because every Codex turn — authoring *or* execution —
overwrites that sidecar on `start_session`, the **Execution tab's session log resolves to
"whoever ran last"**. On `DIS-6` the Authoring and Execution tabs showed the **same log**.

This design does two things:

1. **Separate the log (observability).** Make the Codex sidecar **role-aware** so authoring
   turns stop clobbering the execution sidecar. Execution keeps the default file
   (`codex-session.json`); authoring writes `codex-session-authoring.json`. The Execution
   tab then always resolves the **execution** thread's rollout.
2. **Surface authoring context to the execution agent (fallback).** Generate
   `docs/superpowers/authoring-log.md` in the issue workspace from the authoring chat
   transcript, and have `PromptBuilder` inject it **only when no spec/plan/handoff exist**
   (the rich-context fallback). The file is also viewable in the read-only document viewer.

**Key reframe:** the session log is a **human observability** surface — the execution agent
does *not* read it. Agent continuity already flows through workspace artifacts
(`spec`/`plan`/`handoff`) + `PromptBuilder`. So separating the log is purely UX-correctness,
and the "give authoring context to execution" wish is a *separate, additive* prompt change.

## 2. Background & current architecture

| Concern | Path |
|---------|------|
| Codex session sidecar (write/resolve/clear) | `elixir/lib/symphony_elixir/codex/session.ex` |
| Codex turn entrypoint (writes sidecar) | `elixir/lib/symphony_elixir/codex/coding_agent.ex` (`start_session/2` → `Session.write/2`) |
| Goal-mode resume target | `coding_agent.ex` (`resumable_thread_id/3` → `Session.resolve/2`) |
| Execution session log (UI) | `session_log_channel.ex` → `SessionLog.resolve_log_source/3` → `Codex.SessionLog.resolve_rollout_path/2` → `Session.resolve/2` |
| Evidence gate audit | `elixir/lib/symphony_elixir/evidence/session_audit.ex` → `SessionLog.resolve_rollout_path/2` → `Session.resolve/2` |
| Authoring turns | `assistant/codex_session.ex` (`default_runner/4` → `RootCodingAgent.start_session/3`) |
| Execution turns | `agent_runner.ex` (`run_codex_turns/4` → `CodingAgent.start_session/3`) |
| Prompt artifact injection | `prompt_builder.ex` (`artifacts_section/1`, reads `docs/superpowers/specs|plans` + `handoff.md`) |
| Authoring transcript source | `assistant/history.ex` (`list_messages_for_thread/1`; active issue thread via `Repo.get_by(... scope: "issue", status: "active")`) |

**Single sidecar writer.** `Codex.CodingAgent.start_session/2` unconditionally calls:

```elixir
Session.write(expanded_workspace, thread_id)
```

Both authoring and execution reach this via the same adapter
(`RootCodingAgent.start_session/3` → `Codex.CodingAgent`). Same workspace → same file →
**last writer wins**.

**All `Session.resolve` consumers are execution-side:** the Execution tab UI, the evidence
gate, and goal-mode resume. (The Authoring tab uses the assistant **chat**, not
`IssueSessionLog`, so authoring needs no UI session-log resolution.) This is what makes a
**default-stays-execution** split safe.

## 3. Goals & non-goals

**Goals**

- The **Execution** tab session log always reflects the **execution** Codex thread, never an
  authoring turn that happened to run last in the shared workspace.
- Authoring goal-mode resume targets the **authoring** thread (today it can collide with the
  execution sidecar). Fixing the writer split fixes this for free.
- The execution agent can benefit from the authoring conversation **when no
  spec/plan/handoff was produced**, via an injected, size-capped digest.
- Zero behavior change for the evidence gate and goal-mode execution resume (they keep using
  the default `codex-session.json`).

**Non-goals**

- Changing how agent **context/continuity** works for the normal (spec/plan/handoff) path.
- A session-log view inside the **Authoring** tab (the chat already is that surface).
- Summarizing the authoring transcript with an LLM (we emit a deterministic transcript
  digest; smart summarization is future work).
- Persisting authoring rollouts differently or merging Codex threads.

## 4. Decisions

| ID | Decision |
|----|----------|
| D1 | **Sidecar is role-aware.** `:execution` (default) → `codex-session.json` (unchanged); `:authoring` → `codex-session-authoring.json`. |
| D2 | **Default stays execution** so evidence gate + goal-mode resume + the Execution tab are byte-for-byte unchanged. Only the authoring path opts into the new file. |
| D3 | **Authoring context → execution is additive and fallback-only.** Injected by `PromptBuilder` **only** when `specs/plans/handoff` are all absent. |
| D4 | **Digest source = chat transcript** (`History.list_messages_for_thread/1`), not the authoring rollout. Cleaner, structured, and decouples Part 2 from Part 1. |
| D5 | **Digest is a workspace file** `docs/superpowers/authoring-log.md` so it (a) flows through the existing `artifacts_section` plumbing and (b) is viewable in the document viewer. |
| D6 | **Digest written at execution prep** (once per dispatch, overwritten), not per authoring turn. |

## 5. Design — Part 1: role-aware sidecar (log separation)

### 5.1 `Codex.Session`

Add an optional **role** to the write/resolve/clear API. Role maps to a filename; the
default role (`:execution`) keeps the legacy path for backward compatibility.

```elixir
@sidecar_files %{execution: ".symphony/codex-session.json",
                 authoring: ".symphony/codex-session-authoring.json"}

@spec write(Path.t(), String.t(), :execution | :authoring) :: :ok
def write(workspace, thread_id, role \\ :execution)

@spec resolve(Path.t(), keyword()) :: {:ok, String.t()} | :error
def resolve(workspace, opts \\ [])   # reads role via Keyword.get(opts, :session_role, :execution)

@spec clear(Path.t(), :execution | :authoring) :: :ok
def clear(workspace, role \\ :execution)
```

- `sidecar_path/2` selects the file by role.
- `resolve/2` reads `:session_role` from `opts` (default `:execution`). The cwd-scan
  fallback is unchanged; it only triggers when the role's sidecar is **absent** (e.g. an
  issue authored but never executed). Pre-first-execution the scan may surface an authoring
  rollout in the Execution tab — acceptable because there is no execution log yet; after the
  first execution run the execution sidecar exists and `resolve` short-circuits to it.

### 5.2 `Codex.CodingAgent`

Thread a `:session_role` opt (default `:execution`) and use it for both the write and the
resume resolution:

```elixir
# in start_session/2, replacing `Session.write(expanded_workspace, thread_id)`
Session.write(expanded_workspace, thread_id, session_role(opts))

# resumable_thread_id/3 already calls Session.resolve(workspace, opts);
# opts now carries :session_role, so authoring goal-mode resumes the authoring sidecar.

defp session_role(opts), do: Keyword.get(opts, :session_role, :execution)
```

### 5.3 Callers

- **Authoring** (`Assistant.CodexSession.default_runner/4`): add `session_role: :authoring`
  to the opts passed into `RootCodingAgent.start_session/3`. (The whole `Assistant.CodexSession`
  module is the assistant/authoring side; project/freeform/explore threads run in different
  workspaces and are unaffected, so tagging them `:authoring` is harmless and consistent.)
- **Execution** (`AgentRunner.run_codex_turns/4`): add an explicit `session_role: :execution`
  to `session_opts` (documents intent; equals the default).

### 5.4 What does NOT change

- `session_log_channel.ex` calls `SessionLog.resolve_log_source(preferred_kind, workspace)`
  with no role → `:execution` → `codex-session.json`. **Unchanged.**
- `Evidence.SessionAudit` calls `SessionLog.resolve_rollout_path(workspace, [])` → `:execution`.
  **Unchanged.**
- Goal-mode **execution** resume → `:execution`. **Unchanged.**

## 6. Design — Part 2: authoring digest for the execution agent (fallback)

### 6.1 New module `Assistant.AuthoringDigest`

```elixir
@spec write(Path.t(), String.t(), String.t()) :: :ok
def write(workspace, project_slug, issue_identifier)
```

- Looks up the active issue thread (read-only) and its messages.
- Renders a deterministic markdown transcript to
  `Path.join(workspace, "docs/superpowers/authoring-log.md")`:
  - Title + provenance line ("Generated from the authoring conversation; fallback context").
  - Each message as `**<role>:** <content>` with tool-call names noted compactly.
  - Size-capped (reuse a byte budget similar to `PromptBuilder`'s artifact limits); long
    tool outputs are elided.
- **No-op** (does not create/overwrite) when there is no active issue thread or it has no
  user/assistant messages — so empty digests never appear.
- Best-effort: never raises and never blocks the run (mirrors `Codex.Session.write/2`).

Add a public read-only lookup in `History` (wrapping the existing private
`active_issue_thread/2`):

```elixir
@spec find_issue_thread(String.t(), String.t()) :: Thread.t() | nil
def find_issue_thread(project_slug, issue_identifier)
```

### 6.2 When it runs

In `AgentRunner` workspace prep — after `Workspace.create_for_issue/1` succeeds and before
the turn loop builds prompts (e.g. at the top of `run_codex_turns/4`). Written **once per
dispatch** (overwrites any prior digest so it reflects the latest authoring).

### 6.3 `PromptBuilder.artifacts_section/1` — fallback injection

Today `files = specs ++ plans ++ handoff`; if empty → `""`. Change to:

```elixir
files = specs ++ plans ++ handoff_file(base)

files =
  case files do
    [] -> authoring_digest_file(base)   # [authoring-log.md] when present, else []
    list -> list                         # spec/plan/handoff present → digest NOT injected
  end
```

- Section header adapts: when the only file is the digest, render it under
  **"## Authoring conversation (no spec/plan was produced — use as background)"** so the
  agent treats it as context, not as an approved plan.
- Reuses the existing byte-budget / truncation machinery (`render_artifacts/2`).

### 6.4 Document viewer (optional, low priority)

The digest already lands under `docs/superpowers/`. To surface it in the read-only viewer,
add `authoring-log.md` to the issue document listing
(`IssueDocumentController` / `TrackerPresenter.issue_document/1`) with `kind: "authoring"`.
This is additive; gate it as a follow-up if it widens scope.

## 7. Sensitive points & risks

- **Evidence gate.** Verified `Evidence.SessionAudit.verify_commands/2` resolves via
  `SessionLog.resolve_rollout_path(workspace, [])` → execution sidecar. Because execution
  keeps the default file, the audit is unaffected. (Regression test will assert this.)
- **Goal-mode resume.** Execution goal resume stays on the execution sidecar; authoring goal
  resume *moves* to the authoring sidecar — a correctness improvement, but it changes which
  thread an in-flight authoring goal resumes. Covered by tests.
- **Pre-first-execution Execution tab.** Before any execution run, the execution sidecar is
  absent and `resolve` may cwd-scan to an authoring rollout. Acceptable (no execution log
  exists yet). Documented, not fixed.
- **Digest committed to the branch.** Authoring artifacts are already committed (D10 of the
  authoring design). The generated `authoring-log.md` may be committed by the agent; this is
  acceptable and reviewable. Open question §9.
- **Token budget.** Digest injection reuses `artifacts_section` limits; it can only appear
  when no other artifacts exist, so it cannot compound with large specs/plans.

## 8. File map

**New**
- `elixir/lib/symphony_elixir/assistant/authoring_digest.ex`
- `docs/superpowers/authoring-log.md` is a generated workspace artifact (not committed to this repo)

**Changed**
- `elixir/lib/symphony_elixir/codex/session.ex` — role-aware `write/3`, `resolve/2`, `clear/2`
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` — pass `session_role` to write + resume resolve
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` — `session_role: :authoring` in `default_runner/4`
- `elixir/lib/symphony_elixir/agent_runner.ex` — explicit `session_role: :execution`; call `AuthoringDigest.write/3` during prep
- `elixir/lib/symphony_elixir/assistant/history.ex` — public `find_issue_thread/2`
- `elixir/lib/symphony_elixir/prompt_builder.ex` — `artifacts_section/1` digest fallback
- (optional) `IssueDocumentController` + `TrackerPresenter` — list `authoring-log.md`

**Docs**
- `elixir/README.md` — note role-aware sidecar + authoring digest fallback
- `elixir/docs/logging.md` — note authoring vs execution session roles if log fields change

## 9. Open questions

- Should `authoring-log.md` be **git-ignored in the workspace** (generated, ephemeral) or
  **committed** (reviewable history)? Default proposal: write it; let the normal flow handle
  it (likely committed). Revisit if it adds branch noise.
- Do we want the digest **always** injected as supplementary context (capped), rather than
  fallback-only? Current decision (D3) is fallback-only per the chosen gating.

## 10. Build order (independently shippable)

1. **Part 1 — role-aware sidecar** (`Session` + `CodingAgent` + the two callers). Fixes the
   `DIS-6` log-collision; invisible to evidence/goal-mode. Ship alone.
2. **Part 2 — authoring digest** (`AuthoringDigest` + `History.find_issue_thread/2` +
   `PromptBuilder` fallback + `AgentRunner` prep). Additive; ship after Part 1.
3. **Optional — document viewer listing** of `authoring-log.md`.

Each step keeps `make all` green and `mix specs.check` clean (public `def` need `@spec`).
