# Agent CLI Lifecycle, Accounts, Usage, and E2E Implementation Plan

**Goal:** Deliver managed-first isolated Claude, Codex, Cursor, and OpenCode
lifecycles with transparent PATH fallback, isolated multi-account routing,
per-account consumption, session-boundary failover, and an Orca-style
full-stack manual E2E pass.

**Architecture:** A provider catalog feeds a filesystem-backed lifecycle
service under the XDG/Symphony data root. The root `CodingAgent` boundary
resolves an immutable launch context (binary, source, version, account home)
before delegating to existing provider adapters. Accounts and usage are keyed
by provider/account; REST and tracker settings present the same state. A
Playwright harness starts the real Phoenix/Tracker stack with disposable homes,
a controlled PATH, a local fixture registry, and executable provider fixtures.

**Tech Stack:** Elixir/OTP, Phoenix, Ecto settings, Req, filesystem atomic
renames, React/TypeScript, Vitest, Playwright.

---

## File Structure

### Backend lifecycle

- `elixir/lib/symphony_elixir/agent_lifecycle/paths.ex` — XDG and explicit
  lifecycle data-root resolution.
- `elixir/lib/symphony_elixir/agent_lifecycle/catalog.ex` — provider metadata,
  commands, environment keys, release sources, and platform asset names.
- `elixir/lib/symphony_elixir/agent_lifecycle/probe.ex` — executable/version
  probes with managed-candidate exclusion from PATH discovery.
- `elixir/lib/symphony_elixir/agent_lifecycle/resolver.ex` — preferred/effective
  source resolution and fallback reason.
- `elixir/lib/symphony_elixir/agent_lifecycle/installer.ex` — staged download,
  checksum/extraction/probe, atomic current pointer, rollback, and pending
  update.
- `elixir/lib/symphony_elixir/agent_lifecycle/runtime_registry.ex` — active
  launch leases used to defer binary replacement.
- `elixir/lib/symphony_elixir/settings/agent_cli.ex` — persisted source,
  automatic-update, and failover settings.

### Accounts and usage

- `elixir/lib/symphony_elixir/agent_accounts.ex` — atomic metadata manifest,
  isolated homes, defaults, overrides, redacted presentation, and eligibility.
- `elixir/lib/symphony_elixir/agent_launch.ex` — immutable launch-context
  resolution and provider-specific command/environment projection.
- `elixir/lib/symphony_elixir/agent_usage.ex` — account-keyed cache with
  generation, stale/error/backoff state, while preserving default-account
  compatibility.
- `elixir/lib/symphony_elixir/agent_usage/snapshot.ex` — account/state metadata.
- `elixir/lib/symphony_elixir/agent_failover.ex` — admission-only stable account
  selection.
- Existing provider adapters/runners — consume resolved commands and
  account-home environment without resolving identity again.

### HTTP and tracker

- `elixir/lib/symphony_elixir_web/controllers/tracker/agent_tool_controller.ex`
  — lifecycle mutations and account CRUD/default operations.
- `elixir/lib/symphony_elixir_web/controllers/tracker/settings_controller.ex`
  — account-grouped usage presentation.
- `elixir/lib/symphony_elixir_web/router.ex` — lifecycle/account routes.
- `tracker/src/services/settings.ts` — lifecycle/account DTOs and mutations.
- `tracker/src/types/agent-usage.ts` and
  `tracker/src/services/agentUsage.ts` — account-keyed usage contract.
- `tracker/src/pages/AgentToolSettingsPage.tsx` and focused settings components
  — source, install/update, accounts, failover, and usage.
- `tracker/src/components/settings/AgentUsagePanel.tsx` — grouped account usage.
- `tracker/src/i18n/locales/{en,pt-BR}.json` — user-facing copy.

### E2E

- `tracker/e2e/agent-lifecycle.spec.ts` — full-stack acceptance flow.
- `tracker/e2e/fixtures/agent-fixture-server.mjs` — local release/usage server.
- `tracker/e2e/fixtures/fake-agent-cli.sh` — executable provider behavior.
- `tracker/e2e/fixtures/agent-e2e-harness.ts` — disposable HOME/data/PATH,
  backend lifecycle, write audit, and cleanup.
- `tracker/playwright.agent-lifecycle.config.ts` — zero-retry manual suite.
- `scripts/test-agent-lifecycle-e2e.sh` — single manual acceptance command.

## Task 1: Lifecycle catalog, paths, settings, and probes

**Files:**
- Create the backend lifecycle files listed above for paths, catalog, probe,
  and settings.
- Modify `elixir/lib/symphony_elixir/settings.ex`.
- Modify `elixir/lib/symphony_elixir/settings/agent_tools.ex`.
- Test `elixir/test/symphony_elixir/agent_lifecycle/{paths,catalog,probe}_test.exs`.
- Test `elixir/test/symphony_elixir/settings/agent_cli_test.exs`.

- [ ] Write failing tests proving:
  - explicit `:agent_data_dir` wins;
  - otherwise `XDG_DATA_HOME/symphony/agents` is used;
  - all four providers have catalog entries;
  - managed defaults and failover defaults are persisted/cast safely;
  - PATH probing skips the managed binary.
- [ ] Run each focused test and confirm failure because modules/settings do not
  exist.
- [ ] Implement the minimum modules and register the `agent_cli` settings group.
- [ ] Re-run focused tests and directly related existing settings/availability
  tests.
- [ ] Commit as `feat(agents): add lifecycle catalog and settings`.

The public settings contract established here is:

```elixir
%{
  "codex" => %{
    "preferred_source" => "managed",
    "auto_update" => true,
    "failover_enabled" => false
  }
}
```

## Task 2: Managed installer, atomic updates, and source resolver

**Files:**
- Create `installer.ex`, `resolver.ex`, and `runtime_registry.ex`.
- Modify `agent_tools.ex`.
- Test `installer_test.exs`, `resolver_test.exs`, and
  `runtime_registry_test.exs`.

- [ ] Write failing tests for clean install, executable permission, current
  pointer, checksum mismatch, failed probe rollback, active-session deferral,
  managed-to-PATH fallback, both-sources failure, and automatic recovery to
  managed.
- [ ] Confirm each new behavior fails for the expected missing implementation.
- [ ] Implement injected release/download/extract transports first, then Req
  production transports copied from Jean's stable provider definitions:
  Anthropic distribution manifest for Claude, GitHub releases for
  Codex/OpenCode, and Cursor's official installer staged under a disposable
  HOME.
- [ ] Keep activation atomic: write `<version>.staging`, probe, rename to the
  version directory, then atomically replace the `current.json` manifest.
- [ ] Re-run the focused lifecycle tests and `agent_availability_test.exs`.
- [ ] Commit as `feat(agents): manage isolated CLI installations`.

The resolver result is:

```elixir
%SymphonyElixir.AgentLifecycle.Resolver.Result{
  preferred_source: :managed,
  effective_source: :path,
  executable_path: "/fixture/path/codex",
  version: "1.2.3",
  fallback_reason: :managed_missing,
  probed_at: 1_900_000_000
}
```

## Task 3: Isolated accounts and immutable launch provenance

**Files:**
- Create `agent_accounts.ex` and `agent_launch.ex`.
- Modify `coding_agent.ex` and the four provider adapters/runners only where
  required to consume resolved command/environment.
- Test `agent_accounts_test.exs`, `agent_launch_test.exs`, and focused adapter
  tests.

- [ ] Write failing tests for two isolated homes, atomic metadata writes,
  global/project/request precedence, redacted account presentation, and
  immutable session provenance.
- [ ] Confirm failures before implementation.
- [ ] Implement account manifests without raw secrets. Project and request
  overrides are inputs to `AgentAccounts.resolve/3`; the selected account home
  remains fixed in the returned launch context.
- [ ] Change the root `CodingAgent.start_session/3` to resolve once and inject:
  `:codex_config["command"]`, `:claude_command`, `:cursor_command`, or
  `:opencode_command`, plus provider-home environment.
- [ ] Attach `agent_launch` provenance to the returned session and acquire a
  runtime lease released by `CodingAgent.stop_session/2`.
- [ ] Re-run focused root/adapter tests.
- [ ] Commit as `feat(agents): isolate account launch contexts`.

## Task 4: Per-account usage, generation safety, and backoff

**Files:**
- Modify `agent_usage.ex`, `snapshot.ex`, Claude usage, and observability
  capture call sites.
- Create `elixir/lib/symphony_elixir/agent_usage/refresh.ex`.
- Test account cache, generation, stale, independent refresh, and compatibility
  paths.

- [ ] Write failing tests proving distinct snapshots per account, inactive
  retention, delayed-response attribution, stale fallback on 429/auth/timeout,
  Retry-After/backoff, and failure isolation.
- [ ] Confirm the current per-agent store fails these tests.
- [ ] Change the internal key to `{agent_kind, account_id}` and add explicit
  fetch state. Preserve `put(agent, snapshot)` and `get(agent)` by mapping them
  to the default account for existing observability callers.
- [ ] Pass account-home credentials to Claude usage and stamp account IDs on
  passive Codex snapshots when launch provenance is present.
- [ ] Re-run usage, observability, controller, and tracker normalization tests.
- [ ] Commit as `feat(agents): track usage per isolated account`.

## Task 5: Session-boundary failover

**Files:**
- Create `agent_failover.ex`.
- Modify `agent_launch.ex` and root `coding_agent.ex`.
- Test `agent_failover_test.exs` and launch integration tests.

- [ ] Write failing tests for disabled behavior, enabled stable fallback,
  exhausted/auth/runtime ineligibility, all-ineligible redacted summary, reset
  eligibility, and no mid-session identity change.
- [ ] Confirm failures.
- [ ] Implement failover only inside launch admission. Never invoke it from
  `run_turn`.
- [ ] Keep stale usage eligible unless a current provider failure proves
  ineligibility.
- [ ] Re-run lifecycle/account/usage/launch tests.
- [ ] Commit as `feat(agents): add session-boundary account failover`.

## Task 6: REST API and Jean-style settings UI

**Files:**
- Create backend controller and focused tests.
- Modify router/settings controller.
- Modify tracker services/types/pages/components/i18n and focused Vitest tests.

- [ ] Write failing controller tests for source selection, install/update,
  repair, account CRUD/default, failover setting, redaction, and account usage.
- [ ] Implement authenticated routes and structured operation states.
- [ ] Write failing UI tests for effective fallback source, pending update,
  account selection, failover disabled default, stale usage, and action errors.
- [ ] Implement compact settings sections and service calls.
- [ ] Re-run focused backend and frontend tests.
- [ ] Commit as `feat(settings): manage agent CLIs and accounts`.

HTTP mutations use these routes:

```text
PUT    /settings/agents/:agent/source
POST   /settings/agents/:agent/install
POST   /settings/agents/:agent/update
POST   /settings/agents/:agent/repair
GET    /settings/agents/:agent/accounts
POST   /settings/agents/:agent/accounts
PUT    /settings/agents/:agent/accounts/:id
DELETE /settings/agents/:agent/accounts/:id
PUT    /settings/agents/:agent/accounts/:id/default
PUT    /settings/agents/:agent/failover
```

## Task 7: Orca-style full-stack manual E2E

**Files:**
- Create the E2E fixtures, harness, config, spec, and manual script listed in
  the file structure.
- Modify `tracker/package.json` only to add a manual
  `test:e2e:agent-lifecycle` command.
- Do not modify `.github/`, CI scripts, or CI workflow configuration.

- [ ] Write the failing Playwright spec first and confirm the lifecycle settings
  flow cannot yet complete.
- [ ] Implement a disposable harness that refuses the real HOME, strips agent
  home variables, starts the fixture registry and real Phoenix/Tracker stack,
  and records protected-path manifests.
- [ ] Exercise installation/isolation, source fallback/recovery, atomic update
  rollback and deferral, two accounts, delayed usage, stale/backoff, disabled
  and enabled failover, and all-ineligible errors.
- [ ] Scan trace/log/output artifacts for secret sentinels.
- [ ] Run with `retries: 0` and retain trace, screenshot, video, daemon logs,
  fixture logs, and redacted filesystem manifest.
- [ ] Commit as `test(agents): cover lifecycle with full-stack e2e`.

## Task 8: Final audit and evidence

- [ ] Compare every acceptance criterion in the design spec to a focused test or
  E2E assertion.
- [ ] Run every created/modified backend test and directly related existing
  tests.
- [ ] Run every created/modified tracker test.
- [ ] Run the single full-stack Playwright lifecycle spec with zero retries.
- [ ] Run changed-path lint/typecheck and `git diff --check`.
- [ ] Verify no CI files changed.
- [ ] Verify the real-home protected manifest is unchanged and no secret
  sentinel appears in artifacts.
- [ ] Record the commands and artifacts in fresh Symphony evidence.
- [ ] Commit any final documentation/evidence-safe adjustments.
