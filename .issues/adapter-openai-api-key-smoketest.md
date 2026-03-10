# OpenAI adapter API-key smoke test (real network)

## Context
We have unit tests for request/response shaping and error-debug redaction, but we don’t currently have a simple “does this adapter work against the live API with a real key?” test.

This smoke test is intended for local/dev verification and **must be safe to skip** in CI and for contributors without credentials.

## Goal
Add a minimal, deterministic smoke test that exercises the real OpenAI adapter end-to-end using a real API key.

## Requirements / env vars
- `OPENAI_API_KEY` (required to run)
- `OPENAI_SMOKE_MODEL` (optional; default: `gpt-4o-mini`)
- `OPENAI_BASE_URL` (optional; default: `https://api.openai.com/v1`)

## Minimal codepath to test
- Load adapter: `require('../providers/openai.cjs')`
- Validate config: `provider.validate({ apiKey, baseUrl })`
- Execute completion:
  - `provider.complete({ prompt, model, apiKey, baseUrl, options: { temperature: 0, maxTokens: 16 } })`
  - Prompt should be deterministic and short, e.g. `Reply with exactly: OK`.

Note: the adapter enables Digital Twin transport when `NODE_ENV === 'test'`; the smoke test should **force real transport** by setting `process.env.NODE_ENV = 'development'` within the test (and restoring afterwards), similar to `test/provider-debug.test.cjs`.

## Expected debug behavior (when failing)
Add a second test case that intentionally uses an invalid key (e.g. `sk-invalid`) when `OPENAI_SMOKE_NEGATIVE=1` is set.

Expectations for the thrown error:
- `err.message` starts with `OpenAI:`
- `err.name === 'OpenAIError'`
- `err.debug.provider === 'openai'`
- `err.debug.request.url` is present and does **not** include secrets
- `JSON.stringify(err.debug)` does **not** include the API key value nor the full prompt text

## Acceptance criteria
- A new smoke test exists at: `test/smoke/openai-api-key.smoke.test.cjs` (or similar clearly-named path).
- Running `npm test` with **no** `OPENAI_API_KEY`:
  - does not fail (smoke test is skipped with a clear message).
- Running with `OPENAI_API_KEY` set:
  - test performs a real request and asserts a non-empty `content` string.
  - content matches a loose expectation (e.g. includes `OK`) to reduce flakiness.
- Optional negative-path test runs only when explicitly enabled (e.g. `OPENAI_SMOKE_NEGATIVE=1`).

## Suggested manual run
```bash
export OPENAI_API_KEY=...
export OPENAI_SMOKE_MODEL=gpt-4o-mini
node --test test/smoke/openai-api-key.smoke.test.cjs

# Optional negative
OPENAI_SMOKE_NEGATIVE=1 node --test test/smoke/openai-api-key.smoke.test.cjs
```
