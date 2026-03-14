#!/usr/bin/env node
/**
 * Anthropic AI Provider Implementation
 * 
 * Implements the AI Provider Interface for Anthropic API (Claude models).
 * Supports all Claude models including Claude 3.5 Sonnet, Claude 3 Opus, etc.
 * 
 * @module ai-providers/providers/anthropic
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
const name = 'anthropic';

/**
 * Default base URL for Anthropic API
 * @type {string}
 */
const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * Check if digital twin transport should be used
 * @returns {boolean}
 */
function shouldUseTwinTransport() {
  return process.env.NODE_ENV === 'test' || !!process.env.DIGITAL_TWIN_MODE;
}

/**
 * Build the canonical request object for Anthropic
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

  // Build content array
  const contentParts = [];
  
  if (prompt && typeof prompt === 'string') {
    contentParts.push({ type: 'text', text: prompt });
  }
  
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const processed = await processAttachment(attachment);
      const { type, mimeType, base64Data } = processed;
      
      if (type === 'image') {
        contentParts.push({
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64Data }
        });
      } else if (type === 'file') {
        const ext = mimeType.split('/')[1] || '';
        if (ext === 'pdf' || ext === 'plain' || mimeType === 'application/pdf' || mimeType === 'text/plain') {
          contentParts.push({
            type: 'document',
            source: { type: 'base64', media_type: mimeType, data: base64Data }
          });
        } else {
          throw new Error(
            `Anthropic: Unsupported file type ${mimeType}. ` +
            'Supported: application/pdf, text/plain.'
          );
        }
      } else if (type === 'video' || type === 'audio') {
        throw new Error(
          `Anthropic: ${type} attachments not directly supported. ` +
          'Extract frames as images first, or use a provider like Gemini that supports video/audio natively.'
        );
      }
    }
  }

  // Build request body
  const requestBody = {
    model,
    max_tokens: providerOptions.maxTokens || 4096,
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
  if (providerOptions.system) {
    requestBody.system = providerOptions.system;
  }

  // Build headers
  const headers = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  return {
    method: 'POST',
    url: `${baseUrl}/messages`,
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
  const content = data.content?.[0]?.text;
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };
  const exchange = buildProviderExchange(request, axiosResponse);

  if (!content) {
    throw createNoContentError({ provider: name, request, axiosResponse, message: 'Anthropic: No content in response' });
  }

  return {
    content,
    usage: {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      total: (usage.input_tokens || 0) + (usage.output_tokens || 0)
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
 * Execute AI completion request via Anthropic
 * @async
 * @function complete
 * @param {Object} options - Completion options
 * @returns {Promise<Object>} - Completion result
 */
async function complete(options) {
  if (!options.prompt) throw new Error('Anthropic: prompt is required');
  if (!options.model) throw new Error('Anthropic: model is required');
  if (!options.apiKey) throw new Error('Anthropic: apiKey is required');

  // Build request (deterministic)
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
 * Validate Anthropic provider configuration
 * @function validate
 * @param {Object} config - Provider configuration
 * @returns {boolean}
 */
function validate(config) {
  if (!config) throw new Error('Anthropic: Configuration object is required');
  if (!config.apiKey) throw new Error('Anthropic: API key is required. Set ANTHROPIC_API_KEY environment variable.');
  if (typeof config.apiKey !== 'string' || !config.apiKey.startsWith('sk-ant-')) {
    console.warn('Anthropic: API key format looks incorrect (should start with sk-ant-)');
  }
  if (config.baseUrl && typeof config.baseUrl !== 'string') {
    throw new Error('Anthropic: baseUrl must be a string');
  }
  return true;
}

module.exports = {
  name,
  complete,
  validate,
};
