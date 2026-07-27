# Dev10x Site High-Effort Matrix Design

Date: 2026-07-27

## Objective

Produce a new, reproducible six-cell visual benchmark for Dev10x landing sites,
using the current `main` branch and the same session/orchestrator comparison
shape as PR #6:

| Path | Provider | Requested model | Requested effort |
| --- | --- | --- | --- |
| Session | Codex | `gpt-5.6-sol` | `high` |
| Session | Cursor | `cursor-grok-4.5-high` | null; `high` is encoded in the model slug |
| Session | Claude | `claude-opus-5` | `high` |
| Orchestrator | Codex | `gpt-5.6-sol` | `high` |
| Orchestrator | Cursor | `cursor-grok-4.5-high` | null; `high` is encoded in the model slug |
| Orchestrator | Claude | `claude-opus-5` | `high` |

`gpt-5.6-sol` is selected because it is the current default GPT-5.6 variant in
the installed Codex catalog. The benchmark still records and verifies the
provider-resolved model and effort; it does not infer a resolved value from the
request.

## Current State

The benchmark merged by PR #6 already provides:

- real Symphony session and orchestrator execution paths;
- canonical requested/resolved model provenance checks;
- isolated preview ports and sanitized child environments;
- build and Playwright E2E validation;
- desktop/mobile screenshots, Playwright video, MP4 conversion and trace;
- Evidence-tab import and rendered-media verification;
- comparison JSON/Markdown and visual gallery generation.

The missing pieces for this goal are:

- a focused all-high matrix instead of re-running the historical 18 cells;
- mandatory use of the canonical Dev10x image assets and color tokens;
- contract verification that generated sites contain exact, unmodified brand
  assets;
- more detailed per-site screenshots for the flow and evidence sections;
- reports and a decision rubric tailored to the six new sites.

## Considered Approaches

### 1. Re-run all 18 historical cells

This preserves the old matrix unchanged but spends substantial time and provider
quota on models outside the requested comparison. It also obscures the decision
between Grok 4.5, Opus 5 and GPT-5.6 high. Rejected.

### 2. Replace the historical matrix with only six cells

This creates a simple runner but makes the PR #6 benchmark definitions
unavailable for future reproduction. Rejected because the historical contracts
remain useful and already have published evidence.

### 3. Add a focused `dev10x-brand-high` matrix

Keep the historical definitions, add one explicit six-cell matrix and expose a
dedicated command. Provisioning can select only this matrix, while reports
remain compatible with the existing collector. This is the selected approach.

## Canonical Brand Contract

The source of truth is `tracker/public` on the benchmark branch:

- `dev10x_logo_color.png`
- `dev10x_logo_black.png`
- `dev10x_logo_white.png`
- `dev10x_icon.png`
- `favicon.png`
- `favicon.svg`
- `favicons/*`

The canonical palette is taken from `favicon.svg`:

| Token | Value | Intended use |
| --- | --- | --- |
| Ink | `#0F172A` | typography, dark surfaces and brackets |
| Violet | `#7C3AED` | gradient origin and emphasis |
| Blue | `#2563EB` | primary action and gradient midpoint |
| Cyan | `#38BDF8` | gradient endpoint and telemetry accents |
| White | `#FFFFFF` | light surface and inverse content |

Provisioning copies these files into the seed repository under
`site/public/dev10x/` before its initial commit. Every generated workspace
therefore receives identical local assets without network access.

The canonical prompt requires:

- a visible Dev10x image logo in the navigation or hero;
- the official icon/favicon;
- the exact palette above as the primary identity;
- Dev10x/DEV10X/dev10x naming and rewritten product copy;
- no visible Symphony product branding;
- no replacement, redrawing or AI recreation of the logo;
- no remote image dependency.

The collector hashes the source and generated brand files. A cell fails its
contract when a required asset is missing or has different bytes.

## Execution and Provenance

All six cells use the same prompt hash, seed commit and validation commands.
The only variables are execution path and provider/model.

Successful cells must prove:

1. requested provider, model and effort match the matrix;
2. provider-confirmed model and effort match the request;
3. Cursor resolves to `cursor-grok-4.5-high`; its separate effort remains null;
4. the canonical provider conversation belongs to the completed execution;
5. the generated site build passes;
6. focused Playwright E2E passes over a real isolated HTTP preview;
7. the brand asset hash contract passes;
8. canonical evidence is complete and rendered by the real Evidence tab.

There is no provider fallback, mock result, synthetic success or silent new
conversation. A failed cell remains failed until its real failure is understood
and either fixed or documented.

## Screenshot, Video and Trace Contract

Each completed cell produces at least six standardized PNGs:

1. desktop hero at 1280 × 720;
2. full desktop page at 1280 px width;
3. full mobile page at 390 px width;
4. the `#fluxo` section;
5. the `#evidencias` section;
6. the persisted run rendered in Symphony's Evidence tab.

Each cell also preserves:

- the generated Playwright WebM;
- an H.264/yuv420p/fast-start MP4;
- a small GIF preview linked to the MP4;
- the canonical Playwright trace ZIP;
- build and E2E reports;
- the real Symphony journey artifact and attempt metadata.

Screenshots and video are captured only after build, E2E, model provenance and
brand contracts pass.

## Reports and Decision

The new PR publishes:

- `README.md`: evidence index and headline counts;
- `comparison.json`: sanitized machine-readable dataset;
- `comparison.md`: requested/resolved provenance and validation per cell;
- `execution-report.md`: timings, attempts, failures and recoveries;
- `evidence-audit.md`: dimensions, codecs, traces, asset hashes and rendered
  Evidence-tab media;
- `visual-comparison.md`: inline six-site gallery and video previews;
- `evaluation.md`: rubric, scores, ranking and final decision.

The 100-point rubric is:

| Criterion | Points |
| --- | ---: |
| Dev10x brand fidelity and asset use | 25 |
| Visual craft and editorial distinction | 20 |
| Information architecture and copy clarity | 15 |
| Responsive behavior and accessibility | 20 |
| Technical quality and verifiable evidence | 20 |

No winner is selected until all six cells have complete, audited evidence.
The final decision identifies the overall winner, the strongest session and
orchestrator outputs, trade-offs, reusable patterns and the recommended visual
direction for Dev10x.

## Failure and Recovery Policy

- Run at most three cells concurrently to protect WSL resources.
- Do not run the complete heavy Elixir unit suite locally.
- Use only benchmark Node tests and focused backend tests related to any runtime
  correction.
- Preserve every immutable attempt.
- Retry only a cell with a confirmed terminal provider/runtime failure.
- Resume the provider's canonical conversation when recovery is valid.
- If the provider reports the conversation missing, park the cell and require an
  explicit reset rather than starting another conversation silently.
- Always terminate preview servers, provider processes and orchestrator workers
  before collection exits.

## Completion Criteria

The work is complete only when:

- the branch is based on the current `origin/main`;
- the focused matrix contains exactly six unique cells;
- all six sites use byte-identical canonical Dev10x assets;
- all six model provenance contracts pass;
- all six builds and focused E2Es pass;
- all required PNG, MP4, WebM and trace artifacts exist and are valid;
- the Evidence tab renders every persisted screenshot and video;
- reports contain no secrets, broken links or local-only paths;
- the PR includes the detailed matrix, inline screenshots and video links;
- the evidence-backed decision is published.
