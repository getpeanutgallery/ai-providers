#!/usr/bin/env node
/**
 * OpenAI AI Provider Implementation
 * 
 * Implements the AI Provider Interface for OpenAI API.
 * Supports GPT-4, GPT-4 Turbo, GPT-3.5 Turbo, and other OpenAI models.
 * 
 * @module ai-providers/providers/openai
 */

const axios = require('axios');
const path = require('path');
const { processAttachment } = require('../utils/file-utils.cjs');
const {
  wrapTransportError,
  attachResponseDebugAndRethrow,
  buildProviderExchange,
  createNoContentError,
} = require('../utils/provider-debug.cjs');

/**
 * Provider name identifier
 * @type {string}
 */
const name = 'openai';

/**
 * Default base URL for OpenAI API
 * @type {string}
 */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Check if digital twin transport should be used
 * @returns {boolean}
 */
function shouldUseTwinTransport() {
  return process.env.NODE_ENV === 'test' || !!process.env.DIGITAL_TWIN_MODE;
}

/**
 * Build the canonical request object for OpenAI
 * @param {Object} options - Completion options
 * @returns {Object} Request object { method, url, headers, body }
 */
async function buildRequest(options) {
  const {
    prompt,
    model,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    attachments = [],
    options: providerOptions = {}
  } = options;

  const contentParts = [];
  
  if (prompt && typeof prompt === 'string') {
    contentParts.push({ type: 'text', text: prompt });
  }
  
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const processed = await processAttachment(attachment);
      const { type, mimeType, isUrl, base64Data, url } = processed;
      
      if (type === 'image') {
        if (isUrl) {
          contentParts.push({ type: 'image_url', image_url: { url } });
        } else {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}` }
          });
        }
      } else if (type === 'video' || type === 'audio') {
        throw new Error(
          `OpenAI: ${type} attachments not directly supported in chat completions. ` +
          'Extract frames as images first, or use a provider like Gemini that supports video/audio natively.'
        );
      } else if (type === 'file') {
        throw new Error(
          'OpenAI: File attachments require Assistants API, not chat completions. ' +
          'Use the Assistants API for file uploads, or extract text content and send as text.'
        );
      }
    }
  }

  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: contentParts.length > 1 ? contentParts : prompt
      }
    ],
  };

  if (providerOptions.temperature !== undefined) {
    requestBody.temperature = providerOptions.temperature;
  }
  if (providerOptions.maxTokens) {
    requestBody.max_tokens = providerOptions.maxTokens;
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    method: 'POST',
    url: `${baseUrl}/chat/completions`,
    headers,
    body: requestBody
  };
}

/**
 * Transform axios response to provider result format
 * @param {Object} axiosResponse - Axios response object
 * @returns {Object} { content, usage: { input, output, total } }
 */
function transformResponse(axiosResponse, request) {
  const data = axiosResponse.data;
  const content = data.choices?.[0]?.message?.content;
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const exchange = buildProviderExchange(request, axiosResponse);

  if (!content) {
    throw createNoContentError({ provider: name, request, axiosResponse, message: 'OpenAI: No content in response' });
  }

  return {
    content,
    usage: {
      input: usage.prompt_tokens || 0,
      output: usage.completion_tokens || 0,
      total: usage.total_tokens || 0
    },
    ...exchange,
  };
}

/**
 * Create the real transport function
 * @returns {Function} (request) => Promise<result>
 */
async function runRequest(request) {
  try {
    const response = await axios({
      method: request.method,
      url: request.url,
      headers: request.headers,
      data: request.body,
    });

    try {
      return transformResponse(response, request);
    } catch (err) {
      attachResponseDebugAndRethrow(err, { provider: name, request, axiosResponse: response });
    }
  } catch (err) {
    throw wrapTransportError(err, { provider: name, request });
  }
}

function makeRealTransport() {
  return async (request) => runRequest(request);
}

/**
 * Execute AI completion request via OpenAI
 * @async
 * @function complete
 * @param {Object} options - Completion options
 * @returns {Promise<Object>} - Completion result
 */
async function complete(options) {
  if (!options.prompt) throw new Error('OpenAI: prompt is required');
  if (!options.model) throw new Error('OpenAI: model is required');
  if (!options.apiKey) throw new Error('OpenAI: apiKey is required');

  const request = await buildRequest(options);

  if (shouldUseTwinTransport()) {
    const { createTwinTransport } = require('digital-twin-router');
    if (!process.env.DIGITAL_TWIN_PACK) {
      throw new Error('DIGITAL_TWIN_PACK environment variable must be set when using digital twin transport');
    }
    const twinPack = process.env.DIGITAL_TWIN_PACK;
    const mode = process.env.DIGITAL_TWIN_MODE;

    const transport = createTwinTransport({
      mode,
      twinPack,
      realTransport: makeRealTransport(),
      engineOptions: { normalizerOptions: { ignoreQuery: true } },
    });

    try {
      return await transport.complete(request);
    } catch (err) {
      throw wrapTransportError(err, { provider: name, request });
    }
  } else {
    return await runRequest(request);
  }
}

/**
 * Validate OpenAI provider configuration
 * @function validate
 * @param {Object} config - Provider configuration
 * @returns {boolean}
 */
function validate(config) {
  if (!config) throw new Error('OpenAI: Configuration object is required');
  if (!config.apiKey) throw new Error('OpenAI: API key is required. Set OPENAI_API_KEY environment variable.');
  if (typeof config.apiKey !== 'string' || !config.apiKey.startsWith('sk-')) {
    console.warn('OpenAI: API key format looks incorrect (should start with sk-)');
  }
  if (config.baseUrl && typeof config.baseUrl !== 'string') {
    throw new Error('OpenAI: baseUrl must be a string');
  }
  return true;
}

module.exports = {
  name,
  complete,
  validate,
};
