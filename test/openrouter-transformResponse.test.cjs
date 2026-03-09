const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../providers/openrouter.cjs');

function wrap(data) {
  return { data };
}

test('openrouter.transformResponse: string message.content', () => {
  const res = provider._private.transformResponse(
    wrap({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })
  );

  assert.equal(res.content, 'hello');
  assert.deepEqual(res.usage, { input: 1, output: 2, total: 3 });
});

test('openrouter.transformResponse: array message.content parts', () => {
  const res = provider._private.transformResponse(
    wrap({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'hello' },
              { type: 'text', text: ' world' },
            ],
          },
        },
      ],
    })
  );

  assert.equal(res.content, 'hello world');
});

test('openrouter.transformResponse: falls back to message.audio.transcript when content missing', () => {
  const res = provider._private.transformResponse(
    wrap({
      choices: [
        {
          message: {
            content: null,
            audio: { transcript: 'transcribed speech' },
          },
        },
      ],
    })
  );

  assert.equal(res.content, 'transcribed speech');
});

test('openrouter.transformResponse: throws when neither content nor transcript available', () => {
  assert.throws(() => {
    provider._private.transformResponse(wrap({ choices: [{ message: {} }] }));
  }, /No content in response/);
});
