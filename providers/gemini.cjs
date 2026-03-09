#!/usr/bin/env node
/**
 * Google Gemini AI Provider Implementation
 * 
 * Implements the AI Provider Interface for Google Gemini API.
 * Supports Gemini 1.5 Pro, Gemini 1.5 Flash, and other Gemini models.
 * 
 * @module ai-providers/providers/gemini
 */

const axios = require('axios');
const path = require('path');
const { processAttachment } = require('../utils/file-utils.cjs');
const { wrapTransportError, attachResponseDebugAndRethrow } = require('../utils/provider-debug.cjs');

/**
 * Provider name identifier
 * @type {string}
 */
const name = 'gemini';

/**
 * Default base URL for Gemini API
 * @type {string}
 */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Check if digital twin transport should be used
 * @returns {boolean}
 */
function shouldUseTwinTransport() {
  return process.env.NODE_ENV === 'test' || !!process.env.DIGITAL_TWIN_MODE;
}

/**
 * Build the canonical request object for Gemini
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

  const parts = [];
  
  if (prompt && typeof prompt === 'string') {
    parts.push({ text: prompt });
  }
  
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      const processed = await processAttachment(attachment);
      const { type, mimeType, isUrl, base64Data, url } = processed;
      
      if (type === 'image' || type === 'video' || type === 'audio' || type === 'file') {
        let dataToUse = base64Data;
        
        if (isUrl) {
          try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            dataToUse = Buffer.from(response.data).toString('base64');
          } catch (error) {
            throw new Error(
              `Gemini: Failed to fetch URL ${url}: ${error.message}. Ensure the URL is publicly accessible.`
            );
          }
        }
        
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: dataToUse
          }
        });
      }
    }
  }

  const requestBody = {
    contents: [{ parts }],
  };

  const generationConfig = {};
  
  if (providerOptions.temperature !== undefined) {
    generationConfig.temperature = providerOptions.temperature;
  }
  if (providerOptions.maxOutputTokens) {
    generationConfig.maxOutputTokens = providerOptions.maxOutputTokens;
  }
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }

  const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

  const headers = {
    'Content-Type': 'application/json',
  };

  return {
    method: 'POST',
    url,
    headers,
    body: requestBody
  };
}

/**
 * Transform axios response to provider result format
 * @param {Object} axiosResponse - Axios response object
 * @param {string} originalPrompt - Original prompt for token estimation
 * @returns {Object} { content, usage: { input, output, total } }
 */
function transformResponse(axiosResponse, originalPrompt) {
  const data = axiosResponse.data;
  const candidates = data.candidates;
  
  if (!candidates || !candidates[0]?.content?.parts?.[0]?.text) {
    throw new Error('Gemini: No content in response');
  }
  
  const content = candidates[0].content.parts[0].text;
  const usageMetadata = data.usageMetadata || {};
  
  return {
    content,
    usage: {
      input: usageMetadata.promptTokenCount || estimateTokens(originalPrompt),
      output: usageMetadata.candidatesTokenCount || estimateTokens(content),
      total: (usageMetadata.promptTokenCount || 0) + (usageMetadata.candidatesTokenCount || 0)
    }
  };
}

/**
 * Create the real transport function
 * @returns {Function} (request) => Promise<result>
 */
async function runRequest(request, originalPrompt) {
  try {
    // For Gemini, URL already contains API key
    const response = await axios({
      method: request.method,
      url: request.url,
      headers: request.headers,
      data: request.body,
    });

    try {
      return transformResponse(response, originalPrompt);
    } catch (err) {
      attachResponseDebugAndRethrow(err, { provider: name, request, axiosResponse: response });
    }
  } catch (err) {
    throw wrapTransportError(err, { provider: name, request });
  }
}

function makeRealTransport(originalPrompt) {
  return async (request) => runRequest(request, originalPrompt);
}

/**
 * Execute AI completion request via Google Gemini
 * @async
 * @function complete
 * @param {Object} options - Completion options
 * @returns {Promise<Object>} - Completion result
 */
async function complete(options) {
  if (!options.prompt) throw new Error('Gemini: prompt is required');
  if (!options.model) throw new Error('Gemini: model is required');
  if (!options.apiKey) throw new Error('Gemini: apiKey is required');

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
      realTransport: makeRealTransport(options.prompt),
      engineOptions: { normalizerOptions: { ignoreQuery: true } },
    });

    try {
      return await transport.complete(request);
    } catch (err) {
      throw wrapTransportError(err, { provider: name, request });
    }
  } else {
    return await runRequest(request, options.prompt);
  }
}

/**
 * Validate Gemini provider configuration
 * @function validate
 * @param {Object} config - Provider configuration
 * @returns {boolean}
 */
function validate(config) {
  if (!config) throw new Error('Gemini: Configuration object is required');
  if (!config.apiKey) throw new Error('Gemini: API key is required. Set GEMINI_API_KEY environment variable.');
  if (typeof config.apiKey !== 'string' || config.apiKey.length < 20) {
    throw new Error('Gemini: Invalid API key format');
  }
  if (config.baseUrl && typeof config.baseUrl !== 'string') {
    throw new Error('Gemini: baseUrl must be a string');
  }
  return true;
}

/**
 * Estimate token count from text length
 * Rough approximation: 1 token ≈ 4 characters
 * @param {string} text - Input text
 * @returns {number} - Estimated token count
 */
function estimateTokens(text) {
  if (typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

module.exports = {
  name,
  complete,
  validate,
};
