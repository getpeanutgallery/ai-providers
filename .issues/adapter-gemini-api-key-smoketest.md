# Gemini adapter API-key smoke test (real network)

## Context
The Gemini adapter currently authenticates via an API key embedded in the request URL query string (`...?key=...`). We have redaction logic in `provider-debug` to sanitize these URLs, but we don’t have a simple end-to-end smoke test against the live API.

Smoke tests must be safe to skip for contributors without keys and should be deterministic.

## Goal
Add a minimal smoke test that hits the live Gemini API using a real `GEMINI_API_KEY`.

## Requirements / env vars
- `GEMINI_API_KEY` (required to run)
- `GEMINI_SMOKE_MODEL` (optional; default: `gemini-1.5-flash`)
- `GEMINI_BASE_URL` (optional; default: `https://generativelanguage.googleapis.com/v1beta`)

## Minimal codepath to test
- Load adapter: `require('../providers/gemini.cjs')`
- Validate config: `provider.validate({ apiKey, baseUrl })`
- Execute completion:
  - `provider.complete({ prompt, model, apiKey, baseUrl, options: { temperature: 0, maxOutputTokens: 32 } })`
  - Prompt: `Reply with exactly: OK`.

Important: the adapter uses Digital Twin transport when `NODE_ENV === 'test'`. The smoke test should set `process.env.NODE_ENV = 'development'` for the duration of the test.

## Expected debug behavior (when failing)
Optional negative-path test only when `GEMINI_SMOKE_NEGATIVE=1` is set:
- Use an invalid key (e.g. `AIza-invalid`)
- Expect thrown error:
  - message starts with `Gemini:`
  - name `GeminiError`
  - `err.debug.provider === 'gemini'`
  - `err.debug.request.url` exists and **does not** contain the raw API key value
  - `JSON.stringify(err.debug)` does not contain the prompt text

## Acceptance criteria
- New smoke test file: `test/smoke/gemini-api-key.smoke.test.cjs`.
- `npm test` without `GEMINI_API_KEY` does not fail (test is skipped with a clear message).
- With `GEMINI_API_KEY` set:
  - makes a real request
  - asserts `content` is a non-empty string and loosely matches `OK`.
- Negative-path smoke test is opt-in only.

## Suggested manual run
```bash
export GEMINI_API_KEY=...
export GEMINI_SMOKE_MODEL=gemini-1.5-flash
node --test test/smoke/gemini-api-key.smoke.test.cjs

# Optional negative
GEMINI_SMOKE_NEGATIVE=1 node --test test/smoke/gemini-api-key.smoke.test.cjs
```
