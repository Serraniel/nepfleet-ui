# NepFleet UI

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
