# Session Model Provenance and Multi-Agent Benchmark Design

Date: 2026-07-25

## Objective

Make the model used by every Symphony assistant session explicit, durable, and
auditable. The requested model and effort must be distinguishable from the
provider-confirmed model and effort. The benchmark must use reproducible model
matrices for Codex, Claude Code, and Cursor Agent and reject incomplete model
provenance instead of silently substituting defaults.

## Current Problems

- Session model and effort are stored in generic JSON metadata and duplicated in
  `metadata.current_turn`.
- The UI shows the catalog command/default, which can differ from the model used
  by the persisted session.
- Provider adapters discard model information returned by their native startup
  protocols.
- The benchmark provisions sessions and orchestrator issues without a canonical
  model matrix, so results cannot be compared reliably.
- Model catalogs contain stale static fallback entries that can make an
  unavailable model appear selectable.
- Legacy rows can contain invalid or ambiguous model data.

## Considered Designs

### 1. Keep all provenance in metadata

This is migration-light but preserves the current ambiguity, allows duplicate
keys, and provides no database-level contract. Rejected.

### 2. Add one `model` and one `effort` column

This is simple but cannot distinguish operator intent from what a provider
actually selected or rerouted. Rejected.

### 3. Add requested and resolved columns

Add four canonical nullable columns to `assistant_threads`:

- `requested_model`
- `requested_effort`
- `resolved_model`
- `resolved_effort`

This is the selected design. It preserves the operator request, records native
provider confirmation, makes mismatches visible, and removes duplicate session
model state from metadata.

## Canonical Contract

`assistant_threads` is the single source of truth for session model provenance.

- `requested_model` and `requested_effort` are set when the session is created
  or when its next execution configuration is explicitly changed.
- `resolved_model` and `resolved_effort` are written only after the provider
  confirms the execution configuration.
- A requested value is never copied into a resolved field merely because the
  resolved value is missing.
- `metadata.model`, `metadata.effort`,
  `metadata.current_turn.model`, and `metadata.current_turn.effort` are removed.
- Provider-native conversation identifiers remain solely in
  `provider_bindings`.
- The public thread DTO and assistant channel expose all four canonical fields.
- The UI presents the resolved model as the model actually used. While native
  confirmation is unavailable, it labels the requested model as pending rather
  than presenting it as resolved.

The four fields describe the latest execution configuration of a durable
session. Existing message and event history remains immutable. A future
per-turn provenance table can be added if historical model switching becomes a
product requirement, without changing this session contract.

## Legacy Migration

The migration performs a one-time repair:

1. Add the four nullable columns.
2. Backfill `requested_model` and `requested_effort` from non-blank legacy
   top-level metadata keys.
3. Do not invent resolved values for legacy rows.
4. Remove the legacy top-level and `current_turn` model/effort keys from JSON.

Rows with no trustworthy value remain null. The UI and reports render these as
legacy provenance unavailable.

## Provider Confirmation Sources

### Codex

The app-server `thread/start` and `thread/resume` responses return `model` and
`reasoningEffort`. Symphony persists both as resolved values. A subsequent
`model/rerouted` notification replaces `resolved_model` with `toModel`.

### Claude Code

The stream-json `system/init` event returns the exact model selected by Claude
Code. Symphony persists it as `resolved_model`. The CLI validates and applies
the explicit `--effort` launch argument; after successful init the requested
effort is persisted as `resolved_effort`.

Claude Code was updated to 2.1.220 before defining the matrix. Live probes
resolved the current aliases to `claude-sonnet-5`, `claude-opus-5`,
`claude-fable-5`, and `claude-haiku-4-5-20251001`.

### Cursor Agent

The MCP `system/init` event returns the provider model label. Symphony resolves
that label against the live `cursor-agent --list-models` catalog and persists
the unique canonical slug. It fails explicitly if the label is absent or
ambiguous. Cursor effort variants are encoded in the model slug; separate
effort fields remain null.

Cursor Agent 2026.07.23-e383d2b is current. The verified comparison slugs are
`composer-2.5` and `cursor-grok-4.5-high`.

## Catalog Failure Behavior

- Codex and Cursor catalogs are read from their installed CLIs.
- A catalog read failure is returned as an error and shown as unavailable.
- Stale synthetic catalog entries are not returned.
- Claude's catalog remains curated because Claude Code does not provide a model
  listing command. It is updated alongside verified CLI aliases and is not used
  as a runtime confirmation source.

## Benchmark Matrices

Every run record includes `matrix`, `path`, `provider`, `requested_model`, and
`requested_effort`. Successful collection additionally requires the persisted
resolved model and effort contract.

### `providers-default`

Run both direct session and orchestrator paths:

| Provider | Requested model | Requested effort |
| --- | --- | --- |
| Codex | `gpt-5.5` | `medium` |
| Claude | `claude-sonnet-5` | `medium` |
| Cursor | `composer-2.5` | null |

### `providers-advanced`

Run both direct session and orchestrator paths:

| Provider | Requested model | Requested effort |
| --- | --- | --- |
| Codex | `gpt-5.5` | `high` |
| Claude | `claude-opus-5` | `high` |
| Cursor | `cursor-grok-4.5-high` | null |

The originally proposed Claude Opus 4.8 is replaced by Opus 5 because the CLI
update and live runtime probe established Opus 5 as the current base.

### `codex-5.6-defaults`

Run both direct session and orchestrator paths so the Codex model family is
compared under the same two execution contracts as the provider matrices:

| Variant | Requested model | Runtime-advertised default effort |
| --- | --- | --- |
| Sol | `gpt-5.6-sol` | `low` |
| Terra | `gpt-5.6-terra` | `medium` |
| Luna | `gpt-5.6-luna` | `medium` |

These efforts come from the installed Codex app-server `model/list` response,
not from a static assumption.

## Benchmark Validity Rules

A run fails when any of the following is true:

- the requested model/effort differs from the matrix;
- the persisted resolved model is absent after execution;
- the resolved model cannot be reconciled with the native provider event;
- a provider or orchestrator turn ends in an error;
- the generated page, focused E2E test, or evidence contract is incomplete.

No benchmark path changes an unavailable model to `auto` or another model.

## UI

Session headers show a compact model provenance label:

- confirmed: `Claude · claude-sonnet-5 · medium`;
- pending: `Claude · requested claude-sonnet-5 · awaiting confirmation`;
- mismatch/reroute: show both requested and resolved values with an explicit
  rerouted state.

The detailed execution/session view exposes requested and resolved fields
separately for diagnostics and benchmark audit.

## Validation and Evidence

Validation is deliberately focused and sequential to avoid exhausting WSL:

- migration and assistant history tests;
- provider adapter unit tests for native model events;
- controller/channel presenter tests;
- focused React service/header tests;
- benchmark contract and collector tests;
- one targeted run per matrix cell.

Each generated page must produce desktop and mobile full-page screenshots, an
E2E WebM, an H.264/yuv420p fast-start MP4, and a Playwright trace. The Evidence
skill persists these artifacts in Symphony's Evidence tab and re-reads the
records before handoff. Reports list requested and resolved model provenance for
every run and are linked from PR #6.
