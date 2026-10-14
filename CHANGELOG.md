# Changelog

## [Unreleased]

### Added

- `Keycloak: Add Connection` wizard (admin user or service account), tested before saving,
  shows the server version. Secrets stored only in SecretStorage.
- Explorer view: Connections > Realms > Clients / Users / Realm Roles / Groups, lazy-loaded,
  refreshable, with a filter.
- Production-tagged connections show a red badge and are read-only unless unlocked for the session.

- Project scaffold (esbuild, ESLint, Prettier, Vitest, CI, docker-compose demo realm).
- `Keycloak: Decode JWT` command (offline decode).
- `redact()` utility and redacting logger.
