#!/usr/bin/env node
/**
 * OpenRouter AI Provider Implementation
 *
 * Implements the AI Provider Interface for OpenRouter API.
 * Supports all models available on OpenRouter platform.
 *
 * @module ai-providers/providers/openrouter
 */

const axios = require('axios');

/**
 * Provider name identifier
 * @type {string}
 */
const name = 'openrouter';

/**
 * Default base URL for OpenRouter API
 * @type {string}
 */
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const {
  DEFAULT_DEBUG_BODY_MAX_CHARS,
  redactString,
  safeJsonSnippet,
  sanitizeRequestMeta,
  buildDebugPayload,
  attachDebug,
  buildProviderExchange,
  createNoContentError,
  wrapTransportError: wrapTransportErrorShared,
} = require('../utils/provider-debug.cjs');

const DEBUG_BODY_MAX_CHARS = DEFAULT_DEBUG_BODY_MAX_CHARS;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 120000;

function wrapTransportError(err, request) {
  return wrapTransportErrorShared(err, { provider: name, request });
}

function getTransportTimeoutMs(options = {}) {
  const providerTimeout = options?.options?.timeoutMs;
  const envTimeout = process.env.OPENROUTER_TIMEOUT_MS;

  const parseTimeout = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : undefined;
  };

  return parseTimeout(providerTimeout) ?? parseTimeout(envTimeout) ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
}

/**
 * Check if digital twin transport should be used
 * @returns {boolean}
 */
function shouldUseTwinTransport() {
  return process.env.NODE_ENV === 'test' || !!process.env.DIGITAL_TWIN_MODE;
}

/**
 * Build the canonical request object for OpenRouter
 * Deterministic structure for hashing and replay
 *
 * @param {Object} options - Completion options
 * @returns {Object} Request object { method, url, headers, body }
 */
function buildRequest(options) {
  const {
    prompt,
    model,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    attachments = [],
    options: providerOptions = {},
  } = options;

  // Build messages array - support both string prompt and messages array
  let messages;
  if (Array.isArray(prompt)) {
    if (prompt.length > 0 && prompt[0].role) {
      messages = prompt;
    } else {
      messages = [{ role: 'user', content: prompt }];
    }
  } else {
    const contentParts = [];

    if (prompt && typeof prompt === 'string') {
      contentParts.push({ type: 'text', text: prompt });
    }

    if (attachments && Array.isArray(attachments)) {
      for (const attachment of attachments) {
        const base64Data = attachment.data || attachment.base64;

        if (attachment.type === 'image') {
          if (base64Data) {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${attachment.mimeType || 'image/jpeg'};base64,${base64Data}`,
              },
            });
          } else if (attachment.url) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: attachment.url },
            });
          }
        } else if (attachment.type === 'video') {
          if (base64Data) {
            contentParts.push({
              type: 'video_url',
              video_url: {
                url: `data:${attachment.mimeType || 'video/mp4'};base64,${base64Data}`,
              },
            });
          } else if (attachment.url) {
            contentParts.push({
              type: 'video_url',
              video_url: { url: attachment.url },
            });
          }
        } else if (attachment.type === 'audio') {
          if (base64Data) {
            const format = (attachment.mimeType || 'audio/wav').split('/')[1] || 'wav';
            contentParts.push({
              type: 'input_audio',
              input_audio: { data: base64Data, format },
            });
          } else if (attachment.url) {
            // Avoid logging any user URLs (may include tokens)
            console.warn('OpenRouter: Audio URLs are not supported. Skipping audio URL attachment.');
          }
        }
      }
    }

    messages = [{ role: 'user', content: contentParts }];
  }

  // Build request body
  const requestBody = {
    model,
    messages,
  };

  // Common OpenAI-compatible parameters supported by OpenRouter
  if (providerOptions.temperature !== undefined) {
    requestBody.temperature = providerOptions.temperature;
  }
  if (providerOptions.maxTokens) {
    requestBody.max_tokens = providerOptions.maxTokens;
  }
  if (providerOptions.reasoning && typeof providerOptions.reasoning === 'object' && !Array.isArray(providerOptions.reasoning)) {
    requestBody.reasoning = providerOptions.reasoning;
  }

  if (providerOptions.siteUrl) {
    requestBody.site_url = providerOptions.siteUrl;
  }
  if (providerOptions.siteName) {
    requestBody.site_name = providerOptions.siteName;
  }

  // Build headers
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (providerOptions.siteUrl) {
    headers['HTTP-Referer'] = providerOptions.siteUrl;
  }

  return {
    method: 'POST',
    url: `${baseUrl}/chat/completions`,
    headers,
    body: requestBody,
  };
}

/**
 * Transform axios response to provider result format
 * @param {Object} axiosResponse - Axios response object
 * @param {Object} [request] - Canonical request object (for debug payload)
 * @returns {Object} { content, usage: { input, output, total } }
 */
function extractTextFromContent(content) {
  // OpenRouter (and upstream OpenAI-compatible APIs) may return:
  // - string
  // - array of typed parts: [{ type: 'text', text: '...' }, ...]
  // - single typed part object
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text' || part.type === 'output_text' || part.type === 'input_text') {
          return typeof part.text === 'string' ? part.text : '';
        }
        if (part.type === 'refusal') {
          return typeof part.refusal === 'string' ? part.refusal : '';
        }
        return '';
      })
      .filter(Boolean);

    return parts.join('');
  }

  if (content && typeof content === 'object') {
    if (content.type === 'text' || content.type === 'output_text' || content.type === 'input_text') {
      return typeof content.text === 'string' ? content.text : '';
    }
    if (content.type === 'refusal') {
      return typeof content.refusal === 'string' ? content.refusal : '';
    }
  }

  return '';
}

function transformResponse(axiosResponse, request) {
  const data = axiosResponse.data;
  const choice = data.choices?.[0] || {};

  // Prefer message.content, but fall back to audio transcript if present.
  const message = choice.message || {};
  const contentText = extractTextFromContent(message.content);
  const audioTranscript = typeof message.audio?.transcript === 'string' ? message.audio.transcript : '';

  const content = contentText || audioTranscript;
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const exchange = buildProviderExchange(request, axiosResponse);

  if (!content) {
    const err = createNoContentError({
      provider: name,
      request,
      axiosResponse,
      message: 'OpenRouter: No content in response',
    });
    attachDebug(err, buildDebugPayload({ provider: name, request, axiosResponse, maxBodyChars: DEBUG_BODY_MAX_CHARS }));
    throw err;
  }

  return {
    content,
    usage: {
      input: usage.prompt_tokens || 0,
      output: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    },
    ...exchange,
  };
}

async function runRequest(request, transportOptions = {}) {
  try {
    const response = await axios({
      method: request.method,
      url: request.url,
      headers: request.headers,
      data: request.body,
      timeout: getTransportTimeoutMs(transportOptions),
    });

    return transformResponse(response, request);
  } catch (err) {
    throw wrapTransportError(err, request);
  }
}

/**
 * Create the real transport function (used by twin or direct)
 * @returns {Function} (request) => Promise<result>
 */
function makeRealTransport(options) {
  return async (request) => runRequest(request, options);
}

/**
 * Execute AI completion request via OpenRouter
 *
 * @async
 * @function complete
 * @param {Object} options - Completion options
 * @param {string | Array} options.prompt - System/user prompt
 * @param {string} options.model - Model identifier
 * @param {string} options.apiKey - OpenRouter API key
 * @param {string} [options.baseUrl] - API base URL
 * @param {Array} [options.attachments] - Multi-modal attachments
 * @param {Object} [options.options] - Additional OpenRouter-specific options
 * @returns {Promise<Object>} - Completion result
 */
async function complete(options) {
  // Validate required parameters
  if (!options.prompt) {
    throw new Error('OpenRouter: prompt is required');
  }
  if (!options.model) {
    throw new Error('OpenRouter: model is required');
  }
  if (!options.apiKey) {
    throw new Error('OpenRouter: apiKey is required');
  }

  // Build deterministic request object
  const request = buildRequest(options);

  // Determine if using twin transport
  if (shouldUseTwinTransport()) {
    const { createTwinTransport } = require('digital-twin-router');
    if (!process.env.DIGITAL_TWIN_PACK) {
      throw new Error('DIGITAL_TWIN_PACK environment variable must be set when using digital twin transport');
    }
    const twinPack = process.env.DIGITAL_TWIN_PACK;
    const mode = process.env.DIGITAL_TWIN_MODE; // undefined = auto (replay in test)

    const transport = createTwinTransport({
      mode,
      twinPack,
      realTransport: makeRealTransport(options),
      engineOptions: { normalizerOptions: { ignoreQuery: true } },
    });

    try {
      return await transport.complete(request);
    } catch (err) {
      // Ensure errors in replay/real have at least sanitized request metadata.
      throw wrapTransportError(err, request);
    }
  }

  // Direct HTTP call
  return await runRequest(request, options);
}

/**
 * Validate OpenRouter provider configuration
 *
 * @function validate
 * @param {Object} config - Provider configuration
 * @param {string} [config.apiKey] - OpenRouter API key
 * @param {string} [config.baseUrl] - API base URL (optional)
 * @returns {boolean} - True if valid
 * @throws {Error} - If configuration is invalid
 */
function validate(config) {
  if (!config) {
    throw new Error('OpenRouter: Configuration object is required');
  }
  if (!config.apiKey) {
    throw new Error('OpenRouter: API key is required. Set OPENROUTER_API_KEY environment variable.');
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.length < 16) {
    throw new Error('OpenRouter: Invalid API key format');
  }
  if (config.baseUrl && typeof config.baseUrl !== 'string') {
    throw new Error('OpenRouter: baseUrl must be a string');
  }
  return true;
}

module.exports = {
  name,
  complete,
  validate,
  // Non-public hooks for unit tests
  _private: {
    buildRequest,
    transformResponse,
    extractTextFromContent,
    redactString,
    safeJsonSnippet,
    buildDebugPayload,
    sanitizeRequestMeta,
    wrapTransportError,
    getTransportTimeoutMs,
    runRequest,
  },
};
