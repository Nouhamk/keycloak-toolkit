# Changelog

## [Unreleased]

### Added

- Explain Access: pick a user, client and role to see _why_ the user has the role (direct, group,
  parent group or composite paths drawn as a diagram), which groups would grant it if missing, and
  whether it actually reaches the access token (scope mappings, `fullScopeAllowed`).
- Redesigned Token Playground: summary cards, expiry ring, jwt.io-style coloured token, tabs.
- Realm as code: `Pull Realm to File`, `Compare with Live Realm`, `Compare Two Realms`.
  Exports are normalized (ids removed, keys and lists sorted, secrets masked, no real users)
  so diffs only show meaningful changes.
- JSON schema for realm files and keycloak-config-cli YAML.

- Token Playground: get a token for any client (client credentials, authorization code +
  PKCE via a one-shot 127.0.0.1 callback, device code, opt-in password grant); view decoded
  tokens, signature verification against the realm JWKS, expiry countdown, annotated claims;
  refresh, introspect, userinfo, copy as header or curl.
- `Keycloak: Decode JWT` now opens the playground and verifies the signature when the issuer
  is reachable. Also available from the editor context menu.
- Settings: `keycloak.tokens.scope`, `keycloak.tokens.allowPasswordGrant`.
- Demo realm: device grant enabled on `reports-spa`.
- `Keycloak: Add Connection` wizard (admin user or service account), tested before saving,
  shows the server version. Secrets stored only in SecretStorage.
- Explorer view: Connections > Realms > Clients / Users / Realm Roles / Groups, lazy-loaded,
  refreshable, with a filter.
- Production-tagged connections show a red badge and are read-only unless unlocked for the session.

- Project scaffold (esbuild, ESLint, Prettier, Vitest, CI, docker-compose demo realm).
- `Keycloak: Decode JWT` command (offline decode).
- `redact()` utility and redacting logger.
