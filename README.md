# ai-providers

AI provider adapter substrate for Emotion Engine and sibling repos.

## Active adapter contract notes

This repo stays at the **provider/transport** layer. It does **not** own script-level success/failure envelopes or recovery policy.

What it does provide now, consistently across the active adapters (`openai`, `anthropic`, `gemini`, `openrouter`):

- sanitized `error.debug` payloads for provider failures
- stable machine-routing fields on provider errors:
  - `provider`
  - `failureCategory`
  - `failureCode`
  - `retryable`
  - `status` when an HTTP response exists
- replay/debug-friendly raw capture on both success and failure surfaces:
  - `providerRequest`
  - `providerResponse`

## Failure categories

Current adapter-side categories are intentionally transport-oriented:

- `auth`
- `invalid_request`
- `rate_limit`
- `timeout`
- `network`
- `provider_response`
- `invalid_response`
- `internal`

These are meant to stay machine-routable for upstream envelope/recovery systems without moving higher-level workflow ownership into this package.

## Safety / capture rules

- request debug metadata is sanitized and does not include raw auth headers or full prompt text
- response debug snippets are redacted and truncated for safety
- raw `providerRequest` / `providerResponse` capture is preserved on the surfaced result/error object for deterministic replay and bounded recovery orchestration upstream
- no adapter should attach raw axios config objects or other secret-bearing transport internals to surfaced errors

## Tests

```bash
npm test
```
