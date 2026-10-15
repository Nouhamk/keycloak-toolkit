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
- **Get Token** (key icon on a client, or `Keycloak: Get Token`): client credentials,
  authorization code + PKCE (browser login), device code, and the legacy password grant
  (off by default, `keycloak.tokens.allowPasswordGrant`).
- **Token Playground**: decoded header and payload, signature check against the realm keys,
  expiry countdown, roles / scopes / audience / groups at a glance, explained claims.
  Refresh, Introspect, Userinfo, copy as `Authorization` header or curl.
- **Keycloak: Decode JWT**: select a token in any editor (or paste one) to open it in the
  playground. Works without a connection; the signature is checked if the issuer is reachable.
- **Realm as code** (read-only):
  - **Pull Realm to File** (right-click a realm): exports realm settings, clients, roles,
    groups, client scopes and flows into a clean, diff-friendly JSON file. Real users are
    never exported, secrets are masked, server-generated ids are removed and lists are sorted.
  - **Compare with Live Realm** (right-click a `.json` file): side-by-side diff of your file
    and the realm on any connection. Changing one setting shows exactly one changed line.
  - **Compare Two Realms** (e.g. staging vs prod).
  - Validation and autocomplete for `*.realm.json`, `*-realm.json`, `realm-export.json`, and
    keycloak-config-cli `*.realm.yaml` files (YAML needs the Red Hat YAML extension).

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
- Realm as code: apply changes to a server, with preview and confirmation
- AI assistant tools (read-only, secrets always masked)
- One-click local Keycloak
- Client configuration snippets (Spring Boot, Node, Python, oauth2-proxy, Kubernetes)
- Login theme preview

## Security

Secrets live only in VS Code SecretStorage; all output is redacted. Write actions are off
by default and are the user's responsibility. No telemetry.

## License

Apache-2.0
