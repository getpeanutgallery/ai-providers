const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../providers/openrouter.cjs');

function wrap(data, { status = 200, headers = {} } = {}) {
  return { data, status, headers };
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

test('openrouter.transformResponse: throws with debug payload when neither content nor transcript available', () => {
  const request = {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: 'Bearer SECRET_TOKEN_SHOULD_NOT_LEAK',
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://example.com',
    },
    body: {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,AAAAAA' },
            },
          ],
        },
      ],
    },
  };

  const response = wrap(
    {
      choices: [{ message: {} }],
      note: 'Bearer SUPER_SECRET_SHOULD_NOT_LEAK',
      key: 'sk-123456789012345678901234567890',
      big: 'x'.repeat(9000),
    },
    {
      status: 200,
      headers: {
        'x-request-id': 'req_123',
        'cf-ray': 'cf_456',
        'set-cookie': 'session=should_not_be_in_debug',
      },
    }
  );

  try {
    provider._private.transformResponse(response, request);
    assert.fail('expected transformResponse to throw');
  } catch (err) {
    assert.match(err.message, /No content in response/);

    assert.ok(err.debug);
    assert.equal(err.debug.provider, 'openrouter');

    // Response info
    assert.equal(err.debug.response.status, 200);
    assert.equal(err.debug.response.headers['x-request-id'], 'req_123');
    assert.equal(err.debug.response.headers['cf-ray'], 'cf_456');
    assert.ok(!('set-cookie' in err.debug.response.headers));

    // Request info (sanitized)
    assert.equal(err.debug.request.model, 'test-model');
    assert.deepEqual(err.debug.request.contentTypes.sort(), ['image_url', 'text']);
    assert.ok(!('authorization' in (err.debug.request.headers || {})));

    // Body snippet redaction + truncation
    const body = err.debug.response.body;
    assert.ok(typeof body === 'string' && body.length > 0);
    assert.ok(body.length <= 8300);
    assert.ok(!body.includes('SUPER_SECRET_SHOULD_NOT_LEAK'));
    assert.ok(!body.includes('SECRET_TOKEN_SHOULD_NOT_LEAK'));
    assert.ok(!body.includes('sk-123456789012345678901234567890'));
    assert.ok(body.includes('Bearer [REDACTED]'));
    assert.ok(body.includes('sk-[REDACTED]'));
    // Note: request body is not included in response debug snippet.
    assert.ok(body.includes('...[truncated'));
  }
});

test('openrouter.wrapTransportError: wraps axios error and does not include raw axios config', () => {
  const request = {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: 'Bearer SECRET_TOKEN_SHOULD_NOT_LEAK',
      'Content-Type': 'application/json',
    },
    body: {
      model: 'test-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  };

  const axiosErr = new Error('Request failed with status code 401');
  axiosErr.isAxiosError = true;
  axiosErr.config = { headers: { Authorization: 'Bearer LEAKY' } };
  axiosErr.response = {
    status: 401,
    headers: { 'x-request-id': 'req_401' },
    data: { error: { message: 'unauthorized', authorization: 'Bearer ALSO_LEAKY' } },
  };

  const wrapped = provider._private.wrapTransportError(axiosErr, request);

  assert.match(wrapped.message, /^OpenRouter:/);
  assert.equal(wrapped.name, 'OpenRouterError');
  assert.ok(wrapped.debug);
  assert.equal(wrapped.debug.response.status, 401);
  assert.equal(wrapped.debug.response.headers['x-request-id'], 'req_401');
  assert.ok(!('config' in wrapped));

  const body = wrapped.debug.response.body;
  assert.ok(!body.includes('LEAKY'));
  // Value is redacted either via key-based replacement or string redaction.
  assert.ok(body.includes('[REDACTED]'));
});

test('openrouter.wrapTransportError: preserves existing debug.response when new payload has no axios response', () => {
  const request = {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: 'Bearer SECRET_TOKEN_SHOULD_NOT_LEAK',
      'Content-Type': 'application/json',
    },
    body: {
      model: 'test-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
  };

  // Simulate the error thrown by transformResponse, which already has debug built from an axiosResponse.
  const err = new Error('OpenRouter: No content in response');
  err.name = 'OpenRouterNoContentError';
  err.debug = {
    provider: 'openrouter',
    response: {
      status: 200,
      headers: { 'x-request-id': 'req_123' },
      body: '{"choices":[{"message":{}}]}',
    },
  };

  // Now simulate runRequest's catch calling wrapTransportError(err, request).
  // buildDebugPayload({ axiosError: err }) has no .response, so it must not blank existing debug.response.
  const wrapped = provider._private.wrapTransportError(err, request);

  assert.equal(wrapped, err);
  assert.ok(wrapped.debug);
  assert.equal(wrapped.debug.response.status, 200);
  assert.equal(wrapped.debug.response.headers['x-request-id'], 'req_123');
  assert.equal(wrapped.debug.response.body, '{"choices":[{"message":{}}]}');

  // It should still enrich request meta.
  assert.equal(wrapped.debug.request.model, 'test-model');
});

test('openrouter.getTransportTimeoutMs: prefers provider option, then env, then default', () => {
  const oldEnv = process.env.OPENROUTER_TIMEOUT_MS;

  try {
    delete process.env.OPENROUTER_TIMEOUT_MS;
    assert.equal(provider._private.getTransportTimeoutMs({}), 120000);

    process.env.OPENROUTER_TIMEOUT_MS = '45000';
    assert.equal(provider._private.getTransportTimeoutMs({}), 45000);

    assert.equal(
      provider._private.getTransportTimeoutMs({ options: { timeoutMs: 9000 } }),
      9000
    );
  } finally {
    if (oldEnv === undefined) delete process.env.OPENROUTER_TIMEOUT_MS;
    else process.env.OPENROUTER_TIMEOUT_MS = oldEnv;
  }
});

test('openrouter.runRequest: forwards resolved timeout to axios transport', async () => {
  const axiosPath = require.resolve('axios');
  const realAxios = require(axiosPath);
  let seenConfig = null;

  try {
    const axiosStub = async (config) => {
      seenConfig = config;
      return {
        status: 200,
        headers: { 'x-request-id': 'req_timeout_cfg' },
        data: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      };
    };

    require.cache[axiosPath].exports = axiosStub;
    delete require.cache[require.resolve('../providers/openrouter.cjs')];
    const freshProvider = require('../providers/openrouter.cjs');

    const result = await freshProvider._private.runRequest(
      {
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { Authorization: 'Bearer SECRET', 'Content-Type': 'application/json' },
        body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      },
      { options: { timeoutMs: 7777 } }
    );

    assert.equal(result.content, 'ok');
    assert.equal(seenConfig.timeout, 7777);
  } finally {
    require.cache[axiosPath].exports = realAxios;
    delete require.cache[require.resolve('../providers/openrouter.cjs')];
  }
});
