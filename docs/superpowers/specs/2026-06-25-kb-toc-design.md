# KB Editor Table of Contents (TOC) - Design

> Adds a Notion-like "table of contents" to the KB Tiptap editor, inspired by the
> [Tiptap Notion-like demo](https://tiptap.dev/). A button in the editor header
> toggles a panel that lists the document's headings; clicking an entry scrolls to
> that section and the active section is highlighted live as the user scrolls.

## 1. Problem

The KB editor (`tracker/src/components/kb/KbEditor.tsx`) renders long Markdown
documents in a centered column with no quick way to see the document outline or
jump between sections. The Tiptap demo provides the desired UX: a heading
outline that stays in sync with the document and lets you navigate by clicking.

Tiptap's own demo uses `@tiptap-pro/extension-table-of-contents`, which is a
paid Tiptap Cloud extension requiring an authenticated private npm registry
token. This project only depends on the free, open `@tiptap/*` packages, so the
TOC will be built in-house with no new dependency, reusing the existing custom
component patterns (`KbBlockHandle`, `KbSpacerParagraph`).

## 2. Goals

1. Provide a **document outline** of the open KB page derived from its headings.
2. **Navigate by clicking** an outline entry: smooth-scroll to that heading.
3. **Live active-section highlighting** that follows the scroll position.
4. Add **no new runtime dependency**; build on the installed `@tiptap/*` stack.
5. Avoid conflict with the right-side assistant panel/launcher by anchoring the
   TOC to a **header toggle button** (decided with the user).

## 3. Non-Goals

- No always-visible floating right-rail TOC (rejected: conflicts with the
  assistant panel and launcher).
- No heading anchors persisted to Markdown / no slug generation in the saved
  file. The TOC is a runtime/editor affordance only.
- No deep nesting beyond the chosen heading levels (see Decisions).
- No TOC for read-only Markdown viewers outside the KB editor.

## 4. Decisions (confirmed with user)

| Topic | Decision |
| --- | --- |
| Placement | **Header toggle button** that opens a panel anchored under it (top-right of the editor), next to the existing "Ask AI" button. |
| Heading levels | **H1, H2 and H3** (indented by level; H4+ excluded). |
| Active highlighting | **Live** — updates as the user scrolls while the panel is open (Tiptap-demo behavior). |
| Open/close model | Custom controlled popover (NOT an auto-closing dropdown). Closes on button toggle, `Escape`, or outside `pointerdown`. **Document scroll does NOT close it** — required for live highlight. Clicking an entry scrolls but **keeps the panel open**. |
| Empty state | When the document has **fewer than 1 heading**, the header button is **hidden**. With headings but a heading whose text is empty, show a localized "Untitled" placeholder for that entry. |

### Why a custom popover, not Radix dropdown

A standard dropdown/popover closes on outside interaction, including scroll. Live
active-section highlighting requires the panel to stay open while the user
scrolls the editor, so the panel is a controlled element with explicit close
rules that exclude scroll. This mirrors the existing `KbBlockHandle` popover
implementation (outside `pointerdown` capture + `Escape`).

## 5. Architecture

Three new/changed pieces, each with a single responsibility:

### 5.1 `useKbHeadings` hook — `tracker/src/components/kb/useKbHeadings.ts`

**Responsibility:** derive the heading outline from the editor document and keep
it current as the document changes.

- Signature: `useKbHeadings(editor: Editor | null): HeadingItem[]`.
- `HeadingItem = { pos: number; level: 1 | 2 | 3; text: string }`.
- Implementation: subscribe to the editor `create` and `update` events. On each
  (debounced ~200ms to avoid per-keystroke churn), walk the doc:
  `editor.state.doc.descendants((node, pos) => { if (node.type.name === "heading" && [1,2,3].includes(node.attrs.level)) collect({ pos, level, text: node.textContent.trim() }); })`.
- Returns a **stable-reference** array (only replaced when the serialized outline
  actually changes) so consumers don't re-run observers needlessly. Compare by a
  cheap signature string (`level|text|pos` joined).
- Cleans up listeners on unmount / editor change.
- Edge cases: editor null → `[]`; heading with empty text → kept with `text: ""`
  (UI renders the "Untitled" placeholder); levels other than 1/2 → ignored.

### 5.2 `KbTableOfContents` component — `tracker/src/components/kb/KbTableOfContents.tsx`

**Responsibility:** render the toggle button + outline panel, handle navigation
and live active-section highlighting.

- Props:
  - `editor: Editor` (required).
  - `scrollContainerRef: React.RefObject<HTMLElement | null>` — the `.kb-editor`
    overflow container, used as the `IntersectionObserver` root and as the
    scroll target context.
- Reads `headings = useKbHeadings(editor)`.
- **Visibility:** if `headings.length < 1`, render `null` (button hidden).
- **Button:** `type="button"` styled like the existing header buttons (same
  classes as the "Ask AI" button), icon `List` (lucide-react), `aria-pressed`
  bound to open state, `aria-label`/`title` = `t("kb.editor.toc.button")`.
- **Panel:** absolutely positioned card (`bg-popover border shadow-md rounded-lg`,
  `max-h`, `overflow-y-auto`, `z-50`) anchored under the button (top-right). Root
  `role="navigation"`, `aria-label = t("kb.editor.toc.label")`.
  - One button per heading. Indentation by level: H1 no indent, H2 `pl-6`, H3 `pl-10`.
    Active entry gets an emphasis class (e.g. `text-foreground font-medium` +
    left accent), inactive `text-muted-foreground`.
  - Empty text → render `t("kb.editor.toc.untitled")` in muted italics.
  - Entry key: `String(pos)` (positions are unique within a doc snapshot).
- **Navigation (click entry):**
  - Resolve the heading DOM node from ProseMirror: `editor.view.nodeDOM(pos)`
    (fallback: `editor.view.domAtPos(pos + 1).node` walked up to the element).
  - `node.scrollIntoView({ behavior: "smooth", block: "start" })`.
  - Move the selection there for keyboard continuity:
    `editor.chain().setTextSelection(pos + 1).run()` (no `.focus()` so the panel
    keeps DOM focus and stays open).
  - Panel stays open.
- **Live highlight (`IntersectionObserver`):**
  - Effect runs while `open === true` and re-runs when `headings` changes.
  - Query heading elements within the scroll container in document order:
    `scrollContainerRef.current.querySelectorAll(".kb-prose h1, .kb-prose h2, .kb-prose h3")`.
    Document order matches the `headings` array order (PM doc order === DOM
    order), so map by index.
  - Observe each element with the scroll container as `root`,
    `rootMargin: "0px 0px -70% 0px"` so the "active" heading is the last one
    whose top has crossed the upper portion of the viewport.
  - Maintain `activeIndex` state; update on intersection changes by choosing the
    last intersecting (or last passed) heading.
  - Disconnect the observer on close / cleanup.
- **Close rules (custom):** outside `pointerdown` (capture) not within the panel
  or button → close; `Escape` → close; button toggle → toggle. Scroll does not
  close. Pattern copied from `KbBlockHandle`.

### 5.3 `KbEditor.tsx` wiring

- Add a `scrollContainerRef` (`useRef<HTMLDivElement>(null)`) and attach it to the
  existing `.kb-editor` overflow container `div`.
- Render `<KbTableOfContents editor={editor} scrollContainerRef={scrollContainerRef} />`
  in the header, guarded by `editor`, placed just before the "Ask AI" button so
  the order reads: TOC · Sync · Ask AI · actions · Save.

## 6. Data Flow

```
editor doc ──update(debounced)──▶ useKbHeadings ──HeadingItem[]──▶ KbTableOfContents
                                                                     │
                            click entry ──▶ nodeDOM(pos).scrollIntoView + setTextSelection
                                                                     │
   scroll container ──IntersectionObserver(root=container)──▶ activeIndex ──▶ highlight
```

## 7. Styling

- Reuse existing tokens: `bg-popover`, `border`, `shadow-md`, `rounded-lg`,
  `text-muted-foreground`, `hover:bg-accent`, matching `KbBlockHandle` and the
  header buttons. No new global CSS unless an accent bar needs it; prefer Tailwind
  utilities inline.
- Panel width ~`w-64`, `max-h-[60vh]`, scroll with `scrollbar-discrete` (already
  used by the editor container).

## 8. i18n

Add under `kb.editor.toc` in both `tracker/locales/en/tracker.json` and
`tracker/locales/pt-BR/tracker.json`:

| Key | en | pt-BR |
| --- | --- | --- |
| `kb.editor.toc.button` | "Contents" | "Índice" |
| `kb.editor.toc.label` | "On this page" | "Nesta página" |
| `kb.editor.toc.untitled` | "Untitled" | "Sem título" |

(`empty` key omitted — the button is hidden when there are no headings.)

## 9. Error Handling / Edge Cases

- `editor` null or destroyed → hook returns `[]`, component renders `null`.
- `nodeDOM(pos)` returns null (stale pos after rapid edits) → no-op scroll,
  guarded; never throw.
- No headings / single short doc → button hidden.
- Headings added/removed while panel open → hook updates outline → observer effect
  re-runs and rebinds to the new DOM nodes.
- Duplicate heading text → entries differ by `pos`; navigation still resolves the
  correct node by position.

## 10. Testing

Vitest + React Testing Library, mirroring `KbEditor.test.tsx`.

- **Setup:** add an `IntersectionObserver` stub to `tracker/vitest.setup.ts`
  (jsdom lacks it): a class with `observe/unobserve/disconnect/takeRecords`
  no-ops. `scrollIntoView` is already stubbed.
- **`useKbHeadings`** (or via component): given markdown with `# A`, `## B`,
  `### C`, `#### D`, only A/B/C appear in order; H4+ excluded.
- **`KbTableOfContents`:**
  - Renders the toggle button when headings exist; renders nothing when the doc
    has no headings.
  - Opening the panel lists the H1/H2/H3 entries with correct text and an
    indentation marker (e.g. `data-level` attribute) for H2.
  - Clicking an entry calls `Element.prototype.scrollIntoView` (spy) and moves
    the editor selection; the panel stays open.
  - `Escape` and outside `pointerdown` close the panel.
- **`KbEditor`** existing tests must still pass (button is additive and hidden
  when no headings, so the simple-doc tests are unaffected — note `# Backend` is
  a single H1, which renders the button but does not change save behavior).

## 11. Files

| File | Change |
| --- | --- |
| `tracker/src/components/kb/useKbHeadings.ts` | new hook |
| `tracker/src/components/kb/KbTableOfContents.tsx` | new component |
| `tracker/src/components/kb/KbEditor.tsx` | add `scrollContainerRef`, render TOC in header |
| `tracker/locales/en/tracker.json` | add `kb.editor.toc.*` |
| `tracker/locales/pt-BR/tracker.json` | add `kb.editor.toc.*` |
| `tracker/vitest.setup.ts` | stub `IntersectionObserver` |
| `tracker/src/components/kb/__tests__/KbTableOfContents.test.tsx` | new tests |

## 12. Rollout

Pure additive frontend change, no backend or schema impact. Ships behind no flag;
the button only appears when the open document has headings.
