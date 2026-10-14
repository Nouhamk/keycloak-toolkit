# Contributing

- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
- Business logic must not import `vscode`; unit test it with Vitest.
- Anything touching Keycloak needs an integration test against `docker compose up`.
- Run `npm run lint && npm run typecheck && npm test && npm run test:integration` before a PR.
- Never log tokens or secrets; route all output through `redact()`.
- Do not copy code from repos without a compatible license (MIT/Apache) and attribution in `NOTICE`.
