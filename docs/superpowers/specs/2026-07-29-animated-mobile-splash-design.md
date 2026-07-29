# Animated mobile splash screen design

## Goal

Give the Dev10x mobile app a more energetic opening while keeping the startup
path fast and free of visual flashes. The animation uses a luminous energy line
to introduce the existing logo.

## Scope

- Keep the existing static Expo-native splash for the period before React Native
  is ready.
- Add an in-app animated splash overlay immediately after the native splash.
- Retain the current dark brand background (`#090A0F`) and existing logo asset.
- Respect reduced-motion system preferences.

Out of scope: changing the canonical brand assets, the app icon, or app startup
and connection behavior unrelated to the splash.

## Experience

The native splash remains visible until connection storage hydration completes.
The app then replaces it with an in-app overlay on the same background, avoiding
a blank frame. A colored energy line travels through the logo area with a short
glow trail. As the line completes its path, the Dev10x logo receives a brief
scale impact and settles into a stable, fully visible state.

The animation runs for roughly 900 ms. If hydration or the initial route is
still resolving, the final logo state remains visible; the app never holds the
user on a looping animation. If reduced motion is enabled, the overlay presents
the logo without the travelling line or scale impact and hands off immediately.

## Architecture

Create a focused `AnimatedSplash` component near the mobile app shell. It owns
only presentation state and exposes an `onFinished` callback.

`ThemedStack` retains ownership of startup readiness. It will:

1. wait for connection storage hydration;
2. reveal `AnimatedSplash` before hiding the static Expo splash;
3. hide the native splash after the animated overlay is mounted;
4. render the navigation stack only after the overlay reports completion.

The component uses the installed `react-native-reanimated` runtime. The energy
line is rendered with `react-native-svg` so its motion is deterministic and
does not require new dependencies or network resources.

## Failure handling

The native splash hide remains best-effort, as it is today. Animation completion
must have a timer-independent fallback so an interrupted or unavailable
animation cannot block navigation. The overlay uses only bundled logo assets;
there is no asset-fetch failure path.

## Validation

- Unit tests cover the readiness handoff: native splash stays held before
  hydration, then is hidden only after the animated overlay mounts.
- Component tests cover normal completion and the reduced-motion shortcut.
- Existing native-brand asset tests continue to verify the static fallback
  splash and asset generation contract.
- Run the relevant mobile unit/UI tests, TypeScript checking, and formatting
  checks before handoff.
