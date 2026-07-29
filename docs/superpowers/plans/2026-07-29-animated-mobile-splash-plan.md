# Animated Mobile Splash Implementation Plan

**Goal:** Replace the abrupt mobile startup handoff with an energetic, accessible
Dev10x logo reveal driven by a travelling energy line.

**Architecture:** Keep Expo's static splash visible until React Native is
mounted, then render a dedicated `AnimatedSplash` overlay on the identical
background. `ThemedStack` controls the native-splash handoff and releases the
router after the overlay finishes; the new component owns only animation and
reduced-motion presentation.

**Tech Stack:** Expo 55, React Native 0.83, TypeScript, React Native Reanimated
4, react-native-svg, Jest, React Native Testing Library.

---

## File map

- Create `mobile/src/dev10x/components/AnimatedSplash.tsx`: bundled-logo,
  energy-line, and reduced-motion overlay.
- Create `mobile/src/dev10x/components/AnimatedSplash.test.tsx`: behavioral
  tests for completion and motion accessibility.
- Modify `mobile/app/_layout.tsx`: mount the overlay before hiding the static
  native splash and defer stack rendering until completion.
- Modify `mobile/scripts/generate-native-brand-assets.test.ts`: retain a
  source-level regression assertion for the native-splash startup contract.

### Task 1: Lock the overlay contract with tests

**Files:**
- Create: `mobile/src/dev10x/components/AnimatedSplash.test.tsx`

- [x] **Step 1: Write the failing completion test**

```tsx
it("calls onFinished after the energy-line reveal", () => {
  const onFinished = jest.fn();
  render(<AnimatedSplash onFinished={onFinished} />);

  act(() => jest.runAllTimers());

  expect(onFinished).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Dev10x is starting")).toBeTruthy();
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
cd mobile && npx jest src/dev10x/components/AnimatedSplash.test.tsx --runInBand
```

Expected: FAIL because `AnimatedSplash` does not yet exist.

- [x] **Step 3: Add the failing reduced-motion test**

```tsx
it("skips the energy-line animation when reduced motion is enabled", () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  const onFinished = jest.fn();
  render(<AnimatedSplash onFinished={onFinished} />);

  expect(screen.getByLabelText("Dev10x is starting")).toBeTruthy();
  expect(onFinished).toHaveBeenCalledTimes(1);
});
```

### Task 2: Build the isolated animated overlay

**Files:**
- Create: `mobile/src/dev10x/components/AnimatedSplash.tsx`
- Test: `mobile/src/dev10x/components/AnimatedSplash.test.tsx`

- [x] **Step 1: Implement the minimal overlay**

Render a full-screen `Animated.View` using `#090A0F`, an SVG path whose
`strokeDashoffset` is driven from one to zero over 620 ms, the existing
`dev10x_logo_white.png`, and a small final scale animation. Use a 900 ms JS
completion timeout as the handoff contract; clear it on unmount and guard the
callback so it fires once. Query `AccessibilityInfo.isReduceMotionEnabled()`
on mount and complete immediately when it is true.

- [x] **Step 2: Run the component test and verify GREEN**

Run:

```bash
cd mobile && npx jest src/dev10x/components/AnimatedSplash.test.tsx --runInBand
```

Expected: PASS with two tests.

### Task 3: Connect the native and animated splash layers

**Files:**
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/scripts/generate-native-brand-assets.test.ts`

- [x] **Step 1: Write the failing startup-contract assertion**

Extend the existing native-assets test so it requires `AnimatedSplash`, a
state value controlling its visibility, and `hideAsync` after the overlay is
mounted. Keep `preventAutoHideAsync` and the hydration guard as existing
requirements.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
cd mobile && npx vitest run scripts/generate-native-brand-assets.test.ts
```

Expected: FAIL because the app shell has no animated overlay handoff.

- [x] **Step 3: Implement the handoff**

In `ThemedStack`, wait for `hydrated`, mount `AnimatedSplash`, then call
`SplashScreen.hideAsync()` in the overlay's layout callback. Keep navigation
mounted behind the overlay so route resolution continues, but hide its content
until `onFinished` changes the shell state. Make each native-splash and
completion operation idempotent using refs.

- [x] **Step 4: Run focused tests and verify GREEN**

```bash
cd mobile && npx jest src/dev10x/components/AnimatedSplash.test.tsx --runInBand
cd mobile && npx vitest run scripts/generate-native-brand-assets.test.ts
```

Expected: PASS.

### Task 4: Verify the feature

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-animated-mobile-splash-plan.md`

- [ ] **Step 1: Run static and targeted verification**

```bash
cd mobile && npm run typecheck
cd mobile && npm run lint
cd mobile && npm run format:check
```

- [x] **Step 2: Inspect the final diff**

Confirm the existing native splash remains configured, the new overlay uses
only bundled assets, completion is one-shot, and reduced-motion avoids the
travelling energy line.

- [ ] **Step 3: Commit the completed implementation**

```bash
git add mobile/app/_layout.tsx \
  mobile/src/dev10x/components/AnimatedSplash.tsx \
  mobile/src/dev10x/components/AnimatedSplash.test.tsx \
  mobile/scripts/generate-native-brand-assets.test.ts \
  docs/superpowers/plans/2026-07-29-animated-mobile-splash-plan.md
git commit -m "feat(mobile): animate splash logo reveal"
```

## Validation record

- `npx jest src/dev10x/components/AnimatedSplash.test.tsx --runInBand` passed
  (2 tests).
- `npx vitest run scripts/generate-native-brand-assets.test.ts --testNamePattern
  "configures every native icon"` passed (the startup contract assertion).
- `npm run lint` passed and `oxfmt --check` passed for the changed TypeScript
  files.
- The repository-wide typecheck has five pre-existing typed-route errors in
  `app/h/[hostId]/index.tsx`, `app/h/[hostId]/session/[worktreeId].tsx`, and
  `src/dev10x/routes/HomeRoute.tsx`; it reported none in the splash files.
- The full native-asset test cannot run in this environment because the required
  ImageMagick `convert` executable is not installed.
