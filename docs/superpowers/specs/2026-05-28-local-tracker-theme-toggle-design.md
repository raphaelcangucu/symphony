# Local Tracker Theme Toggle Design

**Status:** Draft  
**Date:** 2026-05-28  
**Scope:** Copy SEO Machine admin's light, dark, and system theme control into the Symphony Tracker UI.

---

## 1. Problem

Symphony Tracker already has Tailwind dark-mode variants and CSS variables for `.dark`, but the app does not apply or let users choose a theme. SEO Machine has a small, proven theme toggle that persists the selected theme and follows the operating system when set to `system`.

---

## 2. Goal

Add a faithful Tracker adaptation of SEO Machine's theme behavior:

1. Persist the selected theme as `light`, `dark`, or `system` in `localStorage`.
2. Apply the corresponding `light` or `dark` class to `document.documentElement`.
3. Listen for `prefers-color-scheme` changes while the selected theme is `system`.
4. Expose a sidebar button with a dropdown menu containing `Light`, `Dark`, and `System`.

---

## 3. Non-goals

- Redesigning Tracker colors or Tailwind tokens.
- Changing page-level layouts beyond adding the sidebar control.
- Sharing code directly with SEO Machine across repositories.

---

## 4. Design

Copy the behavior from `seomachine/admin/src/components/ThemeToggle.jsx`, adapted to Tracker's TypeScript code style.

Implementation units:

1. Add `@radix-ui/react-dropdown-menu` so Tracker can use the same menu interaction pattern.
2. Add a reusable `DropdownMenu` UI wrapper that follows the existing shadcn-style component pattern in `tracker/src/components/ui`.
3. Add `ThemeToggle.tsx` under `tracker/src/components/layout` or `tracker/src/components/theme`, using explicit theme types and guarded browser APIs.
4. Render the toggle at the bottom of `ProjectSidebar`, next to the existing reset-token action area.

Failure handling:

- If `localStorage` is unavailable, default to `system` and continue without crashing.
- Ignore invalid persisted values and fall back to `system`.
- Keep the DOM class update idempotent by removing both `light` and `dark` before applying the active theme.

---

## 5. Testing

Add focused React tests for the theme behavior:

1. Initial render respects a valid stored theme.
2. Invalid or missing stored theme falls back to `system`.
3. Selecting `Light`, `Dark`, or `System` updates `localStorage` and the root class.

Run the Tracker test suite or at minimum the new focused test file plus TypeScript/lint checks for touched files.

---

## 6. Self-review

- No placeholders remain.
- Scope is limited to copying SEO Machine theme behavior.
- The dependency addition is explicit and justified by the requested faithful dropdown copy.
- Browser edge cases are called out at the component boundary.
