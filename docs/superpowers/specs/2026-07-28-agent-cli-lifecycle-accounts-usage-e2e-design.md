# Agent CLI Lifecycle, Accounts, Usage, and E2E Design

## Summary

Symphony will manage Claude Code, Codex, Cursor, and OpenCode as isolated CLI
installations by default. Operators may explicitly select a CLI from `PATH`.
When the preferred managed installation is unavailable, Symphony may fall back
to the compatible `PATH` installation and must report the effective source.

The lifecycle and account engine follows Orca's stronger isolation,
account-scoped runtime, usage-cache, and stale-response protections. The
settings presentation and configuration ergonomics follow Jean's compact
preferences model. Validation follows Orca's full-application Playwright model:
the real Phoenix backend and tracker run against disposable homes and
deterministic executable fixtures.

The E2E suite is versioned and manually runnable. This work does not add or
modify a CI workflow.

## Goals

- Install and maintain four agent CLIs without writing into the operator's
  global package-manager or CLI directories.
- Make the managed installation the default while keeping explicit `PATH` use
  available.
- Fall back from an unavailable managed binary to a compatible `PATH` binary
  without hiding which source was selected.
- Preserve CLI configuration and credentials across installation and updates.
- Support multiple isolated accounts per agent, with a global default and
  narrower overrides.
- Track plan usage independently per account and prevent cross-account snapshot
  attribution.
- Offer optional account failover between sessions, disabled by default.
- Prove the complete behavior locally through full-stack deterministic E2E.

## Non-goals

- Installing or updating agent CLIs globally.
- Adding the E2E suite to CI.
- Requiring real provider credentials for the deterministic acceptance pass.
- Switching accounts during an active session.
- Automatically enabling failover.
- Supporting operating systems that Symphony does not otherwise support.
- Replacing provider-native authentication flows or storing raw secrets in the
  Symphony database.

## Reference Decisions

### Copied from Orca

- A disposable home and application-data boundary for every E2E execution.
- Per-account runtime homes and explicit account selection.
- Per-account usage snapshots, including inactive-account snapshots.
- Generation guards that discard a usage response started for a previously
  selected account.
- Cached usage with explicit fresh, fetching, stale, unavailable, and error
  states.
- Poll throttling, retry/backoff, and active-session safety gates.
- Optional, explicitly enabled real-account validation outside the
  deterministic acceptance pass.

### Copied from Jean

- A single settings surface that explains installed version, effective source,
  update state, authentication, and usage without requiring terminal commands.
- Configuration grouped by agent with an explicit managed-versus-PATH choice.
- Update status and manual refresh actions presented alongside the installed
  tool.

### Symphony-specific additions

- A resolver that returns both the preferred source and the effective source,
  including a structured fallback reason.
- Optional account failover as a session-admission decision.
- Full-stack E2E for lifecycle, accounts, usage, and failover, rather than a
  browser-only mocked backend.

## Architecture

The implementation is divided into six bounded components.

### Agent catalog

The catalog defines provider-specific metadata for Claude, Codex, Cursor, and
OpenCode:

- executable name;
- supported managed release source and platform artifact mapping;
- version command and parser;
- authentication probe;
- configuration and credential home environment variables;
- update strategy;
- usage adapter capability.

Provider differences remain inside adapters. The installer, resolver, account
manager, and UI consume a common contract.

### Managed installation store

Managed binaries live below a Symphony-owned data root:

```text
<symphony-data>/agents/
  claude/versions/<version>/claude
  codex/versions/<version>/codex
  cursor/versions/<version>/cursor-agent
  opencode/versions/<version>/opencode
  <agent>/current
```

`current` is an atomic pointer or equivalent platform-safe manifest. A managed
update downloads into a staging directory, verifies the artifact, probes the
executable, and only then changes `current`. A failed download, verification,
extraction, or probe leaves the previous version selected and usable.

Installation records contain version, platform, artifact identity, checksum
when published by the upstream source, installation timestamp, and last probe
result. Credentials and user configuration never live inside a version
directory, so replacing a binary cannot overwrite them.

### Source resolver

Each agent has a preferred source:

- `managed`, the default; or
- `path`, selected explicitly by the operator.

The resolver probes the preferred source first. With `managed` preferred, an
unavailable, non-executable, or incompatible managed binary may fall back to
the `PATH` candidate. The result includes:

```text
preferred_source
effective_source
executable_path
version
fallback_reason
probe_timestamp
```

No unreported fallback is allowed. If neither source is usable, admission fails
before a session is created and reports both probe results. Selecting `PATH`
explicitly does not silently install or mutate a global package.

When the managed source becomes healthy again, new sessions resolve back to
managed. Already-running sessions retain their resolved executable and account
runtime.

### Account runtime manager

Accounts are metadata records pointing to provider-owned credentials stored in
isolated runtime homes:

```text
<symphony-data>/agents/<agent>/accounts/<account-id>/home
```

The account record contains an opaque ID, operator label, agent kind,
authentication status metadata, creation/update timestamps, and whether it is
the global default. Raw access tokens and refresh tokens are not copied into
database rows, API responses, logs, traces, or E2E artifacts.

Account selection is resolved at session admission using this precedence:

```text
session/request override
project override
global default
first eligible authenticated account
```

The selected account ID, effective executable source, executable version, and
runtime home become immutable launch provenance for that session. Changing a
default or override affects only later sessions.

### Usage service

Usage is keyed by `(agent_kind, account_id)`. A snapshot includes:

- plan;
- session window;
- weekly window;
- provider/model-specific windows;
- credits when available;
- fetch timestamp;
- state and stale reason;
- next eligible refresh time;
- provider error classification without secret-bearing response bodies.

Only one fetch for a given account may mutate that account's cache at a time.
Every selection change increments a generation. A completed request whose
generation no longer matches is retained only for its original account and
cannot replace the currently selected account view.

Rate limiting, temporary provider failures, and authentication failures may
serve a previous snapshot marked stale. Backoff and provider `Retry-After`
information control the next fetch. One account's failure does not abort
refreshing other accounts.

### Failover policy

Failover is disabled by default and is evaluated only before launching a new
session. When enabled, the resolver tries the preferred account first and then
other authenticated accounts in stable configured order.

An account is ineligible when the relevant usage window is exhausted, the
provider reports a rate-limit condition, authentication is invalid, or its
runtime cannot be launched. Stale usage alone does not prove exhaustion; the
policy may attempt the preferred account unless a fresh provider error makes it
ineligible.

If all accounts are ineligible, session admission fails with a redacted
per-account reason summary. Symphony never migrates, restarts, or changes the
identity of an active session to perform failover.

## Configuration and UI

Each agent settings page shows:

- preferred and effective CLI source;
- managed and `PATH` probe results;
- installed and available versions;
- install, repair, update, and refresh actions;
- automatic-update preference and pending-update state;
- account list, default account, and authentication status;
- failover toggle, disabled by default;
- usage grouped by account, with fresh/stale/error state and reset time.

The configuration surface uses Jean's compact organization but preserves
Orca-style source and account detail. Operator choices are persisted by agent.
Configuration import or migration merges only settings Symphony owns; unknown
provider-native fields remain unchanged.

## Update Behavior

Automatic update checks may be enabled independently from installation. An
available update never replaces a binary used by an active session. It is
recorded as pending and retried after all sessions using that executable have
finished.

Managed updates use the staged atomic flow. A `PATH` installation is reported
as externally managed. Symphony may present or execute an adapter-approved
self-update action only after an explicit operator action; it does not infer
permission to run a global package-manager mutation.

## Error Handling and Safety

- E2E launch strips ambient home and agent-home environment variables.
- The harness fails before startup if a disposable home resolves to the
  operator's real home.
- Downloaded artifacts are staged outside the active version directory.
- An executable probe is mandatory before activation.
- Logs redact tokens, authorization headers, credential file contents, and
  provider response bodies that may contain secrets.
- Account deletion removes Symphony's metadata and managed isolated home only
  after an explicit destructive action; it never removes a global provider
  home.
- Installer, updater, usage refresh, and account operations expose structured
  states so the UI never has to infer progress from text.

## E2E Test Harness

The harness follows Orca's application-level approach:

```text
Playwright
  -> real tracker UI
  -> real Phoenix HTTP/channel boundary
  -> real lifecycle/account/usage services
  -> disposable filesystem and deterministic provider fixtures
```

Each run creates:

- a disposable Symphony data directory;
- disposable `HOME` and provider runtime homes;
- a controlled `PATH`;
- a local release/usage fixture server;
- executable CLI fixtures for all four agents;
- a write-audit boundary that records filesystem paths touched by the
  lifecycle.

The fixture CLIs implement the provider commands the production adapters call:
version, authentication status, minimal session execution, consumption output,
rate-limit failure, and controlled process lifetime. Tests configure fixture
behavior through files in the disposable root rather than browser network
interception, so backend execution remains real.

Playwright retains trace, screenshot, video, Phoenix logs, fixture-server logs,
and a redacted disposable-directory manifest on failure. The suite has zero
retries for the acceptance run so a flaky first attempt is a failure.

## Deterministic E2E Matrix

### Installation and isolation

- Install each of Claude, Codex, Cursor, and OpenCode from a clean state.
- Verify managed version, executable permission, selected `current` version,
  backend version probe, and UI status.
- Assert every created file is inside the disposable data or home roots.
- Assert the operator's real home has no before/after manifest difference for
  the protected agent paths.

### Source selection and fallback

- Confirm managed is the initial preference.
- Explicitly select a controlled `PATH` binary and launch through it.
- Corrupt or remove managed and verify fallback to `PATH`, including the
  displayed reason and launch provenance.
- Remove both candidates and verify admission fails before process launch.
- Repair managed and verify subsequent sessions return to managed.

### Updates

- Upgrade an old managed version and verify atomic activation.
- Fail download, checksum, extraction, and executable probe independently;
  verify the prior version remains active.
- Hold a fixture session open, request an update, and verify it remains pending.
- Finish the session and verify the pending update activates.
- Verify account homes and provider configuration hashes are unchanged.

### Multiple accounts

- Add two isolated accounts for the same agent and authenticate both through
  fixtures.
- Verify global default, project override, and request/session override
  precedence.
- Change defaults during an active session and verify its launch provenance
  remains unchanged.
- Verify each fixture process sees only the selected account home.
- Scan API payloads, logs, traces, and artifacts for seeded secret sentinels.

### Usage

- Fetch distinct session, weekly, model, and credit values for two accounts.
- Switch accounts while an earlier response is delayed and verify it cannot be
  attributed to the newly selected account.
- Return `429`, timeout, authentication failure, and provider failure and verify
  stale-state and backoff behavior.
- Verify refreshing one failing account still refreshes another account.
- Verify inactive accounts retain their last snapshot.

### Failover

- With failover disabled, exhaust the default account and verify no silent
  account switch.
- Enable failover and verify the next session selects the next eligible
  account.
- Exhaust an account during a running session and verify no mid-session switch.
- Make every account ineligible and verify a redacted consolidated error.
- Advance the fixture clock beyond reset and verify the preferred account
  becomes eligible again.

## Optional Real-provider Smoke

A separate explicit command may inspect locally authenticated providers. It
must use a disposable Symphony profile, must not copy or print credential
contents, and must skip providers without an existing supported login.

The smoke performs version detection, authentication status, and the smallest
available usage query. It is diagnostic evidence only and is not required for
the deterministic acceptance pass.

## Acceptance Criteria

- The deterministic full-stack E2E matrix passes locally with zero retries.
- Backend-focused tests pass for provider adapters, resolution, installation,
  update rollback, account precedence, usage generation guards, and failover
  eligibility.
- Tracker tests pass for source, update, account, usage, stale, and failover
  presentation.
- The protected real-home manifest is unchanged.
- Seeded secret sentinels do not appear in API output, application logs,
  Playwright artifacts, or the generated filesystem manifest.
- No CI workflow or CI script is added or modified.
- Test commands and evidence locations are documented for manual regression
  runs.
