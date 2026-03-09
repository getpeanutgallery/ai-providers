/**
 * Shared provider/transport debug payload helpers.
 *
 * Goal: build a consistent, sanitized `error.debug` object across provider adapters
 * without leaking secrets (API keys, tokens, Authorization headers) or full prompt text.
 */

const DEFAULT_DEBUG_BODY_MAX_CHARS = 8192;

function providerDisplayName(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'openai') return 'OpenAI';
  if (p === 'openrouter') return 'OpenRouter';
  if (p === 'anthropic') return 'Anthropic';
  if (p === 'gemini') return 'Gemini';
  return p ? p.slice(0, 1).toUpperCase() + p.slice(1) : 'Provider';
}

function redactString(input) {
  if (input === undefined || input === null) return '';
  let str = String(input);

  // Bearer tokens
  str = str.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');

  // Common API key prefixes
  str = str.replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, 'sk-[REDACTED]');
  str = str.replace(/\bsk-ant-[A-Za-z0-9_-]{10,}\b/gi, 'sk-ant-[REDACTED]');
  str = str.replace(/\bsk-or-[A-Za-z0-9_-]{10,}\b/gi, 'sk-or-[REDACTED]');

  // Google API keys commonly start with AIza...
  str = str.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'AIza[REDACTED]');

  // JWT-ish tokens
  str = str.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');

  // Data URLs can be huge + may embed sensitive content
  str = str.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[REDACTED];base64,[REDACTED]');

  return str;
}

function truncateString(str, maxChars) {
  if (typeof str !== 'string') return '';
  if (!maxChars || typeof maxChars !== 'number') return str;
  if (str.length <= maxChars) return str;
  const remaining = str.length - maxChars;
  return `${str.slice(0, maxChars)}\n...[truncated ${remaining} chars]`;
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    const key = String(k).toLowerCase();
    const value = Array.isArray(v) ? v.join(',') : String(v);
    out[key] = redactString(value);
  }
  return out;
}

function sanitizeUrl(url) {
  if (!url) return '';
  const str = String(url);

  try {
    const u = new URL(str);
    for (const [k] of u.searchParams) {
      if (/^(key|api[-_]?key|apikey|token|access[-_]?token|secret|password|auth)$/i.test(k)) {
        u.searchParams.set(k, '[REDACTED]');
      }
    }
    return redactString(u.toString());
  } catch {
    // Not a valid absolute URL (or URL constructor not happy) – do best-effort redaction.
    return redactString(str);
  }
}

function pickRequestIdLikeHeaders(headers) {
  const h = normalizeHeaders(headers);
  const out = {};

  // Prefer request-id / trace-id style headers and a couple common CDNs.
  const keep = (key) =>
    /(request[-_]?id|trace[-_]?id|correlation[-_]?id|x-amzn[-_]?requestid|cf-ray|openrouter[-_]?request[-_]?id)/i.test(
      key
    );

  for (const [k, v] of Object.entries(h)) {
    if (keep(k)) out[k] = v;
  }

  return out;
}

function safeJsonSnippet(value, maxChars = DEFAULT_DEBUG_BODY_MAX_CHARS) {
  let text = '';
  try {
    text = JSON.stringify(
      value,
      (key, v) => {
        if (
          typeof key === 'string' &&
          /^(authorization|proxy-authorization|api[-_]?key|apikey|token|access[-_]?token|secret|password|cookie|set-cookie)$/i.test(
            key
          )
        ) {
          return '[REDACTED]';
        }

        if (typeof v === 'string') return redactString(v);

        // Protect against huge inline payloads that might include user content.
        if (typeof key === 'string' && /^(data|base64|b64|image|audio|video)$/i.test(key) && typeof v === 'string') {
          if (v.length > 256) return '[REDACTED_LARGE_PAYLOAD]';
        }

        return v;
      },
      2
    );
  } catch {
    text = String(value);
  }

  text = redactString(text);
  return truncateString(text, maxChars);
}

function extractContentTypesFromMessage(message) {
  const content = message?.content;
  if (typeof content === 'string') return ['text'];

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return 'text';
        if (!part || typeof part !== 'object') return 'unknown';
        if (typeof part.type === 'string') return part.type;
        // OpenAI sometimes uses { text: '...' } rather than typed parts.
        if (typeof part.text === 'string') return 'text';
        return 'unknown';
      })
      .filter(Boolean);
  }

  if (content && typeof content === 'object') {
    if (typeof content.type === 'string') return [content.type];
    if (typeof content.text === 'string') return ['text'];
    return ['object'];
  }

  return [];
}

function extractContentTypesFromGeminiBody(body) {
  if (!body || typeof body !== 'object') return [];
  const contents = Array.isArray(body.contents) ? body.contents : [];

  const types = [];
  for (const c of contents) {
    const parts = Array.isArray(c?.parts) ? c.parts : [];
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue;
      if (typeof p.text === 'string') types.push('text');
      if (p.inline_data && typeof p.inline_data === 'object') {
        const mime = String(p.inline_data.mime_type || '').toLowerCase();
        const major = mime.split('/')[0] || 'inline_data';
        types.push(major === 'application' ? 'file' : major);
      }
    }
  }

  return types;
}

function inferModelFromRequest(request) {
  const body = request?.body;
  if (body && typeof body === 'object' && typeof body.model === 'string') return body.model;

  const url = request?.url ? String(request.url) : '';
  // Gemini format: .../models/<model>:generateContent?... (model may contain dots/dashes)
  const m = url.match(/\/models\/([^:/?#]+):/i);
  if (m && m[1]) return m[1];

  return undefined;
}

function sanitizeRequestMeta(request) {
  if (!request || typeof request !== 'object') return undefined;

  const body = request.body && typeof request.body === 'object' ? request.body : {};

  let contentTypes = [];
  if (Array.isArray(body.messages)) {
    contentTypes = Array.from(
      new Set((body.messages || []).flatMap((m) => extractContentTypesFromMessage(m)))
    );
  } else if (Array.isArray(body.contents)) {
    contentTypes = Array.from(new Set(extractContentTypesFromGeminiBody(body)));
  }

  // Never include secrets. Keep only benign, useful headers.
  const headers = normalizeHeaders(request.headers);
  const allow = ['content-type', 'http-referer', 'anthropic-version'];
  const safeHeaders = {};
  for (const key of allow) {
    if (headers[key]) safeHeaders[key] = headers[key];
  }

  return {
    method: request.method,
    url: sanitizeUrl(request.url),
    model: inferModelFromRequest(request),
    contentTypes,
    headers: safeHeaders,
  };
}

function cleanUndefinedDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanUndefinedDeep);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = cleanUndefinedDeep(v);
  }
  return out;
}

function buildDebugPayload({ provider, request, axiosResponse, axiosError, error, maxBodyChars } = {}) {
  const response = axiosResponse || axiosError?.response;
  const err = error || axiosError;

  const payload = {
    provider: String(provider || ''),
    request: sanitizeRequestMeta(request),
  };

  // Only attach response if we actually have one.
  if (response) {
    payload.response = {
      status: response.status,
      headers: pickRequestIdLikeHeaders(response.headers),
      body: safeJsonSnippet(response.data, maxBodyChars || DEFAULT_DEBUG_BODY_MAX_CHARS),
    };
  }

  if (err && typeof err === 'object') {
    payload.error = {
      name: err.name,
      message: redactString(err.message || ''),
      code: err.code,
      type: err.type,
      isAxiosError: !!err.isAxiosError,
    };
  }

  return cleanUndefinedDeep(payload);
}

function attachDebug(err, debugPayload) {
  if (!err || typeof err !== 'object') return err;
  const existing = err.debug && typeof err.debug === 'object' ? err.debug : {};
  const incoming = debugPayload && typeof debugPayload === 'object' ? debugPayload : {};

  const next = { ...existing, ...incoming };

  // Nested merge, but do NOT overwrite with empty objects.
  if (incoming.request) {
    next.request = { ...(existing.request || {}), ...(incoming.request || {}) };
  } else if (existing.request) {
    next.request = existing.request;
  }

  if (incoming.response) {
    next.response = { ...(existing.response || {}), ...(incoming.response || {}) };
  } else if (existing.response) {
    next.response = existing.response;
  }

  if (incoming.error) {
    next.error = { ...(existing.error || {}), ...(incoming.error || {}) };
  } else if (existing.error) {
    next.error = existing.error;
  }

  err.debug = next;
  return err;
}

function wrapTransportError(err, { provider, request, axiosResponse } = {}) {
  // If this already looks like a provider error with debug, just ensure request meta is present.
  if (err && typeof err === 'object' && err.debug) {
    attachDebug(err, buildDebugPayload({ provider, request, axiosError: err, axiosResponse }));
    return err;
  }

  const label = providerDisplayName(provider);
  const message = err?.message ? `${label}: ${err.message}` : `${label}: Request failed`;
  const wrapped = new Error(message);
  wrapped.name = `${label.replace(/\s+/g, '')}Error`;

  // Preserve stack location when possible.
  if (err && err.stack) wrapped.stack = err.stack;

  // Attach debug. Do NOT attach raw axios error as `cause` (axios error may contain request config headers).
  attachDebug(wrapped, buildDebugPayload({ provider, request, axiosError: err, axiosResponse }));

  return wrapped;
}

function attachResponseDebugAndRethrow(err, { provider, request, axiosResponse } = {}) {
  if (!err || typeof err !== 'object') throw err;

  // If already has debug, just enrich.
  attachDebug(err, buildDebugPayload({ provider, request, axiosResponse, error: err }));
  throw err;
}

module.exports = {
  DEFAULT_DEBUG_BODY_MAX_CHARS,
  providerDisplayName,
  redactString,
  truncateString,
  normalizeHeaders,
  sanitizeUrl,
  pickRequestIdLikeHeaders,
  safeJsonSnippet,
  sanitizeRequestMeta,
  buildDebugPayload,
  attachDebug,
  wrapTransportError,
  attachResponseDebugAndRethrow,
};
