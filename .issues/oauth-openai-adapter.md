# OAuth support: OpenAI adapter

## Context
The OpenAI adapter currently authenticates via `Authorization: Bearer <apiKey>` where `apiKey` is expected to look like `sk-...` (warning only).

To support OAuth, we need a plan for passing an **OAuth access token** (Bearer token) through the same pathway without leaking it and without breaking API-key usage.

## Open questions
- Does OpenAI provide an end-user OAuth flow for API usage in our target product context?
- If not, do we treat “OAuth for OpenAI” as out-of-scope and keep API-key-only, or do we support an enterprise/marketplace OAuth flow?

## Proposed approach (adapter-level)
- Keep the adapter authentication input as a generic **Bearer token** (API key or OAuth access token).
  - Option A (no interface change): continue using `apiKey` field as the token.
  - Option B (small interface extension): accept `authToken` or `auth: { type: 'bearer', token }` and deprecate `apiKey` naming.
- Ensure debug payload redaction covers Bearer tokens (already handled by `redactString`), and the adapter never returns or logs secrets.

## Implementation notes
- `validate()` should remain permissive:
  - do not hard-fail if token doesn’t start with `sk-` (OAuth tokens won’t).
  - keep a warning, but adjust wording (e.g. “token format unexpected; if using OAuth this may be OK”).
- Confirm `wrapTransportError` and `attachResponseDebugAndRethrow` never include raw headers.

## Acceptance criteria
- Documented decision: whether OpenAI OAuth is supported and what flow is used (link to `oauth-architecture-decision.md`).
- If OAuth supported:
  - OpenAI adapter accepts an OAuth access token and successfully completes a request.
  - No debug output includes the raw token.
- If OAuth not supported:
  - Issue closes with clear rationale and a recommended alternative (API key + encrypted storage; or OpenAI via an intermediary that supports OAuth).

## Test plan
- Unit test (no real network) asserting:
  - Authorization header is `Bearer <token>` for both API key and OAuth token strings.
  - Error debug payload redacts Bearer tokens.
- Optional manual smoke test (future): run completion using an OAuth-derived access token if available in dev.
