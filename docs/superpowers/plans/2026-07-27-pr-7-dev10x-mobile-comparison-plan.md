# Dev10x Mobile Real Comparison Implementation Plan

**Goal:** Let Dev10x Mobile create and dispatch the official six-cell real-host comparison, follow every session and orchestrator run, inspect previews and encrypted evidence, and prove the complete experience in one Android E2E recording on PR #7.

**Architecture:** Reuse a parent issue plus six related child issues as the durable comparison aggregate. A host-side coordinator reconciles those records idempotently, starts existing assistant sessions and orchestrator executions, and presents one snapshot through new encrypted RPC methods. The React Native app renders that snapshot and downloads durable evidence in bounded encrypted chunks; no central hub, mock result, web automation, or out-of-band dispatch command participates in official evidence.

**Tech Stack:** Elixir/Phoenix/Ecto, Symphony assistant/orchestrator/evidence services, encrypted WebSocket RPC, Expo SDK 55, React Native 0.83, Expo Router, TanStack Query, `expo-file-system`, `expo-video`, ExUnit, Vitest, Jest, Android emulator/ADB.

---

## File structure

Backend comparison ownership:

- Create `elixir/lib/symphony_elixir/mobile_comparison/contract.ex` — canonical six-cell identity and provider settings.
- Create `elixir/lib/symphony_elixir/mobile_comparison/gateway.ex` — narrow adapter over existing tracker, assistant, orchestrator, preview, and evidence services.
- Create `elixir/lib/symphony_elixir/mobile_comparison/service.ex` — idempotent reconciliation, start/retry, and aggregate snapshot.
- Create `elixir/lib/symphony_elixir/mobile_comparison/presenter.ex` — provider-neutral mobile DTO.
- Create `elixir/lib/symphony_elixir/mobile_rpc/methods/comparisons.ex` — comparison RPC allowlist and subscription.
- Create `elixir/lib/symphony_elixir/mobile_rpc/methods/evidence.ex` — evidence list and bounded artifact reads.
- Modify `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex` — register both domains.

Mobile comparison ownership:

- Create `mobile/src/features/comparisons/comparison-contract.ts` — DTO parsing and derived progress/eligibility.
- Create `mobile/src/features/comparisons/rpc-comparison.ts` — get/start/retry/subscribe transport.
- Create `mobile/src/features/comparisons/useComparison.ts` — selected-host lifecycle and reconnect.
- Create `mobile/src/features/comparisons/ComparisonScreen.tsx` — overview, runs, previews, evidence, decision.
- Create `mobile/src/features/comparisons/ComparisonRoute.tsx` and
  `mobile/app/codex/issue/[projectSlug]/[identifier]/comparison.tsx` — navigation.
- Create `mobile/src/features/evidence/evidence-contract.ts` — manifest/artifact normalization.
- Create `mobile/src/features/evidence/downloadEvidenceArtifact.ts` — encrypted chunk download into host-scoped cache.
- Create `mobile/src/features/evidence/EvidenceArtifactScreen.tsx` and
  `mobile/app/codex/issue/[projectSlug]/[identifier]/evidence/[runId].tsx` — image, video, report, and trace viewing.
- Modify task creation/detail files to expose explicit comparison creation and dispatch.

Native branding and proof:

- Create dedicated assets under `mobile/assets/dev10x-native/`.
- Modify `mobile/app.config.ts` and `mobile/app/_layout.tsx`.
- Extend `mobile/e2e/android-smoke.sh` with the official app-driven comparison flow.
- Store final proof in the external evidence archive referenced by
  [`docs/pr-assets/README.md`](../../pr-assets/README.md); generated media must
  not be committed to this repository.

### Task 1: Canonical six-cell contract

**Files:**
- Create: `elixir/test/symphony_elixir/mobile_comparison/contract_test.exs`
- Create: `elixir/lib/symphony_elixir/mobile_comparison/contract.ex`

- [ ] **Step 1: Write the failing contract tests**

```elixir
defmodule SymphonyElixir.MobileComparison.ContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.Contract

  test "defines exactly the approved Dev10x high matrix" do
    assert Enum.map(Contract.cells(), &Map.take(&1, [:id, :path, :provider, :model, :effort])) == [
      %{id: "session-codex", path: :session, provider: "codex", model: "gpt-5.6-sol", effort: "high"},
      %{id: "session-cursor", path: :session, provider: "cursor", model: "cursor-grok-4.5-high", effort: nil},
      %{id: "session-claude", path: :session, provider: "claude", model: "claude-opus-5", effort: "high"},
      %{id: "orchestrator-codex", path: :orchestrator, provider: "codex", model: "gpt-5.6-sol", effort: "high"},
      %{id: "orchestrator-cursor", path: :orchestrator, provider: "cursor", model: "cursor-grok-4.5-high", effort: nil},
      %{id: "orchestrator-claude", path: :orchestrator, provider: "claude", model: "claude-opus-5", effort: "high"}
    ]
  end

  test "rejects unknown cells and exposes effective high effort for Cursor" do
    assert {:error, :unknown_cell} = Contract.fetch("session-nope")
    assert {:ok, cell} = Contract.fetch("session-cursor")
    assert cell.effective_effort == "high"
  end
end
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd elixir && mix test test/symphony_elixir/mobile_comparison/contract_test.exs
```

Expected: compile failure because `SymphonyElixir.MobileComparison.Contract` does not exist.

- [ ] **Step 3: Implement the immutable contract**

Implement `cells/0` and `fetch/1` with adjacent `@spec`s. Each cell also carries
`title`, `effective_effort`, and stable ordering; `cells/0` returns the literal
six maps asserted above and `fetch/1` returns the matching map or
`{:error, :unknown_cell}`.

- [ ] **Step 4: Run the contract test and verify GREEN**

Run the Step 2 command. Expected: `2 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/mobile_comparison/contract.ex elixir/test/symphony_elixir/mobile_comparison/contract_test.exs
git commit
```

Commit subject: `feat(mobile): define comparison matrix contract`

### Task 2: Encrypted evidence RPC

**Files:**
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/evidence_test.exs`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/evidence.ex`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex`
- Modify: `elixir/test/symphony_elixir/mobile_rpc/dispatcher_test.exs`

- [ ] **Step 1: Write failing method tests**

Define a test evidence service with:

```elixir
defmodule EvidenceService do
  def list("dev10x", "DEV-1"), do: {:ok, [%{run_id: "run-1", manifest: %{"runs" => []}}]}

  def read("dev10x", "DEV-1", "run-1", "artifacts/s.png", 0, 4) do
    {:ok,
     %{
       "content" => Base.encode64("PNG!"),
       "content_type" => "image/png",
       "size" => 8,
       "offset" => 0,
       "next_offset" => 4,
       "eof" => false
     }}
  end
end
```

Assert `evidence.list` accepts only project/identifier, and
`evidence.artifact.read` requires project/identifier/run/path/offset/length,
rejects length above `524_288`, and delegates to the injected
`:mobile_evidence_service`.

- [ ] **Step 2: Verify RED**

```bash
cd elixir && mix test test/symphony_elixir/mobile_rpc/methods/evidence_test.exs
```

Expected: module/method registration is missing.

- [ ] **Step 3: Implement list and bounded read**

`Evidence.List.call/2` delegates to `Evidence.Store.list/2` and presents records
with `id`, `run_id`, `session_id`, `status`, `ui_change`, `manifest`, and
`inserted_at`.

`Evidence.ArtifactRead.call/2`:

```elixir
with {:ok, records} <- Store.list(project, identifier),
     %Record{} = record <- Enum.find(records, &(&1.run_id == run_id)),
     {:ok, path} <- Store.resolve_artifact(record, relative),
     {:ok, stat} <- File.stat(path),
     {:ok, bytes} <- read_chunk(path, offset, min(length, stat.size - offset)) do
  {:ok,
   %{
     "content" => Base.encode64(bytes),
     "content_type" => MIME.from_path(path),
     "size" => stat.size,
     "offset" => offset,
     "next_offset" => offset + byte_size(bytes),
     "eof" => offset + byte_size(bytes) >= stat.size
   }}
end
```

Use `:file.pread/3`, close the descriptor in `after`, validate non-negative
offset and `1..524_288` length, and map unknown run/path to stable RPC errors.

- [ ] **Step 4: Register methods and verify capabilities**

Add `Evidence` to the dispatcher alias and `Evidence.modules()` to the default
module list. Extend the dispatcher test to assert both method names appear in
`system.identity` capabilities.

- [ ] **Step 5: Verify GREEN**

```bash
cd elixir && mix test test/symphony_elixir/mobile_rpc/methods/evidence_test.exs test/symphony_elixir/mobile_rpc/dispatcher_test.exs
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 6: Commit**

Commit subject: `feat(mobile): stream evidence through encrypted RPC`

### Task 3: Idempotent comparison reconciliation

**Files:**
- Create: `elixir/test/symphony_elixir/mobile_comparison/service_test.exs`
- Create: `elixir/lib/symphony_elixir/mobile_comparison/gateway.ex`
- Create: `elixir/lib/symphony_elixir/mobile_comparison/service.ex`
- Create: `elixir/lib/symphony_elixir/mobile_comparison/presenter.ex`

- [ ] **Step 1: Write the first failing service test**

Use an Agent-backed fake gateway that records calls and stores parent, child,
thread, execution, preview, and evidence maps. The first assertion is:

```elixir
assert {:ok, snapshot} =
         Service.start(
           %{
             "project_slug" => "dev10x",
             "identifier" => "DEV-1",
             "request_key" => "mobile-e2e-1"
           },
           %{comparison_gateway: FakeGateway, comparison_gateway_state: state}
         )

assert snapshot.parent.identifier == "DEV-1"
assert Enum.map(snapshot.cells, & &1.id) == Enum.map(Contract.cells(), & &1.id)
assert FakeGateway.created_children(state) == 6
assert FakeGateway.started_sessions(state) == 3
assert FakeGateway.dispatched_issues(state) == 3
```

- [ ] **Step 2: Verify RED**

```bash
cd elixir && mix test test/symphony_elixir/mobile_comparison/service_test.exs
```

Expected: `Service` and `Gateway` do not exist.

- [ ] **Step 3: Implement reconciliation through a narrow gateway**

The gateway behaviour exposes:

```elixir
@callback get_issue(String.t(), String.t(), map()) :: {:ok, map()} | {:error, term()}
@callback list_children(String.t(), String.t(), map()) :: {:ok, [map()]} | {:error, term()}
@callback create_child(String.t(), String.t(), map(), map()) :: {:ok, map()} | {:error, term()}
@callback ensure_session(map(), map(), map()) :: {:ok, map()} | {:error, term()}
@callback start_session(map(), String.t(), map()) :: :ok | {:error, term()}
@callback dispatch_child(map(), map()) :: :ok | {:error, term()}
@callback executions(map()) :: {:ok, [map()]} | {:error, term()}
@callback previews(map(), map()) :: {:ok, [map()]} | {:error, term()}
@callback evidence(map(), map()) :: {:ok, [map()]} | {:error, term()}
```

The default gateway adapts `LocalTracker.Context`, `IssueAgentSettings`,
`Assistant.History`, `Assistant.AgentSession`/`TurnManager`, existing dispatch
services, `OrchestratorService`, dev-server preview services, and
`Evidence.Store`. It does not shell out or call the web tracker.

Child matching uses the stable title marker
`[dev10x-comparison:<cell-id>]` plus the parent relation. Existing matching
children are validated against persisted provider/model/effort before reuse.

- [ ] **Step 4: Add partial-start and repeat-start RED tests**

Test each boundary:

- child creation stops after cell 2;
- session creation stops after cell 4;
- session start fails after the thread exists;
- autonomous dispatch fails after the child exists;
- a second call with the same or a new request key reconciles missing work;
- live, successful, and parked cells are never redispatched.

The repeated successful start must leave counts at six children, three
sessions, and three orchestrator dispatches.

- [ ] **Step 5: Implement resume rules and snapshot presentation**

The snapshot DTO contains:

```elixir
%{
  "project_slug" => "dev10x",
  "identifier" => "DEV-1",
  "status" => "running",
  "progress" => %{"terminal" => 2, "passed" => 1, "failed" => 1, "total" => 6},
  "cells" => [
    %{
      "id" => "session-codex",
      "path" => "session",
      "provider" => "codex",
      "requested_model" => "gpt-5.6-sol",
      "requested_effort" => "high",
      "effective_effort" => "high",
      "resolved_model" => nil,
      "resolved_effort" => nil,
      "status" => "starting",
      "attempt" => 1,
      "issue_identifier" => "DEV-2",
      "thread_id" => 42,
      "execution_session_id" => nil,
      "latest_message" => nil,
      "error" => nil,
      "previews" => [],
      "evidence" => []
    }
  ],
  "decision" => nil
}
```

Decision remains `nil` until all six cells are terminal and every UI claim has
durable evidence.

- [ ] **Step 6: Verify GREEN**

Run the service test file. Expected: all reconciliation, retry-safety, and
presentation tests pass.

- [ ] **Step 7: Commit**

Commit subject: `feat(mobile): coordinate real comparison runs`

### Task 4: Comparison RPC and live subscription

**Files:**
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/comparisons.ex`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex`
- Modify: `elixir/test/symphony_elixir/mobile_rpc/dispatcher_test.exs`

- [ ] **Step 1: Write failing validation/delegation tests**

Assert:

- `comparisons.start` requires `project_slug`, `identifier`, `request_key`;
- `comparisons.get` and `comparisons.subscribe` require project/identifier;
- `comparisons.retry_cell` additionally requires one canonical `cell_id`;
- every call receives the authenticated dispatcher context;
- subscription sends `comparisons.snapshot` initially and after relevant
  tracker/session/execution/evidence events.

- [ ] **Step 2: Verify RED**

```bash
cd elixir && mix test test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs
```

- [ ] **Step 3: Implement the four methods**

Use `MobileMethod` for start/get/retry. Implement subscribe with the same
cleanup/activate tuple used by `Methods.Orchestrator`, but have a dedicated
bridge process subscribe to all relevant PubSub topics and coalesce bursts for
100 ms before calling `Service.get/2`.

- [ ] **Step 4: Register and verify GREEN**

```bash
cd elixir && mix test test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs test/symphony_elixir/mobile_rpc/dispatcher_test.exs
```

- [ ] **Step 5: Commit**

Commit subject: `feat(mobile): expose comparison lifecycle over RPC`

### Task 5: Mobile contract, reconnect, and encrypted artifact download

**Files:**
- Create: `mobile/src/features/comparisons/comparison-contract.test.ts`
- Create: `mobile/src/features/comparisons/comparison-contract.ts`
- Create: `mobile/src/features/comparisons/rpc-comparison.test.ts`
- Create: `mobile/src/features/comparisons/rpc-comparison.ts`
- Create: `mobile/src/features/comparisons/useComparison.ts`
- Create: `mobile/src/features/evidence/evidence-contract.test.ts`
- Create: `mobile/src/features/evidence/evidence-contract.ts`
- Create: `mobile/src/features/evidence/downloadEvidenceArtifact.test.ts`
- Create: `mobile/src/features/evidence/downloadEvidenceArtifact.ts`

- [ ] **Step 1: Write RED tests for normalization**

Assert malformed cells are ignored, the canonical six are ordered by contract,
Cursor displays effective High, progress is recomputed defensively, and retry
is allowed only for terminal failed/blocked cells.

- [ ] **Step 2: Verify RED**

```bash
cd mobile && npx vitest run src/features/comparisons/comparison-contract.test.ts src/features/evidence/evidence-contract.test.ts
```

- [ ] **Step 3: Implement typed normalization**

Export:

```ts
export type ComparisonCell = {
  id: string;
  path: "session" | "orchestrator";
  provider: "codex" | "cursor" | "claude";
  requestedModel: string;
  requestedEffort: string | null;
  effectiveEffort: "high";
  resolvedModel: string | null;
  resolvedEffort: string | null;
  status: string;
  attempt: number;
  issueIdentifier: string;
  threadId: number | null;
  executionSessionId: number | null;
  latestMessage: string | null;
  error: string | null;
  previews: ComparisonPreview[];
  evidence: EvidenceRecord[];
};
```

Keep snake-case conversion at the RPC boundary.

- [ ] **Step 4: Write RED transport lifecycle tests**

Test get-before-subscribe, initial/stream snapshots, disconnect cleanup,
generation protection against late events, explicit reconnect, start request
key propagation, and retry cell propagation.

- [ ] **Step 5: Implement `rpc-comparison.ts` and `useComparison.ts`**

Follow `rpc-orchestrator-executions.ts`: call `comparisons.get`, subscribe to
`comparisons.subscribe`, accept only `comparisons.snapshot`, and refetch before
each resubscription. Query/cache keys include host ID, project, and parent
identifier.

- [ ] **Step 6: Write RED chunk-download tests**

Use an in-memory file adapter. Assert requests advance offsets exactly, decode
base64 in order, stop only at EOF, reject a stalled `next_offset`, resume a
partial temp file, atomically rename on completion, and isolate paths by host.

- [ ] **Step 7: Implement the downloader**

The public API is:

```ts
export async function downloadEvidenceArtifact(options: {
  transport: HostTransport;
  hostId: string;
  projectSlug: string;
  identifier: string;
  runId: string;
  artifactPath: string;
  signal?: AbortSignal;
  fileStore?: EvidenceFileStore;
}): Promise<{ uri: string; contentType: string; size: number }>;
```

Use 512 KiB chunks and `expo-file-system` cache files in production.

- [ ] **Step 8: Verify GREEN and commit**

Run only the four new Vitest files plus `npm run typecheck`.

Commit subject: `feat(mobile): consume comparison and evidence RPC`

### Task 6: Create/dispatch UX and comparison screen

**Files:**
- Modify: `mobile/src/features/tasks/CreateTaskScreen.tsx`
- Modify: `mobile/src/features/tasks/CreateTaskScreen.test.tsx`
- Modify: `mobile/src/features/tasks/CreateTaskRoute.tsx`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`
- Modify: `mobile/src/features/tasks/IssueScreen.test.tsx`
- Modify: `mobile/src/features/tasks/IssueRoute.tsx`
- Create: `mobile/src/features/comparisons/ComparisonScreen.tsx`
- Create: `mobile/src/features/comparisons/ComparisonScreen.test.tsx`
- Create: `mobile/src/features/comparisons/ComparisonRoute.tsx`
- Create: `mobile/app/codex/issue/[projectSlug]/[identifier]/comparison.tsx`

- [ ] **Step 1: Write RED task-flow UI tests**

Assert New Task offers `Standard task` and `Dev10x comparison`; comparison mode
shows all six fixed cells and creates only the parent. Assert the issue screen
shows `Run comparison` before start and `Open comparison` after start.

- [ ] **Step 2: Verify RED**

```bash
cd mobile && npx jest --runInBand src/features/tasks/CreateTaskScreen.test.tsx src/features/tasks/IssueScreen.test.tsx
```

- [ ] **Step 3: Implement explicit create then dispatch**

Add `taskKind: "standard" | "comparison"` to the screen submission result.
Store the comparison marker in the parent description as a stable fenced
metadata block while keeping the human prompt readable. Route success to issue
detail. `Run comparison` navigates to the comparison route and calls
`comparisons.start` only after the user presses the explicit button there.

- [ ] **Step 4: Write RED comparison screen tests**

Assert the five sections, `n/6` progress, six cards, requested/resolved
provenance, live/error/recovery labels, log navigation, preview navigation,
evidence cards, disabled decision before completion, ranking after completion,
offline cached badge, and retry eligibility.

- [ ] **Step 5: Implement the screen as focused components**

Keep the route responsible for data and navigation. Split presentational
sections in the same feature directory if `ComparisonScreen.tsx` exceeds 300
lines. Reuse current theme tokens, state views, rich session routes, and preview
routes. Do not add a second terminal-first session UI.

- [ ] **Step 6: Verify GREEN and commit**

Run the three focused Jest files and `npm run typecheck`.

Commit subject: `feat(mobile): add app-driven comparison experience`

### Task 7: In-app evidence gallery and viewers

**Files:**
- Create: `mobile/src/features/evidence/EvidenceGallery.tsx`
- Create: `mobile/src/features/evidence/EvidenceGallery.test.tsx`
- Create: `mobile/src/features/evidence/EvidenceArtifactScreen.tsx`
- Create: `mobile/src/features/evidence/EvidenceArtifactScreen.test.tsx`
- Create: `mobile/src/features/evidence/EvidenceArtifactRoute.tsx`
- Create: `mobile/app/codex/issue/[projectSlug]/[identifier]/evidence/[runId].tsx`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [ ] **Step 1: Write RED gallery/viewer tests**

Assert grouping by cell/run, status/duration/command/proof presentation,
thumbnail actions, image rendering, native video rendering, report text
rendering, trace metadata/share action, loading progress, retry, and offline
cached behavior.

- [ ] **Step 2: Verify RED**

```bash
cd mobile && npx jest --runInBand src/features/evidence/EvidenceGallery.test.tsx src/features/evidence/EvidenceArtifactScreen.test.tsx
```

- [ ] **Step 3: Install the Expo-compatible video package**

```bash
cd mobile && npx expo install expo-video
```

Confirm the installed version matches Expo SDK 55 with `npx expo install
--check`.

- [ ] **Step 4: Implement gallery and viewers**

Use React Native `Image` for screenshots, `VideoView`/`useVideoPlayer` for
cached videos, the existing markdown/source preview for reports, and a metadata
card plus native share/save for ZIP traces. Never inject trace contents into a
WebView.

- [ ] **Step 5: Verify GREEN and commit**

Run the two Jest files, downloader Vitest, typecheck, and `expo install --check`.

Commit subject: `feat(mobile): render durable comparison evidence`

### Task 8: Official Dev10x splash and complete native icons

**Files:**
- Create: `mobile/assets/dev10x-native/icon-ios.png`
- Create: `mobile/assets/dev10x-native/icon-android.png`
- Create: `mobile/assets/dev10x-native/adaptive-foreground.png`
- Create: `mobile/assets/dev10x-native/adaptive-monochrome.png`
- Create: `mobile/assets/dev10x-native/splash.png`
- Create: `mobile/scripts/generate-native-brand-assets.mjs`
- Create: `mobile/scripts/generate-native-brand-assets.test.ts`
- Modify: `mobile/app.config.ts`
- Modify: `mobile/app/_layout.tsx`

- [ ] **Step 1: Write RED asset/config tests**

The test invokes the generator in a temporary directory and asserts exact
dimensions, opaque icon backgrounds, transparent adaptive foreground, safe-zone
bounds, canonical source hashes, and splash logo centering. A config assertion
checks iOS icon, Android legacy/adaptive/monochrome icons, and
`expo-splash-screen` plugin settings.

- [ ] **Step 2: Verify RED**

```bash
cd mobile && npx vitest run scripts/generate-native-brand-assets.test.ts
```

- [ ] **Step 3: Generate deterministic assets**

Use the canonical `tracker/public/dev10x_icon.png` and
`tracker/public/dev10x_logo_white.png`. The script invokes ImageMagick with
fixed geometry/colors:

- 1024×1024 opaque dark iOS and legacy Android icons;
- 1024×1024 transparent adaptive foreground with mark inside 66% safe zone;
- 432×432 white monochrome mask;
- 1284×2778 dark splash with centered white Dev10x logo.

- [ ] **Step 4: Configure native splash lifecycle**

Set `icon`, `ios.icon`, Android `icon`, `adaptiveIcon.foregroundImage`,
`monochromeImage`, and `backgroundColor`. Add the `expo-splash-screen` plugin
with dark background and the generated splash image. In the root layout,
prevent auto-hide before providers hydrate and hide exactly once when
connection storage and host store are ready.

- [ ] **Step 5: Verify GREEN and commit**

Run the asset test, `npx expo config --type public`, `npm run typecheck`, and
inspect all five generated images.

Commit subject: `feat(mobile): complete Dev10x native branding`

### Task 9: Focused regression and Android build

**Files:**
- Modify only files required by failures discovered in the focused checks.

- [ ] **Step 1: Format and check changed sources**

```bash
cd elixir && mix format --check-formatted \
  lib/symphony_elixir/mobile_comparison \
  lib/symphony_elixir/mobile_rpc/methods/comparisons.ex \
  lib/symphony_elixir/mobile_rpc/methods/evidence.ex \
  test/symphony_elixir/mobile_comparison \
  test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs \
  test/symphony_elixir/mobile_rpc/methods/evidence_test.exs
cd mobile && npm run format:check && npm run lint && npm run typecheck
```

- [ ] **Step 2: Run the bounded backend regression**

```bash
cd elixir && mix test \
  test/symphony_elixir/mobile_comparison \
  test/symphony_elixir/mobile_rpc/methods/comparisons_test.exs \
  test/symphony_elixir/mobile_rpc/methods/evidence_test.exs \
  test/symphony_elixir/mobile_rpc/dispatcher_test.exs \
  test/symphony_elixir/mobile_rpc/orchestrator_service_test.exs \
  test/symphony_elixir_web/controllers/tracker/evidence_controller_test.exs
```

- [ ] **Step 3: Run the bounded mobile regression**

Run only comparison/evidence/task/orchestrator/session route tests, then
`npm run typecheck`. Do not run the complete Jest/Vitest suites.

- [ ] **Step 4: Build the local E2E APK**

```bash
cd mobile && npm run build:android:e2e
```

Record APK path, package/label inspection, size, and SHA-256.

- [ ] **Step 5: Commit any bounded-regression fixes**

Commit subject: `fix(mobile): stabilize comparison E2E path`

### Task 10: Real-host E2E, evidence package, and PR #7 update

**Files:**
- Modify: `mobile/e2e/android-smoke.sh`
- Update: `docs/pr-assets/README.md` with the external evidence archive.
- Publish generated proof files externally; do not commit them under `docs/`.

- [ ] **Step 1: Add an E2E preflight that cannot use mocks**

The script must fail unless:

- the selected endpoint is a real local Symphony mobile RPC host;
- device pairing completes with a device-scoped credential;
- all three real providers report available;
- the canonical models are present;
- no mock-server process or mock profile is selected;
- enough disk space exists for six workspaces and video evidence.

- [ ] **Step 2: Drive the entire flow through app controls**

Use ADB only for install, cold launch, screen recording, taps/text input, and
pulling device artifacts. Do not call tracker APIs, benchmark scripts, or shell
dispatch commands after the app launches.

Required visual checkpoints:

1. native Dev10x splash;
2. selected real host and health;
3. New Task comparison mode and six-cell contract;
4. created parent task;
5. explicit `Run comparison`;
6. all six live cells;
7. one session rich log and one orchestrator rich log;
8. provider provenance and any recovery;
9. real previews;
10. screenshot, video, report, and trace evidence;
11. final ranking and decision.

- [ ] **Step 3: Collect and audit proof**

Create:

- continuous MP4 and contact sheet;
- principal in-app PNG screenshots;
- redacted RPC trace;
- matrix JSON/Markdown with requested/resolved provenance;
- cell timings, terminal states, retry/recovery log;
- provider versions;
- artifact and source SHA-256 manifests;
- requirement-by-requirement evidence audit.

Verify the video duration/resolution/codecs with `ffprobe`, every media hash with
`sha256sum -c`, every screenshot with `identify`, and the trace redactor with
the existing secret scan.

- [ ] **Step 4: Push and update only PR #7**

Push `agent/mobile-companion-e2e`. Update PR #7 with:

- detailed six-cell matrix and exact counts;
- inline mobile screenshots;
- linked continuous E2E video;
- logs and recovery narrative;
- provider provenance;
- evidence package and hashes;
- final ranking/decision;
- explicit WSL focused-test scope.

Verify PR #7 head SHA, state, mergeability, checks, and rendered body. Verify PR
#11 remains closed and is described only as absorbed history.

- [ ] **Step 5: Completion audit**

Re-read the active goal and this design. For every requirement, name the
authoritative file, runtime observation, video timestamp, screenshot, test, or
PR section proving it. Any missing or indirect item keeps the goal active.
