# Toolkit for Keycloak (VS Code)

> **Unofficial community project.** Not affiliated with or endorsed by the Keycloak project.
> Keycloak is a trademark of the Linux Foundation.

Everyday Keycloak developer workflows inside VS Code: token playground, JWT decoding,
realm-as-code diff, local Keycloak and more.

## Status

Early development. Available today:

- **Keycloak: Add Connection**: connect with an admin user or a service account; the
  connection is tested before it is saved.
- **Explorer** (Keycloak icon in the activity bar): browse realms, clients, users, roles and
  groups; filter large realms. Production connections are marked red and read-only by default.
- **Keycloak: Decode JWT**: offline decode of a selected token.

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

- Token Playground: get, inspect and verify tokens for any client
- Realm-as-code: compare realm files with a live server or across environments
- AI assistant tools (read-only, secrets always masked)
- One-click local Keycloak
- Client configuration snippets (Spring Boot, Node, Python, oauth2-proxy, Kubernetes)
- Login theme preview
- OpenFGA access checks

## Security

Secrets live only in VS Code SecretStorage; all output is redacted. Write actions are off
by default and are the user's responsibility. No telemetry.

## License

Apache-2.0
