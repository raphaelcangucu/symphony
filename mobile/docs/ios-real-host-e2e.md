# Dev10x Mobile: iOS real-host handoff

This checklist validates the Dev10x app against real local Symphony hosts. The
mock server is for development only and is not valid E2E evidence.

## Prerequisites

- macOS with the current Xcode and command-line tools
- an Apple development team configured in Xcode
- Node.js 22 and npm
- CocoaPods
- an iPhone and Mac on a network that can reach the Symphony host

Expo Go is not supported for this validation. The project uses Expo SDK 55 and
custom native modules, so install an Expo Development Build on the device.

## Build and start

From the repository:

```bash
cd mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

After the first native install, start Metro for the development client:

```bash
cd mobile
npx expo start --dev-client
```

Use `npx expo start --dev-client --tunnel` only for Metro reachability. The
paired Symphony WebSocket endpoint must still be reachable directly from the
iPhone.

## Pair with a real Symphony host

Start Symphony on the Mac or another reachable machine with a LAN-reachable
host and port. Create a fresh mobile pairing offer whose WebSocket endpoint
uses the machine's LAN hostname or IP, not `localhost`.

Open the offer as a QR code or Dev10x deep link and confirm the host public-key
fingerprint before pairing. Do not paste pairing URLs, device tokens, private
keys, or unredacted logs into the PR.

## iPhone evidence checklist

- [ ] Dev10x onboarding and camera permission render correctly.
- [ ] QR/deep-link pairing creates one device-scoped credential.
- [ ] The credential survives a force-quit via SecureStore/Keychain.
- [ ] Two real hosts show independent identity, connectivity, projects,
      workspaces, sessions, and agents.
- [ ] Background/foreground and a real host restart reconnect automatically.
- [ ] Offline, authentication, protocol-version, and unreachable-host states
      are actionable.
- [ ] Approvals, questions, terminal streams, files, diffs, Git, PRs,
      previews, and notifications route only to the selected host.
- [ ] The xterm WebView accepts the software keyboard and terminal shortcuts.
- [ ] File preview and Source Control work with a real repository.
- [ ] Dev10x Workspace and Compact Sessions share the same selected host and
      connection without pairing again.
- [ ] Notification taps return to the correct host and session.
- [ ] iPad layout is usable in portrait and landscape.

Record a continuous video and a redacted trace. Report the device model, iOS
version, commit SHA, video SHA-256, and any unsupported capability. Do not mark
iOS as passed until every applicable item above has been exercised.
