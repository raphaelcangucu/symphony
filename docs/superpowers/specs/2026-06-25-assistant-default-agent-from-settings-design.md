# Assistant Default CLI Agent From User Settings - Design

> The default CLI agent shown in every assistant composer should come from the
> user's Settings (`agents.default_agent_kind`), delivered to the frontend as the
> catalog bundle's `defaultAgent`. Today some surfaces fall back to a hardcoded
> `codex` when they mount before the settings-driven catalog has loaded, so the
> user's configured default is ignored. This design makes the Settings default
> the single source of truth via an explicit precedence, without disturbing
> already-assigned issue agents or a user's remembered/explicit choices.

## 1. Problem

The backend already exposes the operator's default agent: the
`/projects/:slug/assistant/config` endpoint returns
`default_agent: Settings.Agents.default_agent_kind()`, and the frontend maps it
to `AssistantCatalogBundle.defaultAgent`. The `SettingsPage` lets the user pick
that default and persists it server-side.

The failure is on the frontend, where the default agent leaks from a hardcoded
`fallbackCatalogBundle()` (`defaultAgent: "codex"`) in surfaces that render the
composer before the real, settings-driven bundle has loaded:

- **Issue execution / steer composer** (`ExecutionControlComposer` →
  `AssistantComposer`): seeds its local bundle with `fallbackCatalogBundle()` and
  `AssistantComposer`'s `[bundle]` effect only re-validates the *model*, never the
  *agent*. A fresh browser therefore locks the dispatch default to `codex`, even
  when Settings says `claude` or `cursor`.
- **Freeform assistant chat** (`ProjectAssistantPanel` with no project): uses the
  hardcoded `codex` fallback bundle because there is no project-scoped catalog
  endpoint to read the global default from.

Two surfaces already behave correctly and must stay that way:

- **Project / explore / issue-authoring chat** (`ProjectAssistantPanel` →
  `AssistantComposer`): the composer only mounts once the real settings-driven
  bundle has loaded, so a fresh first load already uses the Settings default.
- **New-issue dialog** (`IssueCreateDialog`): default is "inherit", which the
  backend resolves to the effective (settings/project-driven) agent; `codex`
  appears only as an error-path label fallback.

## 2. Goals

1. The Settings default (`agents.default_agent_kind`) is the single source of
   truth for the default CLI agent in **every** assistant composer surface.
2. On a fresh browser (no prior choice), every surface initializes its default
   agent from the Settings default, even when the composer first mounts on a
   fallback bundle and the real bundle arrives later.
3. Preserve an issue's already-assigned agent (`issue.agentKind`) as the highest
   precedence in the execution composer.
4. Preserve a user's remembered or explicitly-chosen agent (existing behavior,
   `leave_as_is`): existing browsers and in-session manual selections are never
   silently overridden.
5. Honor `first_load_only` semantics: once a browser has a remembered agent, that
   value wins; the Settings default is not force-re-applied on later loads.

## 3. Non-goals

- A one-time storage reset/migration to force the Settings default onto existing
  browsers (explicitly declined: `leave_as_is`).
- Changing the backend settings model, the `/settings` API, or
  `Settings.Agents.default_agent_kind()`.
- Reworking how `issue.agentKind` is assigned, persisted, or displayed, or fixing
  the pre-existing menu-vs-dispatch display nuance in the execution composer.
- Per-project default agent configuration changes (existing project override
  behavior is untouched).
- Fetching `/settings` from freeform chat to obtain the default when no cached
  catalog exists (last-resort fallback remains `codex`).

## 4. Default-agent precedence

Two related but distinct concerns, both anchored on the Settings default.

**(A) Dispatched agent in the execution composer** (what actually runs):

1. **Issue-assigned agent** — `issue.agentKind`, when the issue already has one.
2. **In-session manual selection** — the user picking an agent in the menu.
3. **Remembered choice** — a valid stored agent in `localStorage`.
4. **User Settings default** — `bundle.defaultAgent`, from
   `Settings.Agents.default_agent_kind()`.
5. **Last resort** — hardcoded `codex`, only when the settings-driven catalog is
   unavailable (API down) **and** nothing is cached.

**(B) Displayed default in any composer when there is no explicit prior choice**
(no remembered agent, no manual selection): the Settings default
(`bundle.defaultAgent`), falling back to `codex` only as the documented last
resort.

To keep the change minimal and non-regressing, `issue.agentKind` is **not**
injected into `AssistantComposer`'s internal/persisted agent state (which is
shared across all composer instances via one `localStorage` key). Instead, the
execution composer signals its presence so `AssistantComposer` **gates off**
bundle-default adoption; the dispatched agent for an assigned issue keeps coming
from the execution composer's existing `issue.agentKind` wiring. This avoids
polluting the shared remembered agent and avoids overriding an assigned issue's
agent when the real bundle loads.

An explicit prior choice (remembered agent in `localStorage`, or an in-session
manual selection) always overrides the Settings default and is never overridden
by a later bundle change.

## 5. Components and changes

### 5.1 `tracker/src/lib/assistantSettings.ts`

- Add `hasPersistedComposerAgent(): boolean` that returns whether `localStorage`
  (`symphony.assistant.composer.v2`) currently holds a valid stored `agent`
  (`codex` | `claude` | `cursor`). This distinguishes a genuine prior/remembered
  choice from a fresh browser. SSR-safe (`typeof window === "undefined"` → false);
  parse failures → false.
- `fallbackCatalogBundle()` is unchanged and remains the documented last resort.

### 5.2 `tracker/src/components/assistant/AssistantComposer.tsx`

- New optional prop `hasExternalAgent?: boolean`. When `true`, the surface owns
  the agent externally (the execution composer, where `issue.agentKind` may apply),
  so the composer must **not** auto-adopt the bundle default. This is a gate only;
  it does not set or persist the displayed agent.
- Track an explicit-choice ref initialized to `hasPersistedComposerAgent()` at
  mount (`true` → a remembered choice exists, so respect it). `updateAgent` sets
  the ref to `true` (an in-session manual selection becomes explicit).
- Initial agent resolution is unchanged from today: `loadComposerState(bundle)`
  returns the remembered agent when present, else `bundle.defaultAgent`.
- Extend the existing `[bundle]` effect: when the ref is `false` (no explicit
  choice) **and** `hasExternalAgent` is falsey, adopt `bundle.defaultAgent` (and
  re-derive/normalize the model for that agent). This is the core fix — a composer
  that mounted on a fallback bundle snaps to the real Settings default once the
  real bundle loads. When the ref is `true` or `hasExternalAgent` is set, the
  effect keeps the current agent (today's behavior).
- `onAgentChange` reporting and per-agent model/effort persistence are unchanged.

### 5.3 `tracker/src/components/issues/issue-detail/ExecutionControlComposer.tsx`

- Initialize the local bundle from `loadCachedCatalogBundle() ?? fallbackCatalogBundle()`
  so returning browsers get the settings-driven `defaultAgent` immediately,
  before the fetch resolves.
- Pass `hasExternalAgent={issue.agentKind != null}` to `AssistantComposer`.
- Result: an issue with an assigned agent keeps it via the existing
  `issue.agentKind` effect and `onAgentChange → setAgent` wiring (adoption is
  gated off, so bundle load no longer clobbers it); an issue with no assigned
  agent dispatches with the Settings default once the real bundle loads (the
  composer adopts `bundle.defaultAgent` and reports it through `onAgentChange`).

### 5.4 `tracker/src/components/assistant/ProjectAssistantPanel.tsx`

- Where the panel seeds a bundle with `fallbackCatalogBundle()` (notably the
  freeform/no-project branch), prefer `loadCachedCatalogBundle() ?? fallbackCatalogBundle()`
  so the global Settings default is honored from cache even without a project
  catalog fetch. Steer/queue fallbacks that already read `bundleRef.current` are
  unchanged.

## 6. Data flow

```
Settings (DB) agents.default_agent_kind
   -> Settings.Agents.default_agent_kind()
   -> GET /projects/:slug/assistant/config { default_agent }
   -> normalizeAssistantCatalogBundle -> bundle.defaultAgent
   -> saveCachedCatalogBundle (localStorage cache)
        |
        v
AssistantComposer initial agent = remembered (localStorage) ?? bundle.defaultAgent
   on bundle change, if no explicit choice AND not hasExternalAgent:
        adopt bundle.defaultAgent
        |
        v (execution composer)
onAgentChange -> ExecutionControlComposer.agent ; issue.agentKind effect still wins
   when the issue has an assigned agent
```

## 7. Edge cases and error handling

- **Fresh browser, project chat:** composer mounts on the real bundle → Settings
  default. Unchanged.
- **Fresh browser, execution composer (issue has no agent):** mounts on cached or
  fallback bundle; on real-bundle arrival adopts `bundle.defaultAgent`. Fixed.
- **Fresh browser, execution composer (issue has agent):** `hasExternalAgent` is
  `true`, so bundle adoption is gated off and the existing `issue.agentKind`
  wiring sets the dispatched agent. No regression.
- **Returning browser with remembered agent:** `hasPersistedComposerAgent()` →
  `true`; remembered agent wins; no override. `leave_as_is` honored.
- **In-session manual change:** `updateAgent` marks the choice explicit; later
  bundle changes do not override it.
- **Catalog API down, no cache:** `fallbackCatalogBundle()` (`codex`) used as the
  documented last resort.
- **SSR / no `window`:** `hasPersistedComposerAgent()` returns `false`; no crash.

## 8. Testing

- `assistantSettings.test.ts`: `hasPersistedComposerAgent()` returns `false` for
  empty/corrupt storage and `true` for a valid stored agent.
- `AssistantComposer` component test:
  - Fresh storage: mounting with a fallback (`codex`) bundle then swapping to a
    real bundle (`claude`) adopts `claude` (reported via `onAgentChange`).
  - With `hasExternalAgent`, a fallback→real bundle swap does **not** change the
    reported agent (adoption gated off).
  - A remembered/explicit agent in storage is preserved across a bundle swap.
- `ExecutionControlComposer` test: an issue with no `agentKind` dispatches with
  the Settings default once the bundle loads; an issue with `agentKind` dispatches
  with that agent.
- Run the tracker test suite (`vitest`) for the touched files.

## 9. Out of scope / follow-ups

- A future opt-in "reset remembered agent" affordance in Settings (would satisfy
  the declined one-time migration if desired later).
- Backend "effective agent" resolution for freeform chat without a cached
  catalog.
