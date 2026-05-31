# Public Preview Tunnel (cods.dev) Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. This repo is **Elixir** (`elixir/` dir): test runner is `mix test`, deps via `mix deps.get`, quality gate `make all` (run from `elixir/`). Public `def` in `lib/` need an adjacent `@spec` (`mix specs.check`). Use the existing module/style patterns under `lib/symphony_elixir/*`.

**Goal:** Expose the Symphony tracker and each ready per-issue/per-step dev server publicly over one Cloudflare Tunnel, with the Phoenix `:4000` hub reverse-proxying nested hosts `<preview>.<namespace>.tracker.cods.dev` to the dev server's loopback port.

**Architecture:** A `PublicHostPlug` runs in the `Endpoint` before the `Router`. It reads `conn.host`; loopback and the tracker host fall through to the app, known preview hosts are reverse-proxied to `127.0.0.1:<port>` (HTTP via `reverse_proxy_plug`, WS upgrades via `reverse_proxy_plug_websocket`), everything else 404s. A `PublicRouting` GenServer owns an ETS `host → port` table plus host encode/namespace logic; `DevServer.Instance` registers on `:ready` and unregisters on stop/crash. A static `cloudflared` ingress `*.tracker.cods.dev → :4000` plus a `mix symphony.tunnel.dns` task (ported from the Distribution Machine `cloudflare_dns.py`) provide the public edge; a wildcard ACM cert is an operator setup step.

**Tech Stack:** Elixir 1.19/OTP 28, Phoenix 1.8, Bandit, Plug, Ecto/SQLite, `reverse_proxy_plug` + `reverse_proxy_plug_websocket`, `req` (already present), `cloudflared` (external), Cloudflare API.

**Spec:** `docs/superpowers/specs/2026-05-31-public-preview-tunnel-design.md`

**Naming reference (used throughout):**
- base_domain default: `tracker.cods.dev`
- namespace: sanitized GitHub login (e.g. `raphaelcangucu`), override via `PUBLIC_NAMESPACE`
- tracker host: `<namespace>.tracker.cods.dev`
- preview host: `<project>-<issue>-<step>.<namespace>.tracker.cods.dev`
- namespace suffix (plug scope test): `.<namespace>.tracker.cods.dev`

---

## File Structure

**Create:**
- `elixir/lib/symphony_elixir/public_routing.ex` — GenServer + ETS host→port registry, namespace resolution, host encode helpers.
- `elixir/lib/symphony_elixir_web/plugs/public_host_plug.ex` — host-based router/proxy plug.
- `elixir/lib/symphony_elixir/cloudflare/dns.ex` — Cloudflare DNS API client (port of DM `cloudflare_dns.py`).
- `elixir/lib/mix/tasks/symphony.tunnel.dns.ex` — Mix task wrapping `Cloudflare.Dns`.
- `elixir/scripts/public-tunnel.sh` — generates ingress config + runs the named tunnel.
- `elixir/test/symphony_elixir/public_routing_test.exs`
- `elixir/test/symphony_elixir_web/plugs/public_host_plug_test.exs`
- `elixir/test/symphony_elixir/cloudflare/dns_test.exs`
- `elixir/test/scripts/public_tunnel_script_test.exs`

**Modify:**
- `elixir/mix.exs:122-139` — add `reverse_proxy_plug`, `reverse_proxy_plug_websocket` deps.
- `elixir/lib/symphony_elixir/config.ex` — module-attr defaults (~26-36), `public_tunnel:` schema block (after `dev_server:` ~198), `extract_workflow_options/1` (~656-668), new `extract_public_tunnel_options/1` (near ~751-759), accessors (after `dev_server_base_url/0` ~567).
- `elixir/lib/symphony_elixir.ex:28-58` — add `SymphonyElixir.PublicRouting` to the supervision tree.
- `elixir/lib/symphony_elixir_web/endpoint.ex:35-36` — insert `PublicHostPlug` before `Router`.
- `elixir/lib/symphony_elixir/dev_server/instance.ex` — compute `public_host` in `initial_state/1` (~141-167); register on `:ready` (`probe_starting/2` ~234-242); unregister in `mark_crashed/1` (~410) and `mark_stopped/1` (~418); use `public_host` in `build_url/3` (~363-371).
- `elixir/Makefile` — add `tunnel`, `tunnel-bg`, `tunnel-logs`, `tunnel-status`, `tunnel-stop`, `tunnel-dns` targets.
- `elixir/mix.exs:14-98` — add new modules to `test_coverage.ignore_modules` only where they cannot reach 100% (the Mix task and script-only modules); keep tested modules out of the ignore list.
- `elixir/README.md`, `elixir/WORKFLOW.md` (+ `WORKFLOW.*.example.md`), `elixir/docs/troubleshooting.md` — docs.

**Delete:** none.

---

## Task 1: Add proxy dependencies

**Files:**
- Modify: `elixir/mix.exs:122-139`

- [ ] **Step 1: Add the deps**

In `defp deps do` add (after the `{:req, "~> 0.5"},` line):

```elixir
{:reverse_proxy_plug, "~> 3.0"},
{:reverse_proxy_plug_websocket, "~> 0.2"},
{:websockex, "~> 0.4.3"},
```

> `:websockex` is required: `reverse_proxy_plug_websocket` 0.2.0 unconditionally
> macro-expands `use WebSockex` in its WebSockex adapter (the `Code.ensure_loaded?`
> guard is ineffective for a compile-time macro), so the library does not compile
> unless `:websockex` is present. WebSockex is a pure-Elixir WS client (no native
> deps); the library auto-selects it when `:gun` is absent.

- [ ] **Step 2: Fetch deps**

Run (from `elixir/`): `mix deps.get`
Expected: resolves and downloads `reverse_proxy_plug` 3.x and `reverse_proxy_plug_websocket` 0.2.x (and transitive HTTP/WS client deps) with exit code 0.

- [ ] **Step 3: Compile to confirm no conflicts**

Run (from `elixir/`): `mix compile`
Expected: compiles with exit code 0 (warnings ok).

- [ ] **Step 4: Commit**

```bash
git add elixir/mix.exs elixir/mix.lock
git commit -m "build: add reverse_proxy_plug + websockex deps for public preview tunnel"
```

---

## Task 2: Config — `public_tunnel:` schema and accessors

**Files:**
- Modify: `elixir/lib/symphony_elixir/config.ex`
- Test: `elixir/test/symphony_elixir/config_test.exs`

- [ ] **Step 1: Write failing tests**

Add to `elixir/test/symphony_elixir/config_test.exs` (follow the existing `editor_base_url` test style — use the same workflow-writing helper the file already uses; below assumes the existing `write_workflow!/1`-style helper used elsewhere in that file):

```elixir
describe "public_tunnel config" do
  test "defaults when public_tunnel section omitted" do
    refute SymphonyElixir.Config.public_tunnel_enabled?()
    assert SymphonyElixir.Config.public_tunnel_base_domain() == "tracker.cods.dev"
    assert SymphonyElixir.Config.public_tunnel_namespace() == nil
  end

  test "reads configured public_tunnel keys" do
    write_workflow!("""
    public_tunnel:
      enabled: true
      base_domain: tracker.example.dev
      namespace: octocat
    """)

    assert SymphonyElixir.Config.public_tunnel_enabled?()
    assert SymphonyElixir.Config.public_tunnel_base_domain() == "tracker.example.dev"
    assert SymphonyElixir.Config.public_tunnel_namespace() == "octocat"
  end
end
```

> Note: open `config_test.exs` first and mirror its exact setup (how it writes/loads `WORKFLOW.md` and resets config cache). Use that helper name, not a placeholder.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `elixir/`): `mix test test/symphony_elixir/config_test.exs -k public_tunnel`
Expected: FAIL — `public_tunnel_enabled?/0` undefined.

- [ ] **Step 3: Add default module attributes**

In `config.ex` near the other defaults (after line 35 `@default_dev_server_auto_start_on ...`):

```elixir
@default_public_tunnel_enabled false
@default_public_tunnel_base_domain "tracker.cods.dev"
```

- [ ] **Step 4: Add the schema block**

In `@workflow_options_schema`, immediately after the `dev_server:` block (closes ~line 198, before the final `)`):

```elixir
public_tunnel: [
  type: :map,
  default: %{},
  keys: [
    enabled: [type: :boolean, default: @default_public_tunnel_enabled],
    base_domain: [type: :string, default: @default_public_tunnel_base_domain],
    namespace: [type: {:or, [:string, nil]}, default: nil]
  ]
]
```

- [ ] **Step 5: Wire extraction**

In `extract_workflow_options/1` (map literal ~656-668) add the key:

```elixir
public_tunnel: extract_public_tunnel_options(section_map(config, "public_tunnel"))
```

And add the extractor next to `extract_dev_server_options/1` (~759):

```elixir
defp extract_public_tunnel_options(section) do
  %{}
  |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
  |> put_if_present(:base_domain, scalar_string_value(Map.get(section, "base_domain")))
  |> put_if_present(:namespace, scalar_string_value(Map.get(section, "namespace")))
end
```

- [ ] **Step 6: Add accessors**

After `dev_server_base_url/0` (~567):

```elixir
@spec public_tunnel_enabled?() :: boolean()
def public_tunnel_enabled? do
  get_in(validated_workflow_options(), [:public_tunnel, :enabled])
end

@spec public_tunnel_base_domain() :: String.t()
def public_tunnel_base_domain do
  get_in(validated_workflow_options(), [:public_tunnel, :base_domain])
end

@spec public_tunnel_namespace() :: String.t() | nil
def public_tunnel_namespace do
  get_in(validated_workflow_options(), [:public_tunnel, :namespace])
end
```

- [ ] **Step 7: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir/config_test.exs -k public_tunnel`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/config.ex elixir/test/symphony_elixir/config_test.exs
git commit -m "feat(config): add public_tunnel WORKFLOW block and accessors"
```

---

## Task 3: `PublicRouting` — namespace resolution and host encoding (pure helpers)

**Files:**
- Create: `elixir/lib/symphony_elixir/public_routing.ex`
- Test: `elixir/test/symphony_elixir/public_routing_test.exs`

This task builds the **pure** parts (sanitize/encode/host_for/tracker_host/namespace_suffix) and `resolve_namespace/0`. The ETS/GenServer parts come in Task 4.

- [ ] **Step 1: Write failing tests**

Create `elixir/test/symphony_elixir/public_routing_test.exs`:

```elixir
defmodule SymphonyElixir.PublicRoutingTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PublicRouting

  describe "sanitize_label/1" do
    test "lowercases and replaces invalid chars with hyphen" do
      assert PublicRouting.sanitize_label("MM 42/Front") == "mm-42-front"
    end

    test "collapses repeats and strips leading/trailing hyphens" do
      assert PublicRouting.sanitize_label("--a__b--") == "a-b"
    end
  end

  describe "host_for/4" do
    test "builds <project>-<issue>-<step>.<ns>.<base>" do
      assert PublicRouting.host_for("previsions", "mm-42", "front", namespace: "octocat", base_domain: "tracker.cods.dev") ==
               {:ok, "previsions-mm-42-front.octocat.tracker.cods.dev"}
    end

    test "shortens label over 63 chars with a hash suffix" do
      long = String.duplicate("x", 80)
      {:ok, host} = PublicRouting.host_for(long, "mm-42", "front", namespace: "octocat", base_domain: "tracker.cods.dev")
      [label | _] = String.split(host, ".")
      assert String.length(label) <= 63
      assert String.ends_with?(host, ".octocat.tracker.cods.dev")
    end
  end

  describe "tracker_host/1 and namespace_suffix/1" do
    test "tracker host is <ns>.<base>" do
      assert PublicRouting.tracker_host(namespace: "octocat", base_domain: "tracker.cods.dev") ==
               "octocat.tracker.cods.dev"
    end

    test "namespace suffix has a leading dot" do
      assert PublicRouting.namespace_suffix(namespace: "octocat", base_domain: "tracker.cods.dev") ==
               ".octocat.tracker.cods.dev"
    end
  end

  describe "resolve_namespace/1" do
    test "uses the configured namespace override when present" do
      # load a WORKFLOW with public_tunnel.namespace set, mirroring the
      # config_test.exs front-matter helper (load_workflow_with_front_matter/1).
      load_public_tunnel_workflow!(namespace: "Team-Cods")
      assert PublicRouting.resolve_namespace() == {:ok, "team-cods"}
    end

    test "falls back to the injected viewer login when no override" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:ok, %{login: "Octo-Cat"}} end
      assert PublicRouting.resolve_namespace(viewer: viewer) == {:ok, "octo-cat"}
    end

    test "returns :no_namespace when override absent and viewer fails" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:error, :missing_github_token} end
      assert PublicRouting.resolve_namespace(viewer: viewer) == {:error, :no_namespace}
    end
  end

  describe "host_for/4 namespace fallback" do
    test "resolves the namespace via opts viewer when not passed explicitly" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:ok, %{login: "octocat"}} end

      assert PublicRouting.host_for("previsions", "#mm-42", "front",
               base_domain: "tracker.cods.dev",
               viewer: viewer
             ) == {:ok, "previsions-mm-42-front.octocat.tracker.cods.dev"}
    end

    test "propagates :no_namespace error" do
      load_public_tunnel_workflow!(namespace: nil)
      viewer = fn -> {:error, :x} end

      assert PublicRouting.host_for("p", "i", "s", base_domain: "tracker.cods.dev", viewer: viewer) ==
               {:error, :no_namespace}
    end
  end
end
```

> The functions take an explicit `opts` keyword (`namespace:`, `base_domain:`, and `viewer:` for injecting `Viewer.current/0` in tests) so they are unit-testable without config/network. When opts omit them they fall back to `Config` / `Viewer`. `start_link/1` and `init/1` are exercised by Task 4's `start_supervised!` tests (so the 100% coverage gate holds across the suite). Implement `load_public_tunnel_workflow!/1` in this test by mirroring `config_test.exs`'s `load_workflow_with_front_matter/1` helper: when `namespace:` is nil, write a `public_tunnel:` block without a `namespace:` key (and `enabled: true`); when set, include `namespace: <value>`.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `elixir/`): `mix test test/symphony_elixir/public_routing_test.exs`
Expected: FAIL — module/functions undefined.

- [ ] **Step 3: Implement the pure helpers**

Create `elixir/lib/symphony_elixir/public_routing.ex` (GenServer scaffold + pure functions; ETS logic filled in Task 4):

```elixir
defmodule SymphonyElixir.PublicRouting do
  @moduledoc """
  Maps public preview hostnames to local dev-server ports and builds the
  per-namespace hostnames used by the public tunnel.
  """

  use GenServer

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Viewer

  @table __MODULE__
  @max_label_len 63

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @spec sanitize_label(String.t()) :: String.t()
  def sanitize_label(value) when is_binary(value) do
    value
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/u, "-")
    |> String.replace(~r/-+/, "-")
    |> String.trim("-")
  end

  @spec host_for(String.t(), String.t(), String.t(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def host_for(project_slug, identifier, step_slug, opts) do
    with {:ok, namespace} <- fetch_namespace(opts),
         base_domain <- fetch_base_domain(opts) do
      label =
        [project_slug, strip_hash(identifier), step_slug]
        |> Enum.map(&sanitize_label/1)
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("-")
        |> enforce_label_limit()

      {:ok, "#{label}.#{namespace}.#{base_domain}"}
    end
  end

  @spec tracker_host(keyword()) :: String.t()
  def tracker_host(opts) do
    {:ok, namespace} = fetch_namespace(opts)
    "#{namespace}.#{fetch_base_domain(opts)}"
  end

  @spec namespace_suffix(keyword()) :: String.t()
  def namespace_suffix(opts) do
    {:ok, namespace} = fetch_namespace(opts)
    ".#{namespace}.#{fetch_base_domain(opts)}"
  end

  @spec resolve_namespace(keyword()) :: {:ok, String.t()} | {:error, :no_namespace}
  def resolve_namespace(opts \\ []) do
    case Config.public_tunnel_namespace() do
      ns when is_binary(ns) and ns != "" ->
        {:ok, sanitize_label(ns)}

      _ ->
        viewer = Keyword.get(opts, :viewer, &Viewer.current/0)

        case viewer.() do
          {:ok, %{login: login}} when is_binary(login) and login != "" ->
            {:ok, sanitize_label(login)}

          _ ->
            {:error, :no_namespace}
        end
    end
  end

  defp fetch_namespace(opts) do
    case Keyword.get(opts, :namespace) do
      ns when is_binary(ns) and ns != "" -> {:ok, sanitize_label(ns)}
      _ -> resolve_namespace(opts)
    end
  end

  defp fetch_base_domain(opts) do
    Keyword.get(opts, :base_domain) || Config.public_tunnel_base_domain()
  end

  defp strip_hash(identifier) when is_binary(identifier), do: String.trim_leading(identifier, "#")

  defp enforce_label_limit(label) when byte_size(label) <= @max_label_len, do: label

  defp enforce_label_limit(label) do
    hash = label |> :erlang.md5() |> Base.encode16(case: :lower) |> binary_part(0, 8)
    keep = @max_label_len - byte_size(hash) - 1
    "#{binary_part(label, 0, keep)}-#{hash}"
  end

  # GenServer scaffold (ETS logic added in Task 4).
  @impl true
  def init(_opts) do
    table = :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    {:ok, %{table: table}}
  end
end
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir/public_routing_test.exs`
Expected: PASS (all `sanitize_label`, `host_for`, `tracker_host`, `namespace_suffix` cases).

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/public_routing.ex elixir/test/symphony_elixir/public_routing_test.exs
git commit -m "feat(public-routing): host encoding and namespace resolution"
```

---

## Task 4: `PublicRouting` — ETS register/unregister/lookup + supervision

**Files:**
- Modify: `elixir/lib/symphony_elixir/public_routing.ex`
- Modify: `elixir/lib/symphony_elixir.ex:28-58`
- Test: `elixir/test/symphony_elixir/public_routing_test.exs`

- [ ] **Step 1: Write failing tests**

Append to `public_routing_test.exs`:

```elixir
describe "register/unregister/lookup" do
  setup do
    start_supervised!(SymphonyElixir.PublicRouting)
    :ok
  end

  test "register then lookup returns the port" do
    assert :ok = PublicRouting.register("mm-42-front.octocat.tracker.cods.dev", 4123)
    assert {:ok, 4123} = PublicRouting.lookup("mm-42-front.octocat.tracker.cods.dev")
  end

  test "unregister removes the mapping" do
    PublicRouting.register("a.octocat.tracker.cods.dev", 4101)
    assert :ok = PublicRouting.unregister("a.octocat.tracker.cods.dev")
    assert :error = PublicRouting.lookup("a.octocat.tracker.cods.dev")
  end

  test "lookup of unknown host returns :error" do
    assert :error = PublicRouting.lookup("nope.octocat.tracker.cods.dev")
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `elixir/`): `mix test test/symphony_elixir/public_routing_test.exs -k "register"`
Expected: FAIL — `register/2` undefined.

- [ ] **Step 3: Implement ETS API**

Add to `public_routing.ex` (public API + casts; the table is created in `init/1` from Task 3):

```elixir
@spec register(String.t(), pos_integer()) :: :ok
def register(host, port) when is_binary(host) and is_integer(port) do
  GenServer.call(__MODULE__, {:register, host, port})
end

@spec unregister(String.t()) :: :ok
def unregister(host) when is_binary(host) do
  GenServer.call(__MODULE__, {:unregister, host})
end

@spec lookup(String.t()) :: {:ok, pos_integer()} | :error
def lookup(host) when is_binary(host) do
  case :ets.lookup(@table, host) do
    [{^host, port}] -> {:ok, port}
    _ -> :error
  end
end

@impl true
def handle_call({:register, host, port}, _from, state) do
  :ets.insert(state.table, {host, port})
  {:reply, :ok, state}
end

def handle_call({:unregister, host}, _from, state) do
  :ets.delete(state.table, host)
  {:reply, :ok, state}
end
```

- [ ] **Step 4: Add to supervision tree**

In `elixir/lib/symphony_elixir.ex`, add `SymphonyElixir.PublicRouting` to `base_children` (after `SymphonyElixir.DevServer.Reconciler` on line 54):

```elixir
SymphonyElixir.DevServer.Reconciler,
SymphonyElixir.PublicRouting,
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir/public_routing_test.exs`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/public_routing.ex elixir/lib/symphony_elixir.ex elixir/test/symphony_elixir/public_routing_test.exs
git commit -m "feat(public-routing): ETS host registry and supervision"
```

---

## Task 5: `PublicHostPlug` — host-based routing/proxy

**Files:**
- Create: `elixir/lib/symphony_elixir_web/plugs/public_host_plug.ex`
- Modify: `elixir/lib/symphony_elixir_web/endpoint.ex:35-36`
- Test: `elixir/test/symphony_elixir_web/plugs/public_host_plug_test.exs`

- [ ] **Step 1: Write failing tests**

Create `elixir/test/symphony_elixir_web/plugs/public_host_plug_test.exs`:

```elixir
defmodule SymphonyElixirWeb.PublicHostPlugTest do
  use SymphonyElixirWeb.ConnCase, async: false

  alias SymphonyElixir.PublicRouting
  alias SymphonyElixirWeb.PublicHostPlug

  defp call(host) do
    :get
    |> build_conn("/")
    |> Map.put(:host, host)
    |> PublicHostPlug.call(PublicHostPlug.init([]))
  end

  describe "with tunnel disabled (default WORKFLOW)" do
    test "loopback passes through (not halted)" do
      conn = call("127.0.0.1")
      refute conn.halted
    end

    test "any other host passes through when disabled" do
      conn = call("anything.octocat.tracker.cods.dev")
      refute conn.halted
    end
  end

  describe "with tunnel enabled" do
    setup do
      # enable public_tunnel with a fixed namespace via the test WORKFLOW helper
      enable_public_tunnel!(namespace: "octocat", base_domain: "tracker.cods.dev")
      start_supervised!(PublicRouting)
      :ok
    end

    test "tracker host passes through" do
      conn = call("octocat.tracker.cods.dev")
      refute conn.halted
    end

    test "loopback passes through" do
      conn = call("localhost")
      refute conn.halted
    end

    test "host outside namespace suffix passes through" do
      conn = call("evil.example.com")
      refute conn.halted
    end

    test "unknown in-suffix host returns 404" do
      conn = call("ghost.octocat.tracker.cods.dev")
      assert conn.halted
      assert conn.status == 404
    end

    test "registered preview host with out-of-range port returns 404" do
      PublicRouting.register("bad.octocat.tracker.cods.dev", 9999)
      conn = call("bad.octocat.tracker.cods.dev")
      assert conn.halted
      assert conn.status == 404
    end
  end
end
```

> Implement an `enable_public_tunnel!/1` helper in `ConnCase` (or inline using the same WORKFLOW-writing approach the repo's web tests already use). The "successful proxy" path (registered + in-range port) is covered by the `Instance` integration test in Task 6 against a real local listener; here we assert the guard branches that do not require a live upstream.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `elixir/`): `mix test test/symphony_elixir_web/plugs/public_host_plug_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement the plug**

Create `elixir/lib/symphony_elixir_web/plugs/public_host_plug.ex`:

```elixir
defmodule SymphonyElixirWeb.PublicHostPlug do
  @moduledoc """
  Routes incoming requests by `Host`: preview hosts under the configured
  namespace are reverse-proxied to the matching dev-server loopback port;
  the tracker host and loopback fall through to the app; anything else under
  the namespace that is unknown returns 404.
  """

  @behaviour Plug

  import Plug.Conn

  require Logger

  alias SymphonyElixir.Config
  alias SymphonyElixir.PublicRouting

  @loopback_hosts ~w(127.0.0.1 localhost ::1)

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    if tunnel_enabled?() do
      route(conn, conn.host)
    else
      conn
    end
  end

  defp route(conn, host) when host in @loopback_hosts, do: conn

  defp route(conn, host) do
    case PublicRouting.resolve_namespace() do
      {:ok, namespace} -> route_in_namespace(conn, host, namespace)
      {:error, :no_namespace} -> conn
    end
  end

  defp route_in_namespace(conn, host, namespace) do
    opts = [namespace: namespace, base_domain: Config.public_tunnel_base_domain()]

    cond do
      host == PublicRouting.tracker_host(opts) ->
        conn

      not String.ends_with?(host, PublicRouting.namespace_suffix(opts)) ->
        conn

      true ->
        proxy_or_404(conn, host)
    end
  end

  defp proxy_or_404(conn, host) do
    with {:ok, port} <- PublicRouting.lookup(host),
         true <- port_in_range?(port) do
      proxy(conn, port)
    else
      _ -> conn |> send_resp(404, "Unknown preview host") |> halt()
    end
  end

  defp proxy(conn, port) do
    if websocket_upgrade?(conn) do
      ReverseProxyPlugWebsocket.call(
        conn,
        ReverseProxyPlugWebsocket.init(
          upstream_uri: "ws://127.0.0.1:#{port}#{conn.request_path}",
          path: conn.request_path
        )
      )
    else
      conn
      |> ReverseProxyPlug.call(
        ReverseProxyPlug.init(upstream: "http://127.0.0.1:#{port}")
      )
      |> halt()
    end
  end

  defp websocket_upgrade?(conn) do
    conn
    |> get_req_header("upgrade")
    |> Enum.any?(&(String.downcase(&1) == "websocket"))
  end

  defp port_in_range?(port) do
    case Config.dev_server_port_range() do
      [low, high] when is_integer(low) and is_integer(high) -> port >= low and port <= high
      _ -> false
    end
  end

  defp tunnel_enabled? do
    Config.public_tunnel_enabled?()
  rescue
    _ -> false
  end
end
```

> Verify the `reverse_proxy_plug_websocket` `init/call` arity/keys against the installed version's docs while wiring Step 3; adjust the `proxy/2` WS branch to match (the HTTP branch uses `ReverseProxyPlug` `upstream:`). Keep behavior identical: WS upgrade → WS plug, else HTTP plug, both halting.

- [ ] **Step 3b: Exempt the plug from the 100% coverage gate**

The proxy/WS branches of `proxy/2` reverse-proxy to a live loopback upstream and cannot be deterministically unit-tested without a real listener (consistent with the repo already ignoring `SymphonyElixirWeb.Endpoint`, `Router`, and the proxying controllers). Add the module to `test_coverage.ignore_modules` in `elixir/mix.exs`, with a comment, near the other `SymphonyElixirWeb.*` entries:

```elixir
# Reverse-proxies to live loopback upstream + WS upgrade; guard branches
# are covered by plug tests, proxy path by Task 6 integration.
SymphonyElixirWeb.PublicHostPlug,
```

The guard-branch tests in Step 1 remain as regression tests regardless of the coverage exemption.

- [ ] **Step 4: Insert into the Endpoint**

In `elixir/lib/symphony_elixir_web/endpoint.ex`, add the plug immediately before `plug(SymphonyElixirWeb.Router)` (line 36):

```elixir
plug(SymphonyElixirWeb.PublicHostPlug)
plug(SymphonyElixirWeb.Router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir_web/plugs/public_host_plug_test.exs`
Expected: PASS (guard branches).

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir_web/plugs/public_host_plug.ex elixir/lib/symphony_elixir_web/endpoint.ex elixir/test/symphony_elixir_web/plugs/public_host_plug_test.exs
git commit -m "feat(web): host-based public preview proxy plug"
```

---

## Task 6: `DevServer.Instance` — register/unregister + public URL

> **Coverage note:** `DevServer.Instance` is NOT in `ignore_modules`, so it is held to
> 100% line coverage. To avoid uncoverable branches, the "is the tunnel on + did host
> resolution succeed" decision lives in a new pure-ish `PublicRouting.preview_host/4`
> (fully unit-tested with the injected `viewer:` opt), and the Instance helpers do NOT
> use `rescue`. Instance just stores the resolved `public_host` (a string or nil) and
> branches on `is_binary/1`, both arms of which are exercised by existing (tunnel-off →
> nil) and new (tunnel-on → host) tests.

**Files:**
- Modify: `elixir/lib/symphony_elixir/public_routing.ex` (+ `preview_host/4`)
- Modify: `elixir/lib/symphony_elixir/dev_server/instance.ex`
- Test: `elixir/test/symphony_elixir/public_routing_test.exs` (+ `preview_host/4` cases)
- Test: `elixir/test/symphony_elixir/dev_server/instance_test.exs` (existing file; mirror its setup)

- [ ] **Step 1: Write failing tests**

Open the existing `instance_test.exs` and mirror how it starts an `Instance` with injected `tmux`/`command_sender`/`probe`. Add a test that, with `public_tunnel` enabled and `PublicRouting` started, a transition to `:ready` registers a host whose lookup returns the instance's port, and stop unregisters it:

```elixir
test "registers public host on ready and unregisters on stop" do
  enable_public_tunnel!(namespace: "octocat", base_domain: "tracker.cods.dev")
  start_supervised!(SymphonyElixir.PublicRouting)

  # Start an instance with a probe stub that immediately reports :ok,
  # a fixed port allocator (e.g. 4123), and no-op tmux/command_sender —
  # mirror the existing successful-boot test in this file.
  pid = start_ready_instance!(port: 4123, project_slug: "previsions", identifier: "mm-42", step_slug: "front")

  host = "previsions-mm-42-front.octocat.tracker.cods.dev"
  assert {:ok, 4123} = SymphonyElixir.PublicRouting.lookup(host)

  :ok = SymphonyElixir.DevServer.Instance.stop(pid)
  assert :error = SymphonyElixir.PublicRouting.lookup(host)
end
```

> `start_ready_instance!/1` is a helper you add in the test mirroring the file's existing instance-boot setup (it already injects `tmux`, `command_sender`, `probe`, `port_allocator`). Do not invent new injection points.

- [ ] **Step 2: Run test to verify it fails**

Run (from `elixir/`): `mix test test/symphony_elixir/dev_server/instance_test.exs -k "public host"`
Expected: FAIL — no registration happens; lookup returns `:error`.

- [ ] **Step 3a: Add `PublicRouting.preview_host/4`** (testable decision, keeps Instance branchless)

In `elixir/lib/symphony_elixir/public_routing.ex` add:

```elixir
@spec preview_host(String.t(), String.t(), String.t(), keyword()) :: String.t() | nil
def preview_host(project_slug, identifier, step_slug, opts \\ []) do
  if Config.public_tunnel_enabled?() do
    case host_for(project_slug, identifier, step_slug, opts) do
      {:ok, host} -> host
      {:error, _reason} -> nil
    end
  else
    nil
  end
end
```

Add tests to `public_routing_test.exs` covering all three arms:

```elixir
describe "preview_host/4" do
  test "nil when tunnel disabled" do
    load_public_tunnel_workflow!(enabled: false)
    assert PublicRouting.preview_host("previsions", "mm-42", "front") == nil
  end

  test "host when enabled and namespace resolves" do
    load_public_tunnel_workflow!(namespace: "octocat")
    assert PublicRouting.preview_host("previsions", "mm-42", "front",
             base_domain: "tracker.cods.dev") ==
             "previsions-mm-42-front.octocat.tracker.cods.dev"
  end

  test "nil when enabled but namespace cannot resolve" do
    load_public_tunnel_workflow!(namespace: nil)
    assert PublicRouting.preview_host("p", "i", "s",
             base_domain: "tracker.cods.dev",
             viewer: fn -> {:error, :x} end
           ) == nil
  end
end
```

Extend the existing `load_public_tunnel_workflow!/1` helper to accept `enabled: false` (writes `enabled: false`), defaulting to `enabled: true`.

- [ ] **Step 3b: Compute `public_host` in `initial_state/1`**

In `initial_state/1` add a `public_host` field next to `base_url:`:

```elixir
public_host: SymphonyElixir.PublicRouting.preview_host(project_slug, identifier, slug),
```

- [ ] **Step 4: Register on `:ready`**

In `probe_starting/2`, in the `:ok` branch, register before the state merge:

```elixir
:ok ->
  maybe_register_public_host(state, port)

  state =
    state
    |> Map.merge(%{status: :ready, probe_attempts: 0})
    |> persist_status(:ready)
    |> schedule_probe()
    |> reset_idle_timer()

  {:noreply, state}
```

With helper (NO `rescue` — `PublicRouting` is always supervised; both clauses are covered: the registering clause by the new tunnel-on test, the fallback by existing tunnel-off tests):

```elixir
defp maybe_register_public_host(%{public_host: host}, port)
     when is_binary(host) and is_integer(port) do
  SymphonyElixir.PublicRouting.register(host, port)
  :ok
end

defp maybe_register_public_host(_state, _port), do: :ok
```

- [ ] **Step 5: Unregister on stop/crash**

Add the helper (NO `rescue`):

```elixir
defp maybe_unregister_public_host(%{public_host: host}) when is_binary(host) do
  SymphonyElixir.PublicRouting.unregister(host)
  :ok
end

defp maybe_unregister_public_host(_state), do: :ok
```

Call `maybe_unregister_public_host(state)` as the first line of `mark_crashed/1` and of the GENERAL `mark_stopped/1` clause (NOT the `%{status: :crashed}` delegating clause — that delegates to `mark_crashed/1`, which already unregisters, avoiding a double call). The binary-host arm is covered by the new stop test; the fallback arm by existing tunnel-off teardown tests.

- [ ] **Step 6: Use `public_host` in `build_url`**

`build_url/3` is currently called once (in `launch_with_port/1`: `build_url(state.base_url, port, ...)`). Change that call to pass `state`:

```elixir
url = build_url(state, port, Map.get(state.step, :url_path, "/"))
```

and replace `build_url/3` with state-taking clauses:

```elixir
defp build_url(%{public_host: host}, _port, path) when is_binary(host) do
  "https://#{host}" <> normalize_path(path || "/")
end

defp build_url(%{base_url: base_url}, _port, path) when is_binary(base_url) and base_url != "" do
  String.trim_trailing(base_url, "/") <> normalize_path(path || "/")
end

defp build_url(_state, port, path) do
  "http://127.0.0.1:#{port}" <> normalize_path(path || "/")
end
```

> Grep `build_url(` in `instance.ex` and `instance_test.exs` first; there is one call site in `instance.ex` (line ~183). Update any direct `build_url` unit test to pass a state map. All three clauses must be covered: public_host (new test), base_url-present (existing tests that pass `base_url:`), and the loopback fallback (existing tests with neither).

- [ ] **Step 7: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir/dev_server/instance_test.exs`
Expected: PASS (new public-host test + existing instance tests still green).

- [ ] **Step 8: Commit**

```bash
git add elixir/lib/symphony_elixir/dev_server/instance.ex elixir/test/symphony_elixir/dev_server/instance_test.exs
git commit -m "feat(dev-server): register public preview host and emit https URL"
```

---

## Task 7: `Cloudflare.Dns` — DNS client (port of DM `cloudflare_dns.py`)

**Files:**
- Create: `elixir/lib/symphony_elixir/cloudflare/dns.ex`
- Test: `elixir/test/symphony_elixir/cloudflare/dns_test.exs`

Reference behavior: `seomachine/src/modules/cloudflare_dns.py` (`CloudflareDnsClient`, `build_public_dev_cname_records`). We ensure two CNAMEs (apex + wildcard) → `<tunnel-id>.cfargotunnel.com`, `proxied: true`.

- [ ] **Step 1: Write failing tests**

Create `elixir/test/symphony_elixir/cloudflare/dns_test.exs`:

```elixir
defmodule SymphonyElixir.Cloudflare.DnsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cloudflare.Dns

  defmodule FakeTransport do
    # records calls; returns canned successful responses
    def new(responses), do: Agent.start_link(fn -> %{responses: responses, calls: []} end)
  end

  test "build_cname_records/2 returns apex and wildcard records" do
    records =
      Dns.build_cname_records(
        namespace: "octocat",
        base_domain: "tracker.cods.dev",
        tunnel_id: "tunnel-123"
      )

    assert records == [
             %{name: "octocat.tracker.cods.dev", content: "tunnel-123.cfargotunnel.com", type: "CNAME", proxied: true},
             %{name: "*.octocat.tracker.cods.dev", content: "tunnel-123.cfargotunnel.com", type: "CNAME", proxied: true}
           ]
  end

  test "ensure_records/2 creates when absent (POST) via injected transport" do
    parent = self()

    transport = fn method, path, opts ->
      send(parent, {:call, method, path, opts})

      cond do
        method == "GET" and String.contains?(path, "/dns_records") -> %{"success" => true, "result" => []}
        method == "GET" and String.ends_with?(path, "/zones") -> %{"success" => true, "result" => [%{"id" => "zone-1"}]}
        true -> %{"success" => true, "result" => %{"id" => "rec-1"}}
      end
    end

    records = Dns.build_cname_records(namespace: "octocat", base_domain: "tracker.cods.dev", tunnel_id: "tunnel-123")

    assert {:ok, results} =
             Dns.ensure_records(records,
               api_token: "tok",
               zone_name: "cods.dev",
               transport: transport
             )

    assert Enum.all?(results, &(&1.action == "created"))
    assert_received {:call, "POST", _path, _opts}
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `elixir/`): `mix test test/symphony_elixir/cloudflare/dns_test.exs`
Expected: FAIL — module undefined.

- [ ] **Step 3: Implement the client**

Create `elixir/lib/symphony_elixir/cloudflare/dns.ex`:

```elixir
defmodule SymphonyElixir.Cloudflare.Dns do
  @moduledoc """
  Minimal Cloudflare DNS API client to ensure the apex + wildcard CNAME records
  pointing the public tunnel namespace at `<tunnel-id>.cfargotunnel.com`.
  Ported from the Distribution Machine `cloudflare_dns.py`.
  """

  @base_url "https://api.cloudflare.com/client/v4"

  @type record :: %{name: String.t(), content: String.t(), type: String.t(), proxied: boolean()}

  @spec build_cname_records(keyword()) :: [record()]
  def build_cname_records(opts) do
    namespace = Keyword.fetch!(opts, :namespace)
    base_domain = Keyword.fetch!(opts, :base_domain)
    tunnel_id = Keyword.fetch!(opts, :tunnel_id)
    target = "#{tunnel_id}.cfargotunnel.com"

    [
      %{name: "#{namespace}.#{base_domain}", content: target, type: "CNAME", proxied: true},
      %{name: "*.#{namespace}.#{base_domain}", content: target, type: "CNAME", proxied: true}
    ]
  end

  @spec ensure_records([record()], keyword()) :: {:ok, [map()]} | {:error, term()}
  def ensure_records(records, opts) do
    transport = Keyword.get(opts, :transport, &request_json/3)
    api_token = Keyword.fetch!(opts, :api_token)

    with {:ok, zone_id} <- resolve_zone_id(opts, transport, api_token) do
      results =
        Enum.map(records, fn record ->
          ensure_one(record, zone_id, transport, api_token)
        end)

      {:ok, results}
    end
  end

  defp ensure_one(record, zone_id, transport, api_token) do
    opts = [api_token: api_token, query: %{"type" => "CNAME", "name" => record.name}]

    case call(transport, "GET", "/zones/#{zone_id}/dns_records", opts) do
      %{"result" => [%{"id" => id} | _]} ->
        call(transport, "PUT", "/zones/#{zone_id}/dns_records/#{id}", api_token: api_token, payload: record)
        %{name: record.name, action: "updated"}

      _ ->
        call(transport, "POST", "/zones/#{zone_id}/dns_records", api_token: api_token, payload: record)
        %{name: record.name, action: "created"}
    end
  end

  defp resolve_zone_id(opts, transport, api_token) do
    case Keyword.get(opts, :zone_id) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        zone_name = Keyword.fetch!(opts, :zone_name)

        case call(transport, "GET", "/zones", api_token: api_token, query: %{"name" => zone_name}) do
          %{"result" => [%{"id" => id} | _]} -> {:ok, id}
          _ -> {:error, {:zone_not_found, zone_name}}
        end
    end
  end

  defp call(transport, method, path, opts), do: transport.(method, path, opts)

  defp request_json(method, path, opts) do
    api_token = Keyword.fetch!(opts, :api_token)
    query = Keyword.get(opts, :query)
    payload = Keyword.get(opts, :payload)

    url = @base_url <> path <> if(query, do: "?" <> URI.encode_query(query), else: "")

    req_opts = [
      method: String.downcase(method) |> String.to_atom(),
      url: url,
      headers: [{"authorization", "Bearer #{api_token}"}],
      retry: false
    ]

    req_opts = if payload, do: Keyword.put(req_opts, :json, payload), else: req_opts

    case Req.request(req_opts) do
      {:ok, %{body: body}} when is_map(body) -> body
      {:ok, %{body: body}} -> Jason.decode!(body)
      {:error, reason} -> %{"success" => false, "errors" => [inspect(reason)]}
    end
  end
end
```

> The DM ordering does zone lookup → per-record find → create/update. Match that. Confirm `Req.request/1` option names against the installed `req` `~> 0.5` while wiring (`:json`, `:headers`, `:method`, `:url`). The injected `transport` in tests sidesteps real HTTP.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `elixir/`): `mix test test/symphony_elixir/cloudflare/dns_test.exs`
Expected: PASS.

- [ ] **Step 4b: Exempt from the 100% coverage gate**

The real `request_json/3` transport hits the Cloudflare HTTP API and can't be unit-tested without live network (consistent with the repo already ignoring `SymphonyElixir.GitHub.Client` and `SymphonyElixir.Linear.Client`). Add `SymphonyElixir.Cloudflare.Dns` to `test_coverage.ignore_modules` in `elixir/mix.exs`. The injected-transport tests remain as regression tests regardless.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/cloudflare/dns.ex elixir/test/symphony_elixir/cloudflare/dns_test.exs elixir/mix.exs
git commit -m "feat(cloudflare): DNS client for tunnel CNAME records"
```

---

## Task 8: `mix symphony.tunnel.dns` task

**Files:**
- Create: `elixir/lib/mix/tasks/symphony.tunnel.dns.ex`

This task has side effects (network/env); it is covered by `Cloudflare.Dns` unit tests and excluded from coverage. Keep it thin.

- [ ] **Step 1: Implement the task**

Create `elixir/lib/mix/tasks/symphony.tunnel.dns.ex`:

```elixir
defmodule Mix.Tasks.Symphony.Tunnel.Dns do
  @shortdoc "Ensure Cloudflare CNAMEs for the public preview tunnel namespace"
  @moduledoc """
  Ensures the apex + wildcard CNAME records for the resolved public-tunnel
  namespace point at `<CLOUDFLARE_TUNNEL_ID>.cfargotunnel.com`.

  Reads from the environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_TUNNEL_ID,
  CLOUDFLARE_ZONE_NAME (and optional CLOUDFLARE_ZONE_ID).
  """

  use Mix.Task

  alias SymphonyElixir.Cloudflare.Dns
  alias SymphonyElixir.PublicRouting

  @impl true
  def run(_args) do
    Mix.Task.run("app.start")

    api_token = System.get_env("CLOUDFLARE_API_TOKEN") || raise "CLOUDFLARE_API_TOKEN is required"
    tunnel_id = System.get_env("CLOUDFLARE_TUNNEL_ID") || raise "CLOUDFLARE_TUNNEL_ID is required"
    zone_name = System.get_env("CLOUDFLARE_ZONE_NAME") || raise "CLOUDFLARE_ZONE_NAME is required"
    zone_id = System.get_env("CLOUDFLARE_ZONE_ID")

    namespace =
      case PublicRouting.resolve_namespace() do
        {:ok, ns} -> ns
        {:error, _} -> raise "Cannot resolve namespace (set PUBLIC_NAMESPACE or configure a GitHub token)"
      end

    base_domain = SymphonyElixir.Config.public_tunnel_base_domain()

    records =
      Dns.build_cname_records(namespace: namespace, base_domain: base_domain, tunnel_id: tunnel_id)

    case Dns.ensure_records(records, api_token: api_token, zone_name: zone_name, zone_id: zone_id) do
      {:ok, results} ->
        Enum.each(results, fn %{name: name, action: action} ->
          Mix.shell().info("#{action}: #{name}")
        end)

      {:error, reason} ->
        Mix.raise("Cloudflare DNS update failed: #{inspect(reason)}")
    end
  end
end
```

- [ ] **Step 2: Verify it compiles and lists**

Run (from `elixir/`): `mix help symphony.tunnel.dns`
Expected: prints the shortdoc, exit code 0.

- [ ] **Step 3: Add to coverage ignore list**

In `elixir/mix.exs`, add `Mix.Tasks.Symphony.Tunnel.Dns` to `test_coverage.ignore_modules` (network/IO task, not unit-tested directly).

- [ ] **Step 4: Commit**

```bash
git add elixir/lib/mix/tasks/symphony.tunnel.dns.ex elixir/mix.exs
git commit -m "feat(mix): symphony.tunnel.dns task to ensure CNAMEs"
```

---

## Task 9: `public-tunnel.sh` + Makefile targets

**Files:**
- Create: `elixir/scripts/public-tunnel.sh`
- Modify: `elixir/Makefile`
- Test: `elixir/test/scripts/public_tunnel_script_test.exs`

- [ ] **Step 1: Write failing test**

Create `elixir/test/scripts/public_tunnel_script_test.exs` (mirrors DM's `test_public_dev_script.py`):

```elixir
defmodule Symphony.Scripts.PublicTunnelScriptTest do
  use ExUnit.Case, async: true

  @script Path.expand("../../scripts/public-tunnel.sh", __DIR__)

  test "script exists and is executable" do
    assert File.exists?(@script)
    stat = File.stat!(@script)
    assert (stat.mode &&& 0o100) != 0
  end

  test "script declares the wildcard ingress and runs the named tunnel" do
    contents = File.read!(@script)
    assert contents =~ "hostname: \"*.tracker.cods.dev\""
    assert contents =~ "service: http://127.0.0.1:4000"
    assert contents =~ "cloudflared tunnel"
    refute contents =~ "cloudflared tunnel route dns"
  end

  import Bitwise
end
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `elixir/`): `mix test test/scripts/public_tunnel_script_test.exs`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the script**

Create `elixir/scripts/public-tunnel.sh`:

```bash
#!/usr/bin/env bash

# Run the Cloudflare named tunnel exposing *.tracker.cods.dev -> 127.0.0.1:4000.
# The Phoenix hub (PublicHostPlug) routes preview hosts to dev-server ports.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is required but was not found in PATH" >&2
    exit 1
fi

env_value() {
    local key="$1" default_value="$2" value=""
    if [ -f ".env" ]; then
        value="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- | tr -d '"'\''' || true)"
    fi
    echo "${value:-$default_value}"
}

TUNNEL_NAME="$(env_value CLOUDFLARED_TUNNEL_NAME cods-dev-tunnel)"
ROUTE_DNS="$(env_value PUBLIC_TUNNEL_ROUTE_DNS false)"
TUNNEL_CONFIG="$(env_value PUBLIC_TUNNEL_CONFIG /tmp/symphony-cods-dev-tunnel.yml)"

# The Phoenix hub always listens on :4000 (D2); the ingress is a static wildcard.
cat > "$TUNNEL_CONFIG" <<EOF
tunnel: ${TUNNEL_NAME}
ingress:
  - hostname: "*.tracker.cods.dev"
    service: http://127.0.0.1:4000
  - service: http_status:404
EOF

if [ "$ROUTE_DNS" != "false" ]; then
    echo "Ensuring Cloudflare CNAMEs via mix symphony.tunnel.dns..."
    mix symphony.tunnel.dns
fi

echo "Starting Cloudflare tunnel ${TUNNEL_NAME} (config: ${TUNNEL_CONFIG})..."
exec cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME"
```

Then: `chmod +x elixir/scripts/public-tunnel.sh`

> The `cat` heredoc literal here is in the **plan** (not a forbidden tool-created file); when implementing, create the file with the editor, not shell redirection.

- [ ] **Step 4: Run test to verify it passes**

Run (from `elixir/`): `mix test test/scripts/public_tunnel_script_test.exs`
Expected: PASS.

- [ ] **Step 5: Add Makefile targets**

Append to `elixir/Makefile` (match the file's existing `.PHONY`/comment style):

```makefile
.PHONY: tunnel tunnel-bg tunnel-logs tunnel-status tunnel-stop tunnel-dns

tunnel: ## Run the Cloudflare tunnel (foreground)
	@exec bash scripts/public-tunnel.sh

tunnel-bg: ## Run the Cloudflare tunnel in the background (logs: /tmp/symphony-cloudflared.log)
	@nohup bash scripts/public-tunnel.sh > /tmp/symphony-cloudflared.log 2>&1 &
	@echo "Tunnel started. Logs: /tmp/symphony-cloudflared.log"

tunnel-logs: ## Tail the background tunnel logs
	@tail -50 /tmp/symphony-cloudflared.log 2>/dev/null || echo "No log file. Is the tunnel running?"

tunnel-status: ## Show the named tunnel status
	@cloudflared tunnel info "$$(grep -E '^CLOUDFLARED_TUNNEL_NAME=' .env | cut -d= -f2 | tr -d '\"' || echo cods-dev-tunnel)" 2>/dev/null || echo "Tunnel not running"

tunnel-stop: ## Stop the background tunnel
	@pkill -f "cloudflared tunnel --config" || true
	@echo "Tunnel stopped."

tunnel-dns: ## Ensure Cloudflare CNAMEs for the namespace
	@mix symphony.tunnel.dns
```

- [ ] **Step 6: Verify targets are listed**

Run (from `elixir/`): `make help | grep tunnel` (or `grep -n '^tunnel' Makefile`)
Expected: the six `tunnel*` targets are present.

- [ ] **Step 7: Commit**

```bash
git add elixir/scripts/public-tunnel.sh elixir/Makefile elixir/test/scripts/public_tunnel_script_test.exs
git commit -m "feat(tunnel): public-tunnel.sh and make targets"
```

---

## Task 10: Documentation

**Files:**
- Modify: `elixir/README.md`, `elixir/WORKFLOW.md`, `elixir/WORKFLOW.github.example.md`, `elixir/WORKFLOW.macromarkets.example.md`, `elixir/WORKFLOW.local-dev.md`, `elixir/docs/troubleshooting.md`
- Modify (follow-up notes): `docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md`, `docs/superpowers/specs/2026-05-29-browser-vscode-task-workspace-design.md`

- [ ] **Step 1: Add the `public_tunnel:` block to WORKFLOW files**

In each `WORKFLOW*.md`, after the `dev_server:` block, add (commented in the non-dogfood examples):

```yaml
public_tunnel:
  enabled: false              # set true to expose previews via the Cloudflare tunnel
  base_domain: tracker.cods.dev
  # namespace: your-github-login   # defaults to the GitHub login
```

- [ ] **Step 2: Document the feature in `elixir/README.md`**

Add a "Public preview tunnel" section covering: the host scheme (`<project>-<issue>-<step>.<namespace>.tracker.cods.dev`), the `.env` keys (Task 11), the one-time setup (create tunnel, enable ACM, order `*.<namespace>.tracker.cods.dev` cert), `make tunnel` / `make tunnel-dns`, and the security note (previews are unauthenticated once exposed).

- [ ] **Step 3: Troubleshooting entries**

Add to `elixir/docs/troubleshooting.md`: `cloudflared` missing; 1033/Argo error → run `make tunnel-dns`; TLS error on nested hosts → ACM cert missing/inactive; port-in-use.

- [ ] **Step 4: Spec follow-up notes**

In the two referenced specs, add a one-line note that `2026-05-31-public-preview-tunnel-design.md` D12 supersedes their "no reverse-proxy through `:4000`" non-goal.

- [ ] **Step 5: Commit**

```bash
git add elixir/README.md elixir/WORKFLOW*.md elixir/docs/troubleshooting.md docs/superpowers/specs/2026-05-30-issue-dev-server-preview-design.md docs/superpowers/specs/2026-05-29-browser-vscode-task-workspace-design.md
git commit -m "docs: document public preview tunnel and supersede no-proxy notes"
```

---

## Task 11: `.env` keys + final quality gate

**Files:**
- Modify: `elixir/.env` (local, untracked secrets — add keys with empty values; do **not** commit real tokens), and any `elixir/.env.example` if present.

- [ ] **Step 1: Add the Cloudflare keys**

Append to `elixir/.env` (values filled by the operator; copy real values from the Distribution Machine `.env` for the shared Cloudflare account, but target `cods.dev`):

```bash
CLOUDFLARED_TUNNEL_NAME=cods-dev-tunnel
CLOUDFLARE_TUNNEL_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_ZONE_NAME=cods.dev
PUBLIC_NAMESPACE=
PUBLIC_TUNNEL_ROUTE_DNS=false
```

- [ ] **Step 2: Run the full quality gate**

Run (from `elixir/`): `make all`
Expected: format check, `mix specs.check`, credo, coverage (100% threshold for non-ignored modules), and dialyzer all pass with exit code 0.

> If coverage fails for a new module, add the missing branch test rather than ignoring the module (only the Mix task and script-only paths belong in the ignore list).

- [ ] **Step 3: Manual smoke (optional, requires real Cloudflare account)**

With `public_tunnel.enabled: true`, a configured namespace, a running dev server, and `make tunnel` + `make tunnel-dns`:
- `curl -I https://<namespace>.tracker.cods.dev/tracker/` → `200`.
- `curl -I https://<project>-<issue>-<step>.<namespace>.tracker.cods.dev/` → reaches the dev server.

- [ ] **Step 4: Commit (config example only; never commit secrets)**

```bash
git add elixir/.env.example   # only if it exists / was created
git commit -m "chore: document public tunnel env keys"
```

---

## Self-Review

**Spec coverage (each spec requirement → task):**
- Goal 1 (tracker host) → Task 3 (`tracker_host/1`), Task 9 (ingress), Task 10 (docs).
- Goal 2 (per-step preview hosts) → Task 3 (`host_for/4`), Task 6 (register/URL).
- Goal 3 (dynamic routing behind static ingress) → Task 5 (plug), Task 9 (static ingress).
- Goal 4 (DevServer lifecycle = source of truth) → Task 6 (register on ready / unregister on stop·crash).
- Goal 5 (port DM Cloudflare pattern to `.env`) → Task 7 (DNS client), Task 11 (`.env`).
- Goal 6 (per-operator namespace) → Task 3 (`resolve_namespace/0`), Task 2 (`namespace` config).
- Goal 7 (graceful degradation) → Task 5 (disabled→pass-through, unknown→404), Task 6 (namespace failure→loopback).
- D1 routing in Elixir → Task 5. D2 static wildcard ingress → Task 9. D3 namespace → Tasks 2,3. D4 host per step → Tasks 3,6. D5 nested label + DNS → Tasks 3,7. D6 ETS registry → Task 4. D7 build_url → Task 6. D8 WS via two packages → Tasks 1,5. D9 config split → Tasks 2,11. D10 security guard → Task 5 (suffix + lookup + port-range). D11 63-char guard → Task 3. D12 supersede note → Task 10.
- Testing section → Tasks 2,3,4,5,6,7,9 tests; full gate Task 11.
- Docs section → Task 10.

**Placeholder scan:** No `TBD`/`TODO`. Two intentional "mirror the existing test setup" notes (Tasks 2, 5, 6) point at concrete existing helpers in named files rather than inventing injection points — the implementer must read those files; the behavior and assertions are fully specified.

**Type consistency:** `PublicRouting.host_for/4` (opts keyword) is introduced in Task 3 and consumed in Task 6 via `host_for(project, identifier, slug, [])`. `lookup/1 :: {:ok, port} | :error`, `register/2`, `unregister/1` introduced in Task 4 and consumed in Tasks 5–6. `Cloudflare.Dns.build_cname_records/1` and `ensure_records/2` introduced in Task 7, consumed in Task 8. `Config.public_tunnel_*` introduced in Task 2, consumed in Tasks 3,5,6,8. `PublicHostPlug` introduced Task 5, wired in Endpoint same task. No symbol referenced before introduction.

**Known follow-ups to confirm during implementation (flagged inline, not blockers):**
- Exact `reverse_proxy_plug_websocket` `init/call` signature for the WS branch (Task 5 Step 3 note).
- `Req.request/1` option names for `Cloudflare.Dns` real transport (Task 7 note).
- The repo's existing test helpers for writing `WORKFLOW.md` and starting an `Instance` (Tasks 2, 5, 6 notes).
