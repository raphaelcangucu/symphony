# Public Preview Tunnel (cods.dev) — Design

> Exposes the Symphony tracker and each **ready dev server** publicly over a
> single Cloudflare Tunnel, with the Phoenix `:4000` hub doing **host-based
> reverse-proxy routing** to the loopback port of each per-issue/per-step dev
> server. Inspired by the Distribution Machine `public-dev` tooling, but
> extended from two fixed hostnames to **N dynamic preview hosts** driven by the
> existing `DevServer.Manager`. Hosts are **nested under a per-operator
> namespace** (`*.<namespace>.tracker.cods.dev`), backed by a Cloudflare
> **Advanced Certificate Manager** wildcard certificate.

## 1. Problem

Symphony already runs per-issue dev servers (`SymphonyElixir.DevServer.*`): each
serve step gets an allocated loopback port (`port_range`, default `4100..4199`)
and a URL built as `http://127.0.0.1:<port><url_path>`
(`DevServer.Instance.build_url/3`). The tracker SPA is served by Phoenix at
`/tracker/` on `:4000`, with the API under `/api/tracker/v1` and websockets at
`/socket`.

Today everything is **localhost-only**. To share a running preview (or the
tracker) with a teammate, or to hit it from an external webhook/device, a human
must be on the same machine/network.

The Distribution Machine (`seomachine/`) solves the equivalent problem with
`scripts/public-dev.sh` + the `public-dev-tunnel` skill: it generates a
`cloudflared` ingress with **two fixed hostnames** (`admin`, `api`) pointing at
two fixed local ports, optionally provisions Cloudflare DNS via the API
(`src/modules/cloudflare_dns.py`), and runs a named tunnel. It does **not**
route per-workspace; it is a static 1:1 host→port map.

We want the same "named tunnel + DNS + ingress" foundation, but with the
**dynamic** part (which preview is reachable at which host) owned by Symphony,
not by a regenerated `cloudflared` config.

## 2. Goal

1. Expose the tracker at a stable public host: `<namespace>.tracker.cods.dev`
   → `http://127.0.0.1:4000` (same-origin API + websocket).
2. Expose **each ready dev server** (per issue, per serve step) at a unique
   nested host `<preview>.<namespace>.tracker.cods.dev` that reverse-proxies to
   its loopback port.
3. Keep the **dynamic routing entirely inside Elixir** behind a single static
   wildcard tunnel ingress (`*.tracker.cods.dev` → `:4000`), so adding/removing a
   preview never regenerates the `cloudflared` config.
4. Reuse the existing `DevServer` lifecycle as the source of truth: a server
   becoming `:ready` registers its host→port mapping; stopping/crashing removes
   it.
5. Port the Cloudflare credentials/config pattern from the Distribution Machine
   into Symphony's `.env`, targeting `cods.dev`.
6. Provide a clean per-operator namespace so teammates can each expose their own
   previews under `*.<their-login>.tracker.cods.dev` without colliding.
7. Degrade gracefully: when the tunnel is disabled, behavior is exactly as today
   (loopback URLs); unknown hosts return 404; missing GitHub identity requires an
   explicit namespace or disables the tunnel.

## 3. Non-goals

- **Per-preview dynamic `cloudflared` ingress.** A single wildcard ingress
  covers everything; no config rewrite/reload per preview. (Differs from DM,
  which regenerates a small static config once per run.)
- **Sidecar reverse proxy (Caddy/nginx/traefik).** Considered and rejected for
  v1: the Phoenix hub already binds `:4000` and already knows every
  `{identifier, step, port}`. A sidecar would add a second process, a second
  health check, and route-sync plumbing for no benefit at single-user scale.
- **Multi-user authentication / per-user sessions on previews.** Single-user,
  trust-the-tunnel model, consistent with the rest of Symphony. The namespace
  is for host *organization*, not authentication. (The tunnel carries TLS to the
  Cloudflare edge; anyone with the URL can reach the preview.)
- **Path-based multiplexing** (`/front`, `/back` on one host). Rejected in favor
  of one host per serve step (decision D4).
- **A separate DNS level per project.** `*.{project}.{namespace}.tracker.cods.dev`
  would need a wildcard certificate **per (project, namespace)** pair. To keep
  **one wildcard certificate per operator**, the project is folded into the
  single preview label (decision D5); the host-building is isolated in
  `PublicRouting` so a future per-project level is a localized change.
- **Exposing code-server / the browser editor over the tunnel.** Easy to add
  later with the same plug (host `editor.<namespace>.tracker.cods.dev`), but out
  of scope here.
- **Automating the ACM certificate order.** The wildcard certificate is ordered
  once via the Cloudflare dashboard/API as an operator setup step (D5); only the
  CNAME records are automated by the Mix task.
- **Replacing the DM tooling.** This is a Symphony-native equivalent; the DM
  scripts stay in `seomachine/`.

## 4. Decisions

| ID | Decision | Notes |
|----|---|---|
| D1 | **Routing lives in Elixir**, via a new `SymphonyElixirWeb.PublicHostPlug` placed in the `Endpoint` **before** the `Router`. No sidecar. | The hub already owns `:4000` and the `{identifier, step, port}` truth. |
| D2 | **Static wildcard tunnel ingress**: one `cloudflared` rule `*.tracker.cods.dev` → `http://127.0.0.1:4000`. `cloudflared` matches hostnames by suffix, so one rule covers every operator's nested hosts. | Dynamism is 100% in the plug + registry; the tunnel config never changes per preview. |
| D3 | **Namespace = sanitized GitHub login** from `SymphonyElixir.LocalTracker.Viewer.current/0` (`github_login`), DNS-sanitized; overridable via `PUBLIC_NAMESPACE`. | Reuses existing operator identity; the namespace is a real DNS label (per-operator/team isolation). |
| D4 | **One public host per serve step**: `{project}-{issue}-{step}.{namespace}.tracker.cods.dev`. Reuses the already-deduplicated `step.slug` (`front`, `back`, `app`, …) and the issue identifier. | Escopo B. Multi-repo issues get distinct hosts (`front`, `back`). The `{project}-{issue}-{step}` part is a single DNS label. |
| D5 | **Nested per-namespace wildcard, ACM-backed (paid).** The preview label is a single DNS label directly under `{namespace}.tracker.cods.dev`, so **one** ACM wildcard certificate `*.{namespace}.tracker.cods.dev` (+ the apex `{namespace}.tracker.cods.dev` SAN) covers the tracker host and all previews for that operator. DNS = one wildcard CNAME `*.{namespace}.tracker.cods.dev` → `<tunnel-id>.cfargotunnel.com` plus the apex CNAME. | Requires Cloudflare Advanced Certificate Manager (~US$10/mo). The certificate is ordered once per operator; CNAMEs are automated (D9/§5.2). Host encode/decode isolated in `PublicRouting`. |
| D6 | **Host registry = ETS** owned by `SymphonyElixir.PublicRouting` (GenServer). `register(host, port)` on `:ready`, `unregister(host)` on stop/crash, `lookup(host)` for the plug. | Mirrors the existing `DevServer` ETS reservation table style. |
| D7 | **`build_url` derives the public URL** when the tunnel is enabled: `https://{host}{url_path}`; otherwise unchanged (`http://127.0.0.1:{port}{url_path}`). | Backwards-compatible; the issue Preview tab/Summary chip just shows the new URL. |
| D8 | **WebSocket/HMR supported**: HTTP requests proxy via `reverse_proxy_plug`; WebSocket upgrade requests proxy via the separate `reverse_proxy_plug_websocket` package (the HTTP package does not handle WS), which in turn requires `:websockex` to compile (pure-Elixir WS client). The plug detects the `upgrade: websocket` header and dispatches accordingly. | Vite/Next dev servers require WS for HMR. |
| D9 | **Config split**: Cloudflare credentials + namespace in `.env` (ported from DM, no `SYMPHONY_` prefix); feature toggle + base domain in a new `public_tunnel:` block in `WORKFLOW.md`, read only through `SymphonyElixir.Config`. | No ad-hoc env reads in business logic; matches `editor:`/`dev_server:`. |
| D10 | **Security guard**: the plug proxies a request **only if** (a) the host is under `*.{namespace}.tracker.cods.dev`, (b) `PublicRouting.lookup/1` resolves it to a known mapping, and (c) the target port is within `dev_server.port_range`. Otherwise 404. | Not a general-purpose proxy; only loopback + Symphony-allocated ports. |
| D11 | **63-char DNS label guard**: if the `{project}-{issue}-{step}` label exceeds 63 chars, deterministically shorten (truncate then append a short hash). | DNS labels are capped at 63 octets. |
| D12 | **Supersedes** the "No reverse-proxy routing through the `:4000` hub" non-goal in `2026-05-30-issue-dev-server-preview-design.md` (§3) and `2026-05-29-browser-vscode-task-workspace-design.md` (D4). The hub now *is* the proxy, but only for guarded preview hosts. | Conscious architecture change; documented in those specs' follow-ups. |

## 5. Architecture

```
Browser ──HTTPS──▶ Cloudflare edge (ACM *.<ns>.tracker.cods.dev) ──named tunnel──▶ 127.0.0.1:4000 (Phoenix)
                                                                                       │
                                                       SymphonyElixirWeb.PublicHostPlug   (before Router)
              ┌────────────────────────────────────────────────────┼──────────────────────────────────────┐
   <ns>.tracker.cods.dev          previsions-mm-42-front.<ns>.tracker.cods.dev                 127.0.0.1 / unknown
            │                                       │                                                  │
       (pass through)                  PublicRouting.lookup(host)                          (pass through if loopback)
            ▼                          ├─ {:ok, 4123} ─▶ ReverseProxyPlug ─▶ 127.0.0.1:4123 (WS ok)
       Router (app)                     └─ :error ──────▶ send_resp(404)                          else 404
```

Where `<ns>` is the operator namespace (sanitized GitHub login), e.g.
`raphaelcangucu`.

### 5.1 Backend modules

**`SymphonyElixir.Config`** — add a `public_tunnel:` map to the NimbleOptions
schema (sibling to `editor:`/`dev_server:`), with module-attribute defaults and
`@spec`'d accessors:

```elixir
public_tunnel: [
  type: :map,
  default: %{},
  keys: [
    enabled: [type: :boolean, default: false],
    base_domain: [type: :string, default: "tracker.cods.dev"],
    namespace: [type: {:or, [:string, nil]}, default: nil]
  ]
]
```

Accessors: `public_tunnel_enabled?/0`, `public_tunnel_base_domain/0`,
`public_tunnel_namespace/0` (returns the configured override or `nil`). The
resolved namespace (override → else sanitized GitHub login) is computed in
`PublicRouting`, not in `Config`, to avoid a network call inside config reads.

**`SymphonyElixir.PublicRouting`** — GenServer owning an ETS table plus the
host encode/decode logic:
- `register(host, port)` / `unregister(host)` / `lookup(host) :: {:ok, port} | :error`.
- `resolve_namespace/0` — `Config.public_tunnel_namespace/0` if set, else
  `Viewer.current/0`'s login sanitized to a DNS label; `{:error, :no_namespace}`
  when neither is available.
- `host_for(project_slug, identifier, step_slug) :: {:ok, host} | {:error, term}`
  — builds `"#{encode_label([project, issue, step])}.#{namespace}.#{base_domain}"`,
  applying the 63-char guard (D11) to the leading label only.
- `tracker_host/0` — `"#{namespace}.#{base_domain}"` (e.g.
  `raphaelcangucu.tracker.cods.dev`).
- `namespace_suffix/0` — `".#{namespace}.#{base_domain}"`, used by the plug to
  decide whether a host is in our wildcard scope.
- Pure helpers: `sanitize_label/1` (lowercase, `[a-z0-9-]`, collapse repeats,
  strip leading/trailing hyphen), `encode_label/1`.

**`SymphonyElixirWeb.PublicHostPlug`** — a Plug placed in `Endpoint` before
`Router`:
- Reads `conn.host`.
- If tunnel disabled, or host is loopback (`127.0.0.1`, `localhost`, `::1`), or
  host == `PublicRouting.tracker_host/0` → `conn` unchanged (falls through to the
  Router / normal app).
- Else if the host ends with `PublicRouting.namespace_suffix/0` **and**
  `PublicRouting.lookup(host)` → `{:ok, port}` **and** the port is within
  `Config.dev_server_port_range/0` → delegate to `ReverseProxyPlug` with upstream
  `http://127.0.0.1:#{port}` (WebSocket upgrade enabled), then `halt`.
- Else → `send_resp(conn, 404, ...) |> halt()`.

**`SymphonyElixir.DevServer.Instance`** — on the transition **into** `:ready`,
call `PublicRouting.host_for/3` and `PublicRouting.register/2` (best-effort: a
namespace/registration failure logs a warning and falls back to the loopback
URL, never crashing the instance). On `terminate/2` (stop/crash) and on
`mark_stopped`/`mark_crashed`, call `PublicRouting.unregister/1`. `build_url/3`
gains an optional public host: when the tunnel is enabled and a host was
resolved, the persisted/returned URL is `https://{host}{url_path}`.

**`SymphonyElixir` app supervision tree** — start `PublicRouting` unconditionally
(cheap ETS owner; it just no-ops when the feature is disabled), so registrations
during boot reconciliation have somewhere to land.

### 5.2 Tunnel tooling (ported from DM)

**One-time operator setup (manual, documented):**
1. Create/authenticate the named tunnel (`cloudflared tunnel login`, then
   `cloudflared tunnel create cods-dev-tunnel`); record `CLOUDFLARE_TUNNEL_ID`.
2. In the Cloudflare dashboard, enable **Advanced Certificate Manager** and order
   a wildcard certificate covering `{namespace}.tracker.cods.dev` and
   `*.{namespace}.tracker.cods.dev`.

**`elixir/scripts/public-tunnel.sh`** — Symphony equivalent of the DM
`scripts/public-dev.sh`, scaled down (the app already runs on `:4000`; this only
manages the tunnel):
1. Verify `cloudflared` on `PATH` (clear error if missing, like DM).
2. Read `.env` for `CLOUDFLARED_TUNNEL_NAME`, `CLOUDFLARE_*`, `PUBLIC_NAMESPACE`,
   `PUBLIC_TUNNEL_ROUTE_DNS`.
3. Write a static config to `/tmp/symphony-cods-dev-tunnel.yml`:

   ```yaml
   tunnel: ${CLOUDFLARED_TUNNEL_NAME}
   ingress:
     - hostname: "*.tracker.cods.dev"
       service: http://127.0.0.1:4000
     - service: http_status:404
   ```

4. If `PUBLIC_TUNNEL_ROUTE_DNS=true`, ensure the CNAMEs via the Mix task below.
5. `exec cloudflared tunnel --config <config> run ${CLOUDFLARED_TUNNEL_NAME}`.

**`mix symphony.tunnel.dns`** — Elixir port of DM's `cloudflare_dns.py`
(`CloudflareDnsClient` + `build_*_cname_records`). A `SymphonyElixir.Cloudflare.Dns`
module with an injectable transport (for tests) ensures, idempotently
(create-or-update), the two CNAME records for the resolved namespace:
- `{namespace}.tracker.cods.dev` → `<tunnel-id>.cfargotunnel.com`
- `*.{namespace}.tracker.cods.dev` → `<tunnel-id>.cfargotunnel.com`

reading `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`/`CLOUDFLARE_ZONE_NAME`
(`cods.dev`), `CLOUDFLARE_TUNNEL_ID` from `.env`. Same record shape DM uses
(`type: CNAME, proxied: true`). It does **not** order the ACM certificate.

**Make targets** (mirror DM ergonomics, added to `elixir/Makefile`):
`tunnel` (foreground), `tunnel-bg`, `tunnel-logs`, `tunnel-status`,
`tunnel-stop`, and `tunnel-dns` (runs `mix symphony.tunnel.dns`).

### 5.3 `.env` additions (ported from DM, no `SYMPHONY_` prefix)

```bash
CLOUDFLARED_TUNNEL_NAME=cods-dev-tunnel
CLOUDFLARE_TUNNEL_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_ZONE_NAME=cods.dev
PUBLIC_NAMESPACE=              # optional; defaults to the GitHub login
PUBLIC_TUNNEL_ROUTE_DNS=false
```

### 5.4 `WORKFLOW.md` block

```yaml
public_tunnel:
  enabled: true
  base_domain: tracker.cods.dev
  # namespace: raphaelcangucu   # optional override; defaults to GitHub login
```

## 6. Data flow

1. **One-time** → operator creates the tunnel, enables ACM, and orders the
   `*.{namespace}.tracker.cods.dev` wildcard certificate.
2. **Boot** → supervisor starts `PublicRouting` (ETS owner). If `public_tunnel`
   is disabled, all lookups miss and the plug always falls through.
3. **Operator runs `make tunnel-dns` once** (or sets `PUBLIC_TUNNEL_ROUTE_DNS=true`)
   → the apex + wildcard CNAMEs for the namespace are ensured via the Cloudflare
   API.
4. **Operator runs `make tunnel`** → `cloudflared` connects with the static
   `*.tracker.cods.dev` → `:4000` ingress.
5. **Dev server becomes `:ready`** → `Instance` resolves the host
   (`PublicRouting.host_for/3`), registers `host → port`, and builds the public
   URL → persisted in `local_tracker_dev_servers` → surfaced in the Preview tab /
   Summary chip.
6. **Teammate opens `https://previsions-mm-42-front.raphaelcangucu.tracker.cods.dev/`**
   → Cloudflare → tunnel → `:4000` → `PublicHostPlug` → `lookup` hit →
   `ReverseProxyPlug` → `127.0.0.1:4123` (HTTP + WS).
7. **Dev server stops/crashes** → `unregister(host)` → subsequent requests to
   that host return 404.

## 7. Error handling & edge cases (explicit)

| Case | Behavior |
|---|---|
| `public_tunnel.enabled` false | `build_url` returns loopback URL (today's behavior); plug always passes through. |
| No GitHub token and no `PUBLIC_NAMESPACE` | `resolve_namespace/0` → `{:error, :no_namespace}`; registration skipped, loopback URL used, warning logged. |
| Host unknown / not registered | Plug returns 404 (no port leakage). |
| Host outside the namespace suffix | Plug passes through (not ours) — never proxies arbitrary hosts. |
| Registered port outside `port_range` | Plug refuses (404) — defense in depth against a stale/forged mapping. |
| `cloudflared` not installed | `make tunnel` exits with a clear message (mirrors DM). |
| CNAMEs missing | Cloudflare returns 1033/Argo error; troubleshooting doc says run `make tunnel-dns` (or set `PUBLIC_TUNNEL_ROUTE_DNS=true`). |
| ACM certificate missing/not active | Browser shows a TLS error for nested hosts; troubleshooting doc points to the ACM order step. |
| Encoded label > 63 chars | Deterministically shortened with a hash suffix (D11); mapping still exact-match by the resulting host. |
| Loopback / direct `:4000` access | Plug passes through; local dev is unaffected. |
| WebSocket upgrade (HMR) | `reverse_proxy_plug` forwards the upgrade to the dev server. |
| Two serve steps, same issue | Distinct hosts via distinct `step.slug` (`front`/`back`), already deduplicated by `unique_serve_steps/3`. |

## 8. Testing

- **Config** (`config_test.exs`): defaults when `public_tunnel:` omitted; reads
  `enabled`/`base_domain`/`namespace`; accessor `@spec`s.
- **`PublicRouting`**: register/unregister/lookup round-trips; `sanitize_label/1`
  edge cases (uppercase, spaces, leading/trailing hyphen, unicode); `host_for/3`
  format and the 63-char guard; `tracker_host/0` and `namespace_suffix/0`;
  `resolve_namespace/0` with override, with a stubbed `Viewer`, and the
  no-namespace error.
- **`PublicHostPlug`** (`ConnCase`): tracker host passes through; loopback passes
  through; host outside the namespace suffix passes through; known preview host
  proxies to the right upstream; unknown in-suffix host → 404; port-out-of-range
  → 404; disabled tunnel → pass through.
- **`build_url`**: loopback when disabled; `https://{host}{url_path}` when enabled
  with a resolved host; `url_path` normalization preserved.
- **`Instance`** integration: `:ready` registers and persists the public URL;
  stop/crash unregisters; namespace failure falls back without crashing.
- **Script smoke test** (mirror DM's `tests/scripts/test_public_dev_script.py`):
  assert `public-tunnel.sh` writes the `*.tracker.cods.dev` ingress and runs the
  named tunnel.
- **`SymphonyElixir.Cloudflare.Dns`** (mirror DM's `test_cloudflare_dns.py`):
  inject a fake transport; assert the apex + wildcard CNAME create/update payload
  (`type: CNAME`, `content: <tunnel-id>.cfargotunnel.com`, `proxied: true`),
  zone-id resolution, and idempotent update of an existing record.

## 9. Docs to update (same change)

- `elixir/README.md` — public tunnel feature, one-time ACM/tunnel setup,
  `make tunnel*` usage, the host-naming scheme.
- `WORKFLOW.md` (+ `WORKFLOW.*.example.md`) — the `public_tunnel:` block.
- `.env.example` (if present) / README env section — the Cloudflare keys.
- `elixir/docs/troubleshooting.md` — `cloudflared` missing, DNS/1033, ACM
  certificate missing/inactive (TLS errors on nested hosts), port-in-use.
- Follow-up notes in `2026-05-30-issue-dev-server-preview-design.md` and
  `2026-05-29-browser-vscode-task-workspace-design.md` recording that D12
  supersedes their "no proxy through `:4000`" non-goal.
- Security note: previews are unauthenticated once exposed; anyone with the URL
  reaches the dev server.

## 10. Resolved questions

- **Q1 — Host scheme → nested per-namespace, ACM-backed.** Hosts are
  `<preview>.<namespace>.tracker.cods.dev` (tracker at
  `<namespace>.tracker.cods.dev`), covered by a paid Cloudflare Advanced
  Certificate Manager wildcard `*.<namespace>.tracker.cods.dev`. The project is
  folded into the single preview label so one wildcard certificate per operator
  suffices.
- **Q2 — DNS automation → ported Mix task.** DM's `cloudflare_dns.py` is ported
  to `SymphonyElixir.Cloudflare.Dns` + the `mix symphony.tunnel.dns` task, wired
  into `elixir/Makefile` as `tunnel-dns`. It ensures the apex + wildcard CNAMEs;
  the ACM certificate is ordered manually once per operator.
