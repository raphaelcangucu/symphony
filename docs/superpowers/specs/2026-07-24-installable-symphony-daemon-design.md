# Installable Symphony Daemon

**Date:** 2026-07-24

**Status:** Approved for implementation

**Area:** `elixir/` release packaging, daemon lifecycle, configuration, persistence, and operator CLI

## Summary

Symphony already has a useful **development daemon**: `make serve` starts a
detached BEAM, `make update` hot-reloads selected supervision subtrees, and
`make stop` shuts it down. That process still depends on the source checkout,
Mix, mise, `_build`, a development Erlang cookie, and paths compiled from the
repository.

This design adds a separate **installed daemon mode** for Linux and WSL:

- an immutable OTP release containing ERTS, the SQLite NIF, tracker assets, and
  Symphony's vendored skills;
- a `systemd --user` service that owns restart and boot-session lifecycle;
- an operator interface, `symphony daemon
  install|status|start|stop|restart|uninstall`;
- persistent configuration, data, backups, and logs under XDG directories;
- safe migration from an existing checkout-owned installation;
- graceful draining before ordinary stops and restarts; and
- health, process, version, unit, and configuration drift reporting.

The existing development workflow remains intact. Installed mode does not use
distributed Erlang and does not depend on the checkout after installation.

## Research Baseline

The reference implementation was studied from the official OpenClaw repository
at commit `3b7b2a2a1f2ae13aa3f75576b972c7a622a61597` (2026-07-23), cloned locally
as `/home/raphaelcangucu/openclaw-reference`.

The relevant OpenClaw design consists of:

- a cross-platform service abstraction selecting launchd, systemd user
  services, or Windows Scheduled Tasks;
- install, start, stop, restart, uninstall, and rich status commands;
- foreground gateway execution supervised by the operating system;
- per-port ownership protection;
- service restart policy with bounded crash-loop behavior;
- status that combines service-manager state, command/version/port drift,
  listener/PID ownership, and an application-level probe; and
- shutdown/restart signals that allow active work to drain before termination.

Symphony adopts those principles, but uses OTP-native release and shutdown
mechanisms instead of copying OpenClaw's Node-specific implementation.

## Current Symphony Baseline

The current development lifecycle is:

```text
make serve
  -> mix symphony.ctl serve
  -> setsid elixir --name symphony@127.0.0.1 ... dev/serve.exs
  -> one BEAM with Shared, Orchestrator, Web, and Editor supervisors
```

This is deliberately optimized for development:

- `make update` can recompile and restart only one supervision subtree;
- distributed Erlang provides the local control channel;
- `.symphony/serve.log` and a lock file describe the detached process; and
- the process runs directly from the repository's dev build.

It is not an installable production-style service:

- there is no OS-owned restart policy or user-service installation;
- the process depends on Mix/mise, `_build`, and the checkout;
- the default node cookie is suitable only for localhost development;
- the database, backup, log, root, and skills paths are checkout-derived;
- the escript cannot run the SQLite-backed application because it cannot load
  the native SQLite NIF; and
- status does not prove that the expected version owns the expected port and
  responds to `/api/health`.

On application boot, `Assistant.TurnManager` already changes orphaned
`running` assistant turns to `interrupted (serve_restart)`. Issue orchestration
and preview managers also reconcile durable state. That is sufficient for
honest recovery, but not for automatic replay of an interrupted tool call.

## Goals

1. Run Symphony continuously as a user-owned OS service on Linux and WSL.
2. Make the installed process independent of Mix, mise, `_build`, and the
   source checkout.
3. Preserve the current `make serve` development workflow without changing its
   hot-reload behavior.
4. Package every runtime dependency Symphony owns: ERTS, Elixir/BEAM code,
   SQLite NIFs, migrations, tracker assets, and vendored skills.
5. Give operators idempotent lifecycle commands and a status command that
   distinguishes installed, enabled, active, listening, healthy, and drifted.
6. Keep data across reinstalls and uninstall; make every destructive migration
   step explicit, verified, and recoverable.
7. Drain active issue and assistant work before ordinary restart/stop, within a
   bounded timeout.
8. Recover automatically from unexpected crashes while avoiding infinite
   restart loops for invalid configuration.

## Non-goals

- launchd and Windows Scheduled Tasks support in the first implementation;
- a remote daemon administration API;
- a general automatic update/download channel;
- OTP hot upgrades with `appup`/`relup`;
- changing the existing development daemon or removing distributed Erlang from
  development;
- automatically replaying interrupted assistant messages, tool calls, or shell
  commands after a crash;
- deleting user configuration, databases, backups, logs, or release history
  during normal uninstall; or
- running Symphony as root or as a machine-wide system service.

## Chosen Approach

The installed daemon is a versioned OTP release supervised in the foreground by
`systemd --user`.

This was selected over two alternatives:

1. **Point systemd at the source checkout.** This is quick, but preserves the
   Mix/mise/_build dependency and makes a checkout mutation capable of breaking
   the service.
2. **Keep one permanent implementation that supports source and release modes
   through the same lifecycle internals.** This reduces visible commands but
   couples development hot reload to production service concerns and expands
   the test matrix.

The selected split keeps both modes simple:

```text
Development
  make serve/update/stop
    -> checkout + Mix + distributed Erlang + hot subtree reload

Installed
  symphony daemon ...
    -> versioned OTP release + systemd --user + XDG state
    -> no checkout, Mix, mise, _build, or production distribution
```

The first service-manager adapter is systemd. Internal boundaries must not put
systemd-specific parsing into generic lifecycle, path, migration, or status
logic, so launchd and Windows adapters can be added later without redesigning
the release.

## Artifact and Installation Layout

### Build artifact

`MIX_ENV=prod mix release symphony` builds a release that includes ERTS. A
packaging step adds:

- the release runtime and application code;
- all Ecto migrations;
- native dependencies, including Exqlite;
- `elixir/priv/static/tracker` and the other committed static assets;
- repository `skills/` under the application release at `priv/skills`;
- a foreground service launcher;
- an installed CLI launcher; and
- `manifest.json` with version, Git commit, target OS/architecture, build time,
  and artifact checksums.

The distributable is named
`symphony-<version>-linux-<architecture>.tar.gz`. It is architecture-specific
because it contains ERTS and native NIFs.

### Installed paths

Defaults follow the XDG base-directory convention:

| Purpose | Default |
|---|---|
| Configuration | `~/.config/symphony/symphony.env` |
| Installation manifest | `~/.local/share/symphony/install.json` |
| SQLite database | `~/.local/share/symphony/tracker.sqlite3` |
| Backups | `~/.local/share/symphony/backups/` |
| Runtime state | `~/.local/state/symphony/` |
| Rotating app logs | `~/.local/state/symphony/log/` |
| Versioned releases | `~/.local/lib/symphony/releases/<version>/` |
| Active release symlink | `~/.local/lib/symphony/current` |
| CLI launcher | `~/.local/bin/symphony` |
| User unit | `~/.config/systemd/user/symphony.service` |

`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` override their
respective roots. Every path is resolved by `SymphonyElixir.Daemon.Paths`;
callers do not independently reconstruct filesystem locations.

The environment file is mode `0600`, directories containing private state are
mode `0700`, and the generated unit and non-secret manifest are mode `0644`.

### Bootstrap and steady-state CLI

Two entrypoints call the same daemon command implementation:

- from a checkout, `mix symphony.daemon install ...` builds or accepts a release
  artifact and bootstraps the installation;
- after installation, `symphony daemon ...` invokes daemon management code with
  the active release's bundled runtime.

After bootstrap, start, stop, restart, status, repair, and uninstall do not
require a local Elixir installation. The existing escript execution behavior is
preserved for compatibility; the new `daemon` command is a management
subcommand and does not attempt to run the SQLite application inside the
escript.

## Runtime Configuration

Installed mode resolves runtime paths rather than compiling repository paths:

- `root_dir` becomes the XDG data directory;
- the default SQLite and backup paths come from `Daemon.Paths`;
- the default log file is under the XDG state directory; and
- the default skills root is
  `Application.app_dir(:symphony_elixir, "priv/skills")`.

Existing explicit environment overrides remain valid, including
`SYMPHONY_LOCAL_TRACKER_DATABASE`, `SYMPHONY_BACKUP_DIR`, tracker host/port, and
agent commands. Tests remain pinned to their current isolated paths.

The installer creates `symphony.env` from known `SYMPHONY_*` settings. It never
blindly sources or copies arbitrary shell code from `elixir/.env`. Values are
escaped for systemd's `EnvironmentFile` syntax, and the captured `PATH` is made
explicit because a user service does not necessarily inherit an interactive
shell's path.

The default HTTP bind remains `127.0.0.1:4000`. Binding a non-loopback address
continues to be an explicit operator choice.

Installation requires the existing guardrail acknowledgement:

```text
--i-understand-that-this-will-be-running-without-the-usual-guardrails
```

The acknowledgement is persisted as a non-secret setting and checked by the
service preflight. Missing acknowledgement is an invalid configuration, not a
crash to retry.

## Service Unit

The generated unit follows the useful OpenClaw systemd behavior while adapting
timeouts to Symphony's active-work drain:

```ini
[Unit]
Description=Symphony daemon
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
EnvironmentFile=%h/.config/symphony/symphony.env
WorkingDirectory=%h/.local/share/symphony
ExecStart=%h/.local/lib/symphony/current/bin/symphony-service
Restart=always
RestartSec=5
RestartPreventExitStatus=78
SuccessExitStatus=0 143
TimeoutStopSec=330
KillMode=control-group
OOMPolicy=continue

[Install]
WantedBy=default.target
```

The launcher first runs a release-native preflight and then `exec`s the release
in the foreground. A configuration, path, ownership, or port validation failure
exits with code `78`, which prevents a pointless restart loop. Unexpected
process failures remain restartable. The start-limit bounds rapid repeated
failures.

The unit is enabled with `systemctl --user enable --now symphony.service`.
Enabling the unit makes it start with the user's systemd manager. True
pre-login boot persistence depends on systemd lingering; status reports the
current linger state. The installer only enables lingering when the operator
passes an explicit `--enable-linger` option, because it changes host-level user
lifecycle.

## Components and Boundaries

### `SymphonyElixir.Daemon.Paths`

Returns typed, absolute paths for configuration, data, state, releases, the
active symlink, launcher, unit, database, backups, logs, and manifests. It
accepts an injected environment/home for hermetic tests.

### `SymphonyElixir.Daemon.Systemd.Unit`

Renders the complete deterministic unit from a validated path/config struct. It
contains no filesystem writes or command execution.

### `SymphonyElixir.Daemon.Systemd`

Owns `systemctl --user`, `journalctl --user-unit`, and `loginctl` interaction.
It receives an injected command runner. All command results are normalized into
stable Symphony error values rather than leaking raw shell tuples to the CLI.

### `SymphonyElixir.Daemon.Preflight`

Validates:

- supported OS/architecture and a functioning user systemd manager;
- guardrail acknowledgement;
- required directories, ownership, and file modes;
- release manifest and checksums;
- environment-file syntax and required secrets;
- configured agent/editor executables under the service `PATH`;
- database and migration readability; and
- port availability or ownership by the already-running expected service.

Warnings for optional integrations do not block installation. Conditions that
would make the daemon unable to boot return exit `78`.

### `SymphonyElixir.Daemon.Migration`

Migrates a checkout-owned environment and database into XDG storage. It refuses
to touch a database while the development daemon owns it. The operator must
stop `make serve` first.

For an existing SQLite database it:

1. identifies the source database and its WAL/SHM state;
2. creates a consistent SQLite snapshot using the bundled SQLite runtime;
3. runs `PRAGMA integrity_check` on the snapshot;
4. copies it to a temporary file in the destination directory;
5. fsyncs and atomically renames it into place;
6. applies release migrations;
7. verifies the migrated database; and
8. records source, destination, checksum, timestamp, and schema version in the
   installation manifest.

The original source is never deleted or rewritten. Existing destination data is
never overwritten unless `--force` is present and a verified backup has first
been created.

### `SymphonyElixir.Daemon.Install`

Coordinates install, repair, and release replacement:

1. preflight the candidate artifact and current installation;
2. migrate configuration/data when requested or on first install;
3. extract the candidate into a new versioned directory;
4. atomically write the environment, launcher, manifest, and unit;
5. run `systemctl --user daemon-reload`;
6. atomically switch `current` to the candidate release;
7. enable/start or restart the service;
8. wait for service state plus `/api/health`; and
9. report success only after the expected version is healthy.

On an upgrade or `install --force`, the previously active release and unit are
retained until health succeeds. If the candidate fails first boot, installation
restores the previous symlink/unit, restarts the prior release, and reports the
candidate's diagnostics. A first-ever install that fails remains stopped and
prints the relevant journal command.

`--force` means repair or replace installation metadata; it never means delete
data.

### `SymphonyElixir.Daemon.Status`

Builds one status snapshot from:

- installation manifest and active-release symlink;
- rendered-versus-installed unit content;
- `systemctl --user show` properties (`LoadState`, `UnitFileState`,
  `ActiveState`, `SubState`, `MainPID`, restart count, and last result);
- configured host and port;
- TCP/listener ownership where the platform exposes it;
- `GET /api/health`; and
- release version/build commit returned by the health endpoint.

Human output leads with the actionable state and repair command. `--json`
returns a stable machine-readable object. A service is `healthy` only when the
expected unit is active, the expected process responds on the expected port,
the probe succeeds, and its version matches the active manifest.

Drift is reported independently from health:

- release/symlink drift;
- unit command or environment-file drift;
- configuration/port drift;
- version drift; and
- an unexpected process occupying the configured port.

### `SymphonyElixir.Daemon.Shutdown`

Owns the admission gate and drain state. During ordinary OTP shutdown,
`SymphonyElixir.Application.prep_stop/1`:

1. closes admission for new assistant turns and new issue dispatch;
2. allows already-running assistant and orchestrator executions to finish;
3. waits until active work reaches zero or five minutes elapse;
4. records any timed-out work as interrupted/resumable; and
5. lets OTP stop the supervision tree and its OS children.

Systemd then enforces the remaining 30-second termination margin through
`TimeoutStopSec=330` and `KillMode=control-group`.

`symphony daemon restart --force` skips draining by killing the current unit
process group and waiting for systemd's restart policy to establish a new
healthy instance. Ordinary `stop`, `restart`, upgrade, and uninstall always use
the graceful path.

### CLI adapters

`Mix.Tasks.Symphony.Daemon` and the installed `symphony daemon` route to a
shared command parser and lifecycle API. Supported commands are:

```text
symphony daemon install [--artifact PATH] [--migrate-from PATH]
                        [--force] [--enable-linger]
symphony daemon status [--json]
symphony daemon start
symphony daemon stop
symphony daemon restart [--force]
symphony daemon uninstall
```

Commands are idempotent:

- installing the same healthy version is a no-op;
- starting an active healthy service succeeds;
- stopping an inactive service succeeds;
- uninstalling an absent unit succeeds; and
- status never mutates the installation.

## Lifecycle and Failure Semantics

| Event | Required behavior |
|---|---|
| Normal start | Preflight, start release in foreground, migrate only when explicitly coordinated, become healthy |
| Invalid config | Exit `78`; do not restart-loop |
| Unexpected BEAM crash | systemd restarts after five seconds, bounded by start-limit |
| Port occupied by another process | Refuse start, identify the conflict when possible, do not kill it |
| Second Symphony instance | Refuse the conflicting instance; never share one SQLite writer |
| Ordinary restart | Close admission, drain up to five minutes, stop, start, verify health |
| Forced restart | Kill the unit cgroup, let systemd restart, reconcile durable state |
| Upgrade failure | Restore previous release/unit and verify rollback health |
| Service crash during active turn | Mark orphaned turn interrupted/resumable on boot; do not replay tools |
| Uninstall | Disable and stop unit, remove unit/launcher/active symlink, preserve all user data and versioned releases |

The installed daemon has a single service owner. Development and installed
daemons may exist on the same machine only when they use different ports and
different databases. The installer refuses an ambiguous same-port or same-DB
configuration rather than taking ownership from the development daemon.

## Recovery and Replay Boundary

Symphony's durable issue, thread, turn, and preview state allows the new process
to reconcile after a crash. It does not provide a durable idempotency receipt
for arbitrary agent tool calls or shell side effects.

Therefore:

- issue orchestration may redispatch work through its existing durable tracker
  rules;
- previews may reconcile through their existing managers;
- assistant turns that were live at crash become
  `interrupted (serve_restart)` and remain manually resumable; and
- no in-flight agent command or tool call is automatically replayed.

This boundary prevents duplicate external writes, commits, messages, and
process launches.

## Health and Observability

`GET /api/health` remains unauthenticated on the configured bind address and is
extended to include:

```json
{
  "status": "ok",
  "version": "0.3.0",
  "git_commit": "<build commit>",
  "started_at": "<ISO-8601 timestamp>",
  "mode": "installed"
}
```

Development mode reports `"mode": "development"`. No secret or filesystem path
is exposed.

Rotating Symphony and SQL logs live under the XDG state log directory. Systemd
lifecycle and launcher output remains available through:

```bash
journalctl --user-unit symphony.service
```

`symphony daemon status` prints that command when the process is unhealthy and
includes the last service result without dumping secrets from the environment
file.

## Security

- The service runs as the current unprivileged user.
- Production distribution is disabled; no Erlang node cookie or EPMD control
  channel is used.
- The HTTP listener stays loopback-only by default.
- Secrets live only in the `0600` environment file or existing user credential
  stores.
- Status and diagnostics redact environment values.
- Unit generation uses absolute validated paths, not shell interpolation.
- The command runner passes argv directly; lifecycle code does not construct
  `sh -c` strings from user input.
- Migration and install writes use same-directory temporary files plus atomic
  rename.
- Uninstall is deliberately non-destructive to persistent data.

## Verification Strategy

### Unit tests

- XDG and explicit-path resolution with temporary homes.
- Deterministic systemd unit rendering and exact directives.
- Environment-file escaping, mode validation, and secret redaction.
- CLI parsing and idempotent lifecycle outcomes.
- Normalization of fake `systemctl`, `journalctl`, and `loginctl` results.
- Status classification for uninstalled, inactive, starting, healthy,
  unhealthy, port-conflicted, and drifted cases.
- Preflight exit `78` for invalid acknowledgement, paths, config, artifact, and
  port ownership.
- Shutdown admission closure, zero-work drain, completed drain, and timeout.

### Integration tests

- Run install/status/start/stop/restart/uninstall against a fake systemd runner
  and temporary XDG tree without touching the host unit.
- Build a real production release and prove that Exqlite, migrations, static
  tracker assets, and `priv/skills` load without the checkout.
- Boot the release on an isolated port and database, then assert the extended
  `/api/health` payload and installed version.
- Migrate a WAL-mode fixture database, compare logical content, run
  `integrity_check`, and prove that the source is unchanged.
- Simulate failed candidate health and prove atomic rollback to the prior
  release.

### Host acceptance on Linux/WSL

- Install a uniquely named test unit through the real user systemd manager.
- Confirm `systemctl --user show` and `symphony daemon status` agree.
- Send `SIGKILL`, observe the restart counter increase, and regain health.
- Start a long-running test execution, request restart, and prove it drains
  without orphaning child processes.
- Exercise `restart --force` and verify orphan reconciliation.
- Uninstall and prove the database, config, backups, logs, and versioned release
  remain.

### Repository gates

Run targeted tests throughout implementation, then:

```bash
cd elixir
make all
mix specs.check
```

## Rollout

1. Add portable runtime paths, release packaging, and release-only smoke tests.
2. Add the systemd adapter, deterministic unit, lifecycle CLI, and fake-runner
   integration suite.
3. Add migration, drift-aware status, graceful drain, and rollback.
4. Validate a uniquely named real unit in WSL before installing the canonical
   `symphony.service`.
5. Document build, first install, migration, diagnostics, repair, upgrade, and
   uninstall in `INSTALL.md` and `elixir/README.md`.

The existing `make serve` path remains the default developer workflow
throughout rollout.

## Acceptance Criteria

1. A production artifact can be built, copied outside the repository, and
   started without Mix, mise, `_build`, or checkout-relative files.
2. The installed release can open the SQLite database, apply migrations, serve
   tracker assets, and load every bundled Symphony skill.
3. `symphony daemon install` creates an enabled user service and reports success
   only after the expected release answers `/api/health`.
4. Killing the BEAM unexpectedly causes systemd to restart it and status becomes
   healthy again without operator action.
5. Invalid configuration and foreign port ownership fail clearly without a
   crash loop or killing another process.
6. Ordinary restart drains active work for up to five minutes; forced restart
   is explicit and leaves interrupted work honestly resumable.
7. `status` distinguishes service state, process/listener state, health, and
   drift, with both human and JSON output.
8. A failed upgrade restores the prior healthy release.
9. Uninstall removes service ownership but preserves configuration, database,
   backups, logs, and release history.
10. The development daemon and its `make serve/update/stop` behavior remain
    unchanged and all repository quality gates pass.
