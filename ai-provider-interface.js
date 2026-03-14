#!/usr/bin/env node
/**
 * AI Provider Interface - Contract Definition
 * 
 * All AI providers implement this contract. This file defines the interface
 * that all providers must follow, ensuring tools can be provider-agnostic.
 * 
 * @module ai-providers/ai-provider-interface
 */

const path = require('path');
const fs = require('fs');

/**
 * AI Provider Interface Contract
 * 
 * All providers must implement these methods:
 * - complete(options): Execute AI completion request
 * - validate(config): Validate provider configuration
 * 
 * @namespace AIProviderInterface
 */

/**
 * Attachment for multi-modal inputs
 * 
 * Supports three input patterns:
 * 
 * **Pattern 1: URL (Publicly Accessible)**
 * @example
 * {
 *   type: 'video',
 *   url: 'https://s3.amazonaws.com/bucket/video.mp4'
 * }
 * 
 * **Pattern 2: Local Path (Auto-convert to Base64)**
 * @example
 * {
 *   type: 'video',
 *   path: '/local/path/to/video.mp4'
 *   // mimeType auto-detected from extension
 * }
 * 
 * **Pattern 3: Direct Base64 Data (Already Converted)**
 * @example
 * {
 *   type: 'video',
 *   data: 'base64-encoded-string-here',
 *   mimeType: 'video/mp4'  // Required for data pattern
 * }
 * 
 * @typedef {Object} Attachment
 * @property {'video' | 'audio' | 'image' | 'file'} type - Attachment type
 * @property {string} [url] - Publicly accessible URL (Pattern 1)
 * @property {string} [path] - Local file path or URL (Pattern 2)
 * @property {string} [data] - Base64-encoded data (Pattern 3)
 * @property {string} [mimeType] - MIME type (auto-detected for path, required for data)
 */

/**
 * Completion options
 * @typedef {Object} CompletionOptions
 * @property {string | Array} prompt - System/user prompt (can be text or messages array)
 * @property {string} model - Model identifier (e.g., 'qwen/qwen-3.5-397b-a17b')
 * @property {string} apiKey - API key (injected at runtime, NEVER in YAML)
 * @property {string} [baseUrl] - API base URL (optional, provider-specific)
 * @property {Attachment[]} [attachments] - Multi-modal attachments (video, audio, images, files)
 * @property {Object} [options] - Additional provider-specific options
 */

/**
 * Completion result
 * @typedef {Object} CompletionResult
 * @property {string} content - Generated content
 * @property {Object} [usage] - Token usage info
 * @property {number} [usage.input] - Input tokens
 * @property {number} [usage.output] - Output tokens
 * @property {number} [usage.total] - Total tokens when the provider supplies it
 * @property {Object} [providerRequest] - Canonical raw request snapshot for replay/debug capture
 * @property {Object} [providerResponse] - Raw provider response snapshot for replay/debug capture
 */

/**
 * Provider configuration
 * @typedef {Object} ProviderConfig
 * @property {string} provider - Provider name (e.g., 'openrouter', 'anthropic')
 * @property {string} [apiKey] - API key (optional, can be injected via env)
 * @property {string} [baseUrl] - API base URL (optional)
 * @property {Object} [options] - Provider-specific options
 */

/**
 * Execute AI completion request
 * 
 * @function complete
 * @memberof AIProviderInterface
 * @param {CompletionOptions} options - Completion options
 * @returns {Promise<CompletionResult>} - Completion result
 * 
 * @example
 * const response = await aiProvider.complete({
 *   prompt: 'Analyze this video chunk...',
 *   model: 'qwen/qwen-3.5-397b-a17b',
 *   apiKey: process.env.AI_API_KEY,
 *   baseUrl: process.env.AI_BASE_URL,
 * });
 * 
 * console.log(response.content);
 * console.log(`Tokens: ${response.usage.input} → ${response.usage.output}`);
 */
async function complete(options) {
  throw new Error('Not implemented - use a specific provider implementation');
}

/**
 * Validate provider configuration
 * 
 * @function validate
 * @memberof AIProviderInterface
 * @param {ProviderConfig} config - Provider configuration
 * @returns {boolean} - True if valid, throws error if invalid
 * 
 * @example
 * aiProvider.validate({
 *   provider: 'openrouter',
 *   apiKey: process.env.AI_API_KEY,
 * });
 */
function validate(config) {
  throw new Error('Not implemented - use a specific provider implementation');
}

/**
 * Load provider implementation dynamically
 * 
 * @function loadProvider
 * @param {string} providerName - Provider name (e.g., 'openrouter', 'anthropic')
 * @returns {Object} - Provider implementation
 * 
 * @example
 * const provider = loadProvider('openrouter');
 * const response = await provider.complete({ ... });
 */
function loadProvider(providerName) {
  const providerPath = path.join(__dirname, 'providers', `${providerName}.cjs`);
  
  if (!fs.existsSync(providerPath)) {
    throw new Error(
      `Provider "${providerName}" not found. ` +
      `Available providers: ${getAvailableProviders().join(', ')}`
    );
  }
  
  return require(providerPath);
}

/**
 * Get list of available providers
 * 
 * @function getAvailableProviders
 * @returns {string[]} - Array of provider names
 */
function getAvailableProviders() {
  const providersDir = path.join(__dirname, 'providers');
  
  if (!fs.existsSync(providersDir)) {
    return [];
  }
  
  return fs.readdirSync(providersDir)
    .filter(file => file.endsWith('.cjs'))
    .map(file => file.replace('.cjs', ''));
}

/**
 * Get provider from environment variables
 * 
 * Reads AI_PROVIDER env var and loads the corresponding provider.
 * Falls back to 'openrouter' if not specified.
 * 
 * @function getProviderFromEnv
 * @returns {Object} - Provider implementation
 * 
 * @example
 * // Set env vars:
 * // export AI_PROVIDER=openrouter
 * // export AI_API_KEY=your-key
 * 
 * const provider = getProviderFromEnv();
 * const response = await provider.complete({
 *   prompt: '...',
 *   model: process.env.AI_MODEL,
 *   apiKey: process.env.AI_API_KEY,
 * });
 */
function getProviderFromEnv() {
  const providerName = process.env.AI_PROVIDER || 'openrouter';
  return loadProvider(providerName);
}

module.exports = {
  complete,
  validate,
  loadProvider,
  getAvailableProviders,
  getProviderFromEnv,
};
