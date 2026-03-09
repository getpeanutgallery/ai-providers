const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDebugPayload,
  attachDebug,
  sanitizeUrl,
} = require('../utils/provider-debug.cjs');

test('provider-debug: sanitizeUrl redacts common secret query params', () => {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=AIzaSECRET12345678901234567890&other=1';
  const out = sanitizeUrl(url);
  assert.ok(out.includes('key=%5BREDACTED%5D') || out.includes('key=[REDACTED]'));
  assert.ok(out.includes('other=1'));
  assert.ok(!out.includes('AIzaSECRET'));
});

test('provider-debug: buildDebugPayload does not include prompt text and redacts request secrets', () => {
  const request = {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      Authorization: 'Bearer sk-THIS_SHOULD_NOT_LEAK',
      'Content-Type': 'application/json',
    },
    body: {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'SENSITIVE_PROMPT_TEXT' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAAAA' } },
          ],
        },
      ],
    },
  };

  const payload = buildDebugPayload({ provider: 'openai', request });

  assert.equal(payload.provider, 'openai');
  assert.equal(payload.request.model, 'gpt-4o-mini');
  assert.deepEqual(payload.request.contentTypes.sort(), ['image_url', 'text']);

  // Request headers are allowlisted and must not include Authorization.
  assert.ok(!('authorization' in (payload.request.headers || {})));

  // Full prompt text must not appear in debug.
  const s = JSON.stringify(payload);
  assert.ok(!s.includes('SENSITIVE_PROMPT_TEXT'));
  assert.ok(!s.includes('THIS_SHOULD_NOT_LEAK'));
});

test('provider-debug: buildDebugPayload redacts response body secrets and truncates large bodies', () => {
  const axiosResponse = {
    status: 401,
    headers: {
      'x-request-id': 'req_123',
      'set-cookie': 'session=do_not_keep',
    },
    data: {
      note: 'Bearer VERY_SECRET_TOKEN',
      api_key: 'sk-123456789012345678901234567890',
      big: 'x'.repeat(9000),
    },
  };

  const payload = buildDebugPayload({ provider: 'openrouter', axiosResponse });

  assert.equal(payload.provider, 'openrouter');
  assert.equal(payload.response.status, 401);
  assert.equal(payload.response.headers['x-request-id'], 'req_123');
  assert.ok(!('set-cookie' in payload.response.headers));

  const body = payload.response.body;
  assert.ok(typeof body === 'string' && body.length > 0);
  assert.ok(body.length <= 8300);
  assert.ok(!body.includes('VERY_SECRET_TOKEN'));
  assert.ok(!body.includes('sk-123456789012345678901234567890'));
  assert.ok(body.includes('Bearer [REDACTED]'));
  assert.ok(body.includes('sk-[REDACTED]') || body.includes('[REDACTED]'));
  assert.ok(body.includes('...[truncated'));
});

test('provider-debug: attachDebug preserves existing debug.response when incoming payload has no response', () => {
  const err = new Error('boom');
  err.debug = {
    provider: 'openrouter',
    response: { status: 200, headers: { 'x-request-id': 'req_existing' }, body: '{"ok":true}' },
  };

  const request = {
    method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { Authorization: 'Bearer SECRET', 'Content-Type': 'application/json' },
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
  };

  // No axiosResponse / axiosError.response included -> must not blank existing response.
  attachDebug(err, buildDebugPayload({ provider: 'openrouter', request }));

  assert.equal(err.debug.provider, 'openrouter');
  assert.equal(err.debug.response.status, 200);
  assert.equal(err.debug.response.headers['x-request-id'], 'req_existing');
  assert.equal(err.debug.request.model, 'test-model');
});

test('providers: openai.complete wraps axios transport error with sanitized debug', async () => {
  const axiosPath = require.resolve('axios');
  const realAxios = require(axiosPath);

  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    // Stub axios before requiring the provider.
    const axiosErr = new Error('Request failed with status code 401');
    axiosErr.isAxiosError = true;
    axiosErr.config = { headers: { Authorization: 'Bearer LEAKY' } };
    axiosErr.response = {
      status: 401,
      headers: { 'x-request-id': 'req_openai_401' },
      data: { error: { message: 'unauthorized', authorization: 'Bearer ALSO_LEAKY' } },
    };

    const axiosStub = async () => {
      throw axiosErr;
    };

    require.cache[axiosPath].exports = axiosStub;
    delete require.cache[require.resolve('../providers/openai.cjs')];

    const provider = require('../providers/openai.cjs');

    await assert.rejects(
      () =>
        provider.complete({
          prompt: 'hello',
          model: 'gpt-4o-mini',
          apiKey: 'sk-THIS_SHOULD_NOT_LEAK',
        }),
      (err) => {
        assert.match(err.message, /^OpenAI:/);
        assert.equal(err.name, 'OpenAIError');
        assert.ok(err.debug);
        assert.equal(err.debug.provider, 'openai');
        assert.equal(err.debug.response.status, 401);
        assert.equal(err.debug.response.headers['x-request-id'], 'req_openai_401');
        assert.ok(!('config' in err));
        assert.ok(!JSON.stringify(err.debug).includes('THIS_SHOULD_NOT_LEAK'));
        return true;
      }
    );
  } finally {
    require.cache[axiosPath].exports = realAxios;
    delete require.cache[require.resolve('../providers/openai.cjs')];
    process.env.NODE_ENV = oldNodeEnv;
  }
});

test('providers: gemini.complete wraps axios transport error and redacts api key in request URL', async () => {
  const axiosPath = require.resolve('axios');
  const realAxios = require(axiosPath);

  const oldNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    const axiosErr = new Error('Request failed with status code 429');
    axiosErr.isAxiosError = true;
    axiosErr.response = {
      status: 429,
      headers: { 'x-request-id': 'req_gemini_429' },
      data: { error: { message: 'rate limited', token: 'eyJabc.def.ghi' } },
    };

    const axiosStub = async () => {
      throw axiosErr;
    };

    require.cache[axiosPath].exports = axiosStub;
    delete require.cache[require.resolve('../providers/gemini.cjs')];

    const provider = require('../providers/gemini.cjs');

    await assert.rejects(
      () =>
        provider.complete({
          prompt: 'SENSITIVE_PROMPT_TEXT',
          model: 'gemini-1.5-pro',
          apiKey: 'AIzaSHOULD_NOT_LEAK_123456789012345',
        }),
      (err) => {
        assert.match(err.message, /^Gemini:/);
        assert.equal(err.name, 'GeminiError');
        assert.ok(err.debug);
        assert.equal(err.debug.provider, 'gemini');
        assert.equal(err.debug.response.status, 429);
        assert.ok(!err.debug.request.url.includes('AIzaSHOULD_NOT_LEAK'));
        assert.ok(err.debug.request.url.includes('key'));
        assert.ok(!JSON.stringify(err.debug).includes('SENSITIVE_PROMPT_TEXT'));
        return true;
      }
    );
  } finally {
    require.cache[axiosPath].exports = realAxios;
    delete require.cache[require.resolve('../providers/gemini.cjs')];
    process.env.NODE_ENV = oldNodeEnv;
  }
});
