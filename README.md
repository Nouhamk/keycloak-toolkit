# Toolkit for Keycloak (VS Code)

> **Unofficial community project.** Not affiliated with or endorsed by the Keycloak project.
> Keycloak is a trademark of the Linux Foundation.

Everyday Keycloak developer workflows inside VS Code: token playground, JWT decoding,
realm-as-code diff, local Keycloak and more.

## Status

Phase 0 (scaffold). Available today: **Keycloak: Decode JWT** (offline decode of a selected token).

## Quick start (development)

```sh
npm install
docker compose up -d          # Keycloak on :8080 (admin/admin) with the demo realm
npm test                      # unit tests
npm run test:integration      # against the docker stack
npm run build                 # then press F5 in VS Code
```

Demo realm: clients `reports-backend` (confidential) and `reports-spa` (public + PKCE),
users `alice` / `bob` (password = username), groups `analysts` / `admins`.

## Roadmap

1. Connections + Explorer 2. Token Playground 3. Realm-as-Code diff 4. AI tools
2. Local Keycloak 6. Snippets 7. Theme dev 8. OpenFGA bridge

## Security

Secrets live only in VS Code SecretStorage; all output is redacted. Write actions are off
by default and are the user's responsibility. No telemetry.

## License

Apache-2.0
