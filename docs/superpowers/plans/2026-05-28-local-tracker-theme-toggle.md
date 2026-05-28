# Local Tracker Theme Toggle Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo's real tools (package manager, test runner, linter).

**Goal:** Add Tracker's light, dark, and system theme selector with persisted local preference and guarded browser APIs.

**Architecture:** Keep theme state in a dedicated React component that owns localStorage reads/writes, DOM root class updates, and system color-scheme listeners. Reuse Tracker's shadcn/Radix UI wrapper pattern for a dropdown menu and render the toggle in the existing sidebar action area.

**Tech Stack:** React, TypeScript, Vite, Vitest/jsdom, Tailwind, Radix Dropdown Menu.

---

## File Map

- Create: `tracker/src/components/ui/dropdown-menu.tsx` for the Radix DropdownMenu wrapper.
- Create: `tracker/src/components/theme/ThemeToggle.tsx` for theme persistence and DOM application.
- Create: `tracker/src/components/theme/__tests__/ThemeToggle.test.tsx` for focused behavior tests.
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx` to render the toggle near the reset-token action.
- Modify: `tracker/package.json` and `tracker/package-lock.json` to add `@radix-ui/react-dropdown-menu`.

## Task 1: ThemeToggle Behavior Tests

**Files:**
- Create: `tracker/src/components/theme/__tests__/ThemeToggle.test.tsx`
- Test: `tracker/src/components/theme/__tests__/ThemeToggle.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests that mock `window.matchMedia`, reset `document.documentElement.classList`, clear `localStorage`, render `<ThemeToggle />`, and assert:

```tsx
it("applies a valid stored theme on initial render", () => {
  window.localStorage.setItem("tracker-theme", "dark");
  render(<ThemeToggle />);
  expect(document.documentElement).toHaveClass("dark");
  expect(document.documentElement).not.toHaveClass("light");
});

it("falls back to system when the stored theme is invalid or missing", () => {
  mockPrefersDark(false);
  window.localStorage.setItem("tracker-theme", "sepia");
  render(<ThemeToggle />);
  expect(document.documentElement).toHaveClass("light");
});

it("selecting Light, Dark, and System stores the choice and updates the root class", () => {
  mockPrefersDark(true);
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Light" }));
  expect(window.localStorage.getItem("tracker-theme")).toBe("light");
  expect(document.documentElement).toHaveClass("light");
});
```

- [ ] **Step 2: Run focused test to verify RED**

Run: `npm test -- src/components/theme/__tests__/ThemeToggle.test.tsx`

Expected: FAIL because `ThemeToggle` does not exist yet.

## Task 2: Dropdown Dependency and UI Wrapper

**Files:**
- Create: `tracker/src/components/ui/dropdown-menu.tsx`
- Modify: `tracker/package.json`
- Modify: `tracker/package-lock.json`

- [ ] **Step 1: Add dependency**

Run: `npm install @radix-ui/react-dropdown-menu@latest`

Expected: `@radix-ui/react-dropdown-menu` appears in `dependencies` and the lockfile.

- [ ] **Step 2: Add shadcn-style wrapper**

Create `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem` exports using `@radix-ui/react-dropdown-menu`, `React.forwardRef`, and `cn`.

## Task 3: ThemeToggle Implementation

**Files:**
- Create: `tracker/src/components/theme/ThemeToggle.tsx`
- Test: `tracker/src/components/theme/__tests__/ThemeToggle.test.tsx`

- [ ] **Step 1: Implement guarded theme helpers and component**

Add a `Theme = "light" | "dark" | "system"` union, `TRACKER_THEME_STORAGE_KEY = "tracker-theme"`, safe localStorage reads/writes with `try/catch`, invalid-value fallback to `system`, idempotent root class updates, and a `matchMedia("(prefers-color-scheme: dark)")` change listener only while theme is `system`.

- [ ] **Step 2: Run focused test to verify GREEN**

Run: `npm test -- src/components/theme/__tests__/ThemeToggle.test.tsx`

Expected: PASS for the new focused tests.

## Task 4: Sidebar Integration and Verification

**Files:**
- Modify: `tracker/src/components/layout/ProjectSidebar.tsx`
- Test: `tracker/src/components/theme/__tests__/ThemeToggle.test.tsx`

- [ ] **Step 1: Render toggle in the sidebar action area**

Import `ThemeToggle` and place it beside the reset-token button at the bottom of `ProjectSidebar`, preserving the existing reset-token behavior.

- [ ] **Step 2: Run verification**

Run: `npm test -- src/components/theme/__tests__/ThemeToggle.test.tsx`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with no lint errors.

Run: `npm run build`

Expected: PASS with TypeScript and Vite build success.
