# Anthropic adapter API-key smoke test (real network)

## Context
We have adapter unit tests but no “real credentials + real API” check for the Anthropic adapter.

This smoke test should be **opt-in** and safe to skip when credentials aren’t present.

## Goal
Add a minimal, deterministic smoke test that hits the live Anthropic API using `providers/anthropic.cjs`.

## Requirements / env vars
- `ANTHROPIC_API_KEY` (required to run)
- `ANTHROPIC_SMOKE_MODEL` (optional; default: `claude-3-5-sonnet-20241022`)
- `ANTHROPIC_BASE_URL` (optional; default: `https://api.anthropic.com/v1`)

## Minimal codepath to test
- Load adapter: `require('../providers/anthropic.cjs')`
- Validate config: `provider.validate({ apiKey, baseUrl })`
- Execute completion:
  - `provider.complete({ prompt, model, apiKey, baseUrl, options: { temperature: 0, maxTokens: 32 } })`
  - Prompt should be deterministic and short, e.g. `Reply with exactly: OK`.

Important: the adapter uses Digital Twin transport when `NODE_ENV === 'test'`. The smoke test should set `process.env.NODE_ENV = 'development'` for the duration of the test to ensure the real transport runs.

## Expected debug behavior (when failing)
Optional negative-path test only when `ANTHROPIC_SMOKE_NEGATIVE=1` is set:
- Use an invalid key (e.g. `sk-ant-invalid`)
- Expect thrown error:
  - message starts with `Anthropic:`
  - name `AnthropicError`
  - `err.debug.provider === 'anthropic'`
  - `err.debug.request.headers` should not include the raw key
  - `JSON.stringify(err.debug)` does not contain the key nor full prompt text

## Acceptance criteria
- New smoke test file: `test/smoke/anthropic-api-key.smoke.test.cjs`.
- `npm test` without `ANTHROPIC_API_KEY` does not fail (test is skipped with a clear message).
- With `ANTHROPIC_API_KEY` set:
  - makes a real request
  - asserts `content` is a non-empty string and loosely matches `OK`.
- Negative-path smoke test is opt-in only.

## Suggested manual run
```bash
export ANTHROPIC_API_KEY=...
export ANTHROPIC_SMOKE_MODEL=claude-3-5-sonnet-20241022
node --test test/smoke/anthropic-api-key.smoke.test.cjs

# Optional negative
ANTHROPIC_SMOKE_NEGATIVE=1 node --test test/smoke/anthropic-api-key.smoke.test.cjs
```
