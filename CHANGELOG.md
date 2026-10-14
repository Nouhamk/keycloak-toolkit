# Changelog

## [Unreleased]

### Added

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
