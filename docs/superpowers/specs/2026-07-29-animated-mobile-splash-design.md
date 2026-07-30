# Animated mobile splash screen design

## Goal

Give the Dev10x mobile app a more energetic opening while keeping the startup
path fast and free of visual flashes. The animation uses converging lightning
to reveal the Dev10x mark directly, without an introductory static logo.

## Scope

- Keep the existing static Expo-native splash for the period before React Native
  is ready.
- Add an in-app animated splash overlay immediately after the native splash.
- Retain the current dark brand background (`#090A0F`) and existing mark asset.
- Respect reduced-motion system preferences.

Out of scope: changing the canonical brand assets, the app icon, or app startup
and connection behavior unrelated to the splash.

## Experience

The native splash remains visible until connection storage hydration completes.
The app then replaces it with an in-app overlay on the same background, avoiding
a blank frame. The overlay does not show a preliminary wordmark or small logo.
Instead, three blue, violet, and pink lightning bolts enter from separate edges
and converge at the centre of the screen. Their impact reveals the large Dev10x
mark, which receives a short glow and scale pulse before settling.

The animation runs for roughly 900 ms. If hydration or the initial route is
still resolving, the final logo state remains visible; the app never holds the
user on a looping animation. If reduced motion is enabled, the overlay presents
the large mark without lightning or scale impact and hands off immediately.

## Architecture

Create a focused `AnimatedSplash` component near the mobile app shell. It owns
only presentation state and exposes an `onFinished` callback.

`ThemedStack` retains ownership of startup readiness. It will:

1. wait for connection storage hydration;
2. reveal `AnimatedSplash` before hiding the static Expo splash;
3. hide the native splash after the animated overlay is mounted;
4. render the navigation stack only after the overlay reports completion.

The component uses the installed `react-native-reanimated` runtime. Lightning
bolts and the impact glow are rendered with `react-native-svg` so their motion
is deterministic and does not require new dependencies or network resources.

## Failure handling

The native splash hide remains best-effort, as it is today. Animation completion
must have a timer-independent fallback so an interrupted or unavailable
animation cannot block navigation. The overlay uses only bundled logo assets;
there is no asset-fetch failure path.

## Validation

- Unit tests cover the readiness handoff: native splash stays held before
  hydration, then is hidden only after the animated overlay mounts.
- Component tests cover normal completion, the absence of a preliminary logo,
  and the reduced-motion shortcut.
- Existing native-brand asset tests continue to verify the static fallback
  splash and asset generation contract.
- Run the relevant mobile unit/UI tests, TypeScript checking, and formatting
  checks before handoff.
