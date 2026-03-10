# OAuth support: architecture decision (ADR-style issue)

## Context
Today, adapters primarily authenticate with static API keys. We want to support an OAuth-based “connect your provider account” experience where possible, while keeping the `ai-providers` surface area stable and avoiding secret leakage in logs.

OAuth feasibility and best-practice flows differ by provider:
- Some providers may not offer end-user OAuth for API usage at all (API key only).
- Google has strong OAuth tooling and also supports service accounts / workload identity.
- Some providers may support org-wide OAuth or marketplace-style OAuth with constrained scopes.

## Decision to make
Define a single authentication abstraction that:
- works for providers that support OAuth access tokens (and refresh tokens)
- falls back cleanly to API keys where OAuth isn’t available
- preserves existing adapter ergonomics (ideally minimal breaking changes)

## Candidate auth flows (to evaluate)
1) **Authorization Code + PKCE (recommended for web + SPA)**
   - Best UX; avoids client secrets in browser.
   - Requires redirect URI management.

2) **Device Authorization Grant (CLI / TV-style)**
   - Good for local tooling or headless environments.
   - Requires provider support.

3) **Service-to-service credentials** (Google service accounts / workload identity)
   - Not end-user OAuth, but often the correct model for server deployments.

4) **“Bring-your-own key”** (non-OAuth fallback)
   - Keep API key support with encryption-at-rest.

## Token storage & lifecycle
Define requirements for any component that stores tokens:
- Encrypt at rest (KMS or libsodium/age; key material not committed).
- Store **refresh tokens** only when required; otherwise store short-lived access tokens.
- Track metadata: provider, user/team, scopes, createdAt, lastUsedAt, expiresAt.
- Support rotation and revocation.

## Security constraints
- Never log raw access tokens, refresh tokens, or API keys.
- Redact `Authorization` and common token fields in debug payloads (already partially covered in `utils/provider-debug.cjs`).
- Use `state` param validation, PKCE verifier/challenge, and CSRF protections.
- Restrict redirect URIs (allowlist), enforce HTTPS in production.
- Principle of least privilege: request minimal scopes.
- Audit log: connect/disconnect events.

## Integration boundaries (what belongs where)
- **In this repo (`ai-providers`)**:
  - Adapters should accept an auth token (API key or OAuth access token) as an input and send correct headers.
  - Debug payloads must remain sanitized.
- **Outside this repo (app/service)**:
  - OAuth initiation, callback handling, token exchange/refresh, storage.

## Acceptance criteria
- Documented decision (can live as a markdown ADR in `.issues/` or promoted later):
  - Selected primary flow(s) per platform (web/cli/server).
  - Explicit “supported providers” matrix: OAuth / no OAuth / service-account.
  - Final interface proposal for passing auth into adapters (e.g. keep `apiKey` as “authToken”, or introduce `auth: { type, token }`).
- Security checklist written and signed off (at least in issue form).
- Test strategy defined for:
  - token redaction
  - state/PKCE validation
  - refresh + rotation

## Test plan (for future implementation)
- Unit tests for redaction and token handling.
- Integration tests with mocked OAuth server.
- Manual end-to-end: connect provider, store token, run a completion, revoke, ensure failures surface with sanitized debug.
