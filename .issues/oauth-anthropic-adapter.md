# OAuth support: Anthropic adapter

## Context
The Anthropic adapter currently authenticates with `x-api-key: <key>` and targets the first-party Anthropic API (`https://api.anthropic.com/v1`).

We want an OAuth-style “connect Anthropic” story, but it’s unclear whether Anthropic offers an end-user OAuth flow for direct API access in our product context.

## Candidate approaches (to evaluate)
1) **Direct Anthropic OAuth (if available)**
   - Investigate whether Anthropic offers OAuth 2.0 for API usage.
   - Determine token type, scopes, token lifetime, refresh.

2) **No OAuth available → keep API-key-only**
   - Provide secure BYO key storage outside this repo.
   - Keep adapter unchanged except for validation messaging and redaction hardening.

3) **Alternative endpoints that use OAuth-like credentials**
   - Claude via AWS Bedrock (IAM/SigV4; potentially via AWS SSO/OIDC in upstream service).
   - Claude via Google Vertex AI (Google OAuth/service account; would likely be a different adapter).

## Proposed approach (adapter-level)
- If direct Anthropic OAuth exists and uses Bearer tokens:
  - Extend adapter to support `Authorization: Bearer <token>` alongside `x-api-key`, or define a new adapter.
- If not:
  - Close as “OAuth not supported for Anthropic direct API” and link to the chosen fallback in `oauth-architecture-decision.md`.

## Security constraints
- Never log or attach raw tokens/keys.
- Ensure `provider-debug` redaction covers whatever token formats Anthropic uses.

## Acceptance criteria
- Research outcome documented:
  - whether direct Anthropic OAuth is possible
  - recommended approach if not possible
- If OAuth is implemented:
  - adapter completes a request using OAuth-derived credentials
  - debug payloads do not leak tokens
- If OAuth is not implemented:
  - clear closure criteria with a recommended alternative (BYO key storage and/or separate Bedrock/Vertex adapter work).

## Test plan
- Unit tests for header selection and debug redaction.
- Manual end-to-end (only if OAuth exists): connect, refresh, run completion, revoke.
