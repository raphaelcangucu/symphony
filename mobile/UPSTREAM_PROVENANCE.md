# Orca Mobile Upstream

The Dev10x mobile experience vendors production interface work from
[stablyai/orca](https://github.com/stablyai/orca), under the MIT license
reproduced in `THIRD_PARTY_NOTICES.md`.

## Pinned baseline

- Repository: `https://github.com/stablyai/orca.git`
- Commit: `5c3c2f2b3daf9d8563581c389712d805bfb256a1`
- Import date: 2026-07-25
- Upstream path: `mobile/`

The mechanical presentation import covers these upstream directories:

```text
mobile/src/browser
mobile/src/cache
mobile/src/components
mobile/src/constants
mobile/src/diagnostics
mobile/src/dictation
mobile/src/files
mobile/src/hooks
mobile/src/layout
mobile/src/notifications
mobile/src/platform
mobile/src/session
mobile/src/source-control
mobile/src/storage
mobile/src/tasks
mobile/src/terminal
mobile/src/theme
mobile/src/worktree
```

It also covers the production host routes below `mobile/app/h/`, pairing
routes, settings routes, troubleshooting, about, and the home route. Imported
files live below `src/dev10x/` or retain their Expo route under `app/`.
Non-cryptographic transport helpers and the exact `src/shared/` types required
by these screens are included as supporting source.

## Deliberate transport exclusions

Dev10x retains the established Symphony pairing, application-level E2EE and
multi-host RPC runtime. The following Orca implementations are therefore not
vendored:

```text
mobile/src/transport/e2ee.ts
mobile/src/transport/rpc-client.ts
mobile/src/transport/client-context.tsx
mobile/src/transport/host-store.ts
mobile/src/transport/pairing.ts
```

Compatibility facades with those call shapes are implemented against the
Symphony runtime. This keeps the copied screens mechanically close to Orca
without replacing device-scoped credentials, host public-key verification, or
the Symphony RPC protocol.

## Comparing with upstream

Check out the pinned source beside this repository, then run:

```bash
ORCA_SOURCE=/home/raphaelcangucu/orca
test "$(git -C "$ORCA_SOURCE" rev-parse HEAD)" = \
  "5c3c2f2b3daf9d8563581c389712d805bfb256a1"
git diff --no-index \
  "$ORCA_SOURCE/mobile/src/components" \
  mobile/src/dev10x/components
```

Repeat the final comparison for each imported directory. Expected differences
are limited to import roots, Dev10x/Symphony user-facing copy, capability
gates, and the transport facade.

## Symphony host capability matrix

The copied interface only exposes a feature when the selected Symphony host
advertises the corresponding RPC capability. The current bridge intentionally
has this support:

| Orca surface | Symphony RPC capability | Current behavior |
| --- | --- | --- |
| Dev10x tasks | `symphony.tasks.list`, `symphony.tasks.get` | Native Symphony projects, issues, agents, blockers and subtasks |
| Notifications | `notifications.subscribe`, `notifications.unsubscribe` | Host-routed real-time stream with redacted payloads |
| Diagnostics | `status.get`, `system.health`, `system.heartbeat` | Direct selected-host reachability and protocol health |
| GitHub, GitLab, Linear | Provider-specific methods | Hidden unless a selected host explicitly advertises them |
| Voice and speech models | `speech.*` methods | Upstream unavailable state; not advertised by the current host |

No native two-way audio dependency is installed while `speech.*` is absent.
This preserves Orca's capability-disabled behavior without fabricating
production data or coupling the app to a central service.
