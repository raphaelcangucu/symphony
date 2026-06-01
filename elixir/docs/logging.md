# Logging Best Practices

This guide defines logging conventions for Symphony so Codex can diagnose failures quickly.

## Goals

- Make logs searchable by issue and session.
- Capture enough execution context to identify root cause without reruns.
- Keep messages stable so dashboards/alerts are reliable.

## Required Context Fields

When logging issue-related work, include both identifiers:

- `issue_id`: Linear internal UUID (stable foreign key).
- `issue_identifier`: human ticket key (for example `MT-620`).

When logging Codex execution lifecycle events, include:

- `session_id`: combined Codex thread/turn identifier.

When logging assistant authoring or document events, include:

- `assistant_thread_id`: persisted assistant thread id when available.
- `issue_identifier`: human ticket key for document API failures and document-change signals.

When logging Codex Goal mode, include:

- `goal_mode=true`: marks dispatches where Symphony supplied a Codex goal.
- `session_id`: include when the Codex thread has started.

## Message Design

- Use explicit `key=value` pairs in message text for high-signal fields.
- Prefer deterministic wording for recurring lifecycle events.
- Include the action outcome (`completed`, `failed`, `retrying`) and the reason/error when available.
- Avoid logging large payloads unless required for debugging.

## Scope Guidance

- `AgentRunner`: log start/completion/failure with issue context, plus `session_id` when known.
- `Orchestrator`: log dispatch, retry, terminal/non-active transitions, and worker exits with issue context. Include `session_id` whenever running-entry data has it.
- `Codex.AppServer`: log session start/completion/error with issue context and `session_id`.
- `AssistantChannel` / `Assistant.CodexSession`: surface issue-scoped authoring turns with
  `assistant_thread_id` and `issue_identifier`; document refreshes are emitted to the UI as
  `assistant_document_changed`.
- `IssueDocumentController`: log rejected document reads with `issue_identifier` and concise reasons
  such as `invalid_path`, `workspace_missing`, or `too_large`.
- `GitHub.RequestGateway`: when a GitHub request is rate limited, log a `warning` with the backoff
  delay and attempt counters, for example
  `GitHub rate limit hit; pausing <delay>ms before retry (attempt <n>/<max>)`. Keep this wording
  stable so rate-limit backoff is greppable.

## Checklist For New Logs

- Is this event tied to a Linear issue? Include `issue_id` and `issue_identifier`.
- Is this event tied to a Codex session? Include `session_id`.
- Is this event tied to an assistant thread? Include `assistant_thread_id`.
- Is this a Goal mode dispatch? Include `goal_mode=true`.
- Is the failure reason present and concise?
- Is the message format consistent with existing lifecycle logs?
