# NepFleet UI

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Serraniel/nepfleet-ui/badge)](https://scorecard.dev/viewer/?uri=github.com/Serraniel/nepfleet-ui)

The optional web frontend for [NepFleet](https://github.com/Serraniel/nepfleet). It is a static app, and one instance can manage **several backends**, for example your home network and your cloud servers, from one place.

- Light and dark mode, and works on mobile.
- Never a dead end: every stack can always be edited as raw YAML. The visual editors (services, volumes, networks, variables) are a split view over the same text.
- No server of its own. Your browser talks to each backend directly, and each backend must allow this UI's origin (`nepfleet serve --allowed-origins https://ui.example.org`).

> **Status: early development.** Adding backends and checking their status works. Everything else is planned in [milestones](https://github.com/Serraniel/nepfleet-ui/milestones).

## Run

```sh
docker run -p 8080:8080 ghcr.io/serraniel/nepfleet-ui:latest   # or :edge
```

Or deploy it as a NepFleet stack behind Caddy.

## Develop

```sh
npm ci
npm run dev      # http://localhost:5173
npm run check && npm test
npx playwright install chromium   # once
NEPFLEET_BIN=$(go env GOPATH)/bin/nepfleet npm run test:e2e   # UI + real backend, with axe
```

Architecture, security model and the release process are documented once, in the [backend repository](https://github.com/Serraniel/nepfleet/tree/main/docs). PR titles follow Conventional Commits.

License: [AGPL-3.0-or-later](LICENSE).

## Desktop app

`src-tauri/` wraps this frontend in a [Tauri](https://tauri.app) window for Linux, Windows and macOS. It connects to the local control daemon by itself, so there's no token to paste. Closing the window hides it to the tray icon (Open NepFleet, Quit), and starting the app again brings it back, also on desktops without a tray. The daemon and its tunnels keep running either way, even after quitting.

```sh
npm run tauri dev     # needs Rust, and on Linux WebKitGTK 4.1
npm run tauri build
```

It needs the `nepfleet` command next to the app or on `PATH`. The window has no shell or file access: its only command is starting the daemon, with fixed arguments.

### Installers

Each release has installers that include the `nepfleet` command, taken from nepfleet's latest release after checking its signed checksums:

| System                       | Files                              |
| ---------------------------- | ---------------------------------- |
| Linux (x86-64, arm64)        | `.deb`, `.rpm`, `.AppImage`        |
| Windows (x86-64)             | `.msi`, `-setup.exe`               |
| macOS (Apple silicon, Intel) | `.dmg`                             |
| Arch Linux                   | [`packaging/arch`](packaging/arch) |

Each system's checksums are signed (`*.SHA256SUMS` with a `.sigstore.json` bundle), and can be checked with cosign:

```sh
cosign verify-blob --bundle nepfleet-desktop_<version>_linux_amd64.SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/Serraniel/nepfleet-ui/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  nepfleet-desktop_<version>_linux_amd64.SHA256SUMS
```

The installers aren't code-signed yet. So Windows SmartScreen warns about an unknown publisher ("More info", then "Run anyway"). macOS refuses an app from an unknown developer: open it with right-click, Open, or allow it under System Settings, Privacy & Security.
