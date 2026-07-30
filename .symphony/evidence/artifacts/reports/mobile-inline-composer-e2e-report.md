# Mobile inline composer E2E

Result: **passed**

The test exercised the real Symphony application at
`/tracker/projects/symphony-mobile-review/assistant/explore`.

## Covered behavior

- The project header remains on one horizontal row at 390 px.
- Overflowing project navigation remains available through horizontal scroll.
- Add, permission, model, microphone, and the primary action remain inline.
- Sending a real prompt changes the primary action from Send to Stop.
- Stop remains fully visible while `sleep 8` is running.
- Completion returns the primary action to Send and renders `OK`.
- The desktop layout remains free of horizontal overflow.

## Artifacts

- `screens/mobile-inline-composer-idle-mobile.jpg`
- `screens/mobile-inline-composer-running-mobile.jpg`
- `screens/mobile-inline-composer-complete-mobile.jpg`
- `screens/mobile-inline-composer-complete-desktop.jpg`
- `videos/mobile-inline-composer-e2e.webm`
- `videos/mobile-inline-composer-e2e.mp4`
- `traces/mobile-inline-composer-e2e-trace.txt`
- `reports/mobile-inline-focused-unit.txt`

The 18-second walkthrough was captured from 45 frames of the real browser
session at 390x844. The WebM uses VP9/yuv420p and the browser-compatible MP4
uses H.264/yuv420p with fast-start metadata.

## Focused regression suite

Five directly related test files passed with 54 tests.
