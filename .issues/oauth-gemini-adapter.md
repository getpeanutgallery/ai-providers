# OAuth support: Gemini adapter (Google)

## Context
The current Gemini adapter uses the Generative Language API with an API key placed in the URL query parameter (`?key=...`). For many deployments, Google OAuth access tokens (or service accounts / workload identity) are preferred.

We should decide whether “Gemini OAuth” means:
- Google OAuth **user consent** flow (Authorization Code + PKCE) yielding refresh/access tokens, or
- **Service account / workload identity** for server-side usage, or
- both.

## Candidate implementation paths
1) **Add OAuth/Bearer-token mode targeting Vertex AI Gemini**
   - Use `Authorization: Bearer <access_token>`.
   - Endpoint and request format may differ (Vertex vs Generative Language).
   - Token acquisition handled outside this repo; adapter only consumes access token.

2) **Keep API-key mode (current) + add optional OAuth token injector**
   - Adapter chooses auth mechanism:
     - if `accessToken` present → Bearer header
     - else if `apiKey` present → `?key=...`
   - Might require interface extension (see `oauth-architecture-decision.md`).

3) **Separate adapters**
   - `gemini` stays API-key-based.
   - New `vertex-gemini` adapter uses OAuth/service-account access tokens.

## Token storage considerations (outside this repo)
- Store refresh tokens encrypted at rest.
- Prefer short-lived access tokens cached in memory with expiration.
- Scopes:
  - user-consent: likely `https://www.googleapis.com/auth/cloud-platform` (or narrower if supported)

## Security constraints
- Never log raw API keys or access tokens.
- Ensure debug payloads redact:
  - `Authorization: Bearer ...`
  - URL query params like `key=...` (already implemented by `sanitizeUrl`).

## Acceptance criteria
- Clear decision documented for Gemini auth:
  - API key only vs OAuth/service-account support
  - whether to implement as mode-switch or separate adapter
- If OAuth/service-account support is implemented:
  - adapter can successfully call the chosen Google endpoint using an access token
  - debug payloads do not leak tokens
  - existing API-key behavior remains unchanged

## Test plan
- Unit tests:
  - URL/path selection logic based on provided credentials
  - redaction of query key and Authorization header
- Integration tests:
  - mocked HTTP server for both modes
- Manual:
  - obtain access token (user OAuth or service account), run completion, verify success, revoke/expire token and verify sanitized failure.
