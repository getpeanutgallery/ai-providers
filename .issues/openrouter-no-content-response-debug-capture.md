# OpenRouter occasionally returns responses with no extractable content (improve debug capture)

## Context
We hit `Error: OpenRouter: No content in response` in live runs even after improving `transformResponse()` to handle:
- string `message.content`
- array/object `message.content` parts
- `message.audio.transcript` fallback

Example (emotion-engine chunk analysis): the raw chunk artifact recorded:
- `error: "OpenRouter: No content in response"`
- `provider: openrouter`
- `model: qwen/qwen3.5-122b-a10b`

This suggests the OpenRouter API response sometimes has:
- an empty/missing `choices[0].message.content`
- no transcript fallback
- or another field shape we don’t yet handle

## Problem
When this happens, we currently throw without preserving enough of the raw response payload for diagnosis.

## Proposed fix
1) Ensure the OpenRouter adapter captures and returns structured debug info on failures:
- if the HTTP request succeeded (2xx), include the full parsed JSON response in the thrown error object (or an attached `debug.rawResponse`).
- if the request failed, include status code + response body.

2) In `emotion-engine`, raw capture should persist this `debug.rawResponse` (already writing raw artifacts) even on provider errors.

3) Add tests simulating responses where `choices` exists but has no usable content.

## Acceptance criteria
- When `No content in response` triggers, devs can inspect a saved raw response payload and determine where the content actually is.
- No regressions for standard text responses.
