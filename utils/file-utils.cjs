#!/usr/bin/env node
/**
 * File Utilities for AI Provider Attachments
 * 
 * Provides utilities for handling file attachments across all three patterns:
 * - Pattern 1: URL (publicly accessible)
 * - Pattern 2: Local path (auto-convert to base64)
 * - Pattern 3: Direct base64 data (already converted)
 * 
 * @module ai-providers/utils/file-utils
 */

const fs = require('fs');
const path = require('path');

/**
 * MIME type mappings from file extensions
 * @type {Object}
 */
const MIME_TYPES = {
  // Images
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  
  // Video
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'mov': 'video/quicktime',
  'avi': 'video/x-msvideo',
  'mkv': 'video/x-matroska',
  'flv': 'video/x-flv',
  
  // Audio
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'm4a': 'audio/mp4',
  'aac': 'audio/x-aac',
  'flac': 'audio/x-flac',
  'opus': 'audio/opus',
  
  // Files/Documents
  'pdf': 'application/pdf',
  'txt': 'text/plain',
  'json': 'application/json',
  'xml': 'application/xml',
  'csv': 'text/csv',
  'html': 'text/html',
  'js': 'application/javascript',
  'css': 'text/css',
  'zip': 'application/zip',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformatsdocument',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformatsdocument',
};

/**
 * Convert a local file to base64 string
 * 
 * @async
 * @function fileToBase64
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - Base64-encoded string
 * 
 * @example
 * const base64 = await fileToBase64('/path/to/video.mp4');
 */
async function fileToBase64(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(new Error(`Failed to read file: ${filePath} - ${err.message}`));
      } else {
        resolve(data.toString('base64'));
      }
    });
  });
}

/**
 * Auto-detect MIME type from file extension
 * 
 * @function detectMimeType
 * @param {string} filePath - File path or URL
 * @param {string} defaultType - Default MIME type if not detected
 * @returns {string} - Detected MIME type
 * 
 * @example
 * const mimeType = detectMimeType('/path/to/video.mp4');
 // Returns: 'video/mp4'
 */
function detectMimeType(filePath, defaultType = 'application/octet-stream') {
  // Handle URLs - extract path segment
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    try {
      const url = new URL(filePath);
      filePath = url.pathname;
    } catch (e) {
      return defaultType;
    }
  }
  
  const ext = path.basename(filePath).split('.').pop().toLowerCase();
  
  if (!ext || ext === '') {
    return defaultType;
  }
  
  return MIME_TYPES[ext] || defaultType;
}

/**
 * Validate attachment object structure
 * 
 * Supports three patterns:
 * - Pattern 1: { type, url }
 * - Pattern 2: { type, path }
 * - Pattern 3: { type, data, mimeType }
 * 
 * @function validateAttachment
 * @param {Object} attachment - Attachment object
 * @returns {Object} - Validation result with isValid and error message
 * 
 * @example
 * const result = validateAttachment({
 *   type: 'video',
   path: '/path/to/video.mp4'
 });
 
 if (!result.isValid) {
   throw new Error(result.error);
 }
 */
function validateAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return {
      isValid: false,
      error: 'Attachment must be an object'
    };
  }
  
  // Validate type
  const validTypes = ['video', 'audio', 'image', 'file'];
  if (!attachment.type || !validTypes.includes(attachment.type)) {
    return {
      isValid: false,
      error: `Attachment type must be one of: ${validTypes.join(', ')}`
    };
  }
  
  // Check which pattern is used
  const hasUrl = attachment.url !== undefined;
  const hasPath = attachment.path !== undefined;
  const hasData = attachment.data !== undefined;
  
  // Must have exactly one of: url, path, or data
  const count = (hasUrl ? 1 : 0) + (hasPath ? 1 : 0) + (hasData ? 1 : 0);
  
  if (count === 0) {
    return {
      isValid: false,
      error: 'Attachment must have one of: url, path, or data'
    };
  }
  
  if (count > 1) {
    return {
      isValid: false,
      error: 'Attachment must have exactly one of: url, path, or data (not multiple)'
    };
  }
  
  // Pattern-specific validation
  if (hasUrl) {
    if (typeof attachment.url !== 'string') {
      return {
        isValid: false,
        error: 'Attachment url must be a string'
      };
    }
    
    // Validate URL format
    if (!attachment.url.startsWith('http://') && !attachment.url.startsWith('https://')) {
      return {
        isValid: false,
        error: 'Attachment url must be a valid HTTP/HTTPS URL'
      };
    }
  }
  
  if (hasPath) {
    if (typeof attachment.path !== 'string') {
      return {
        isValid: false,
        error: 'Attachment path must be a string'
      };
    }
    
    // Check if file exists (for local paths)
    if (!attachment.path.startsWith('http://') && !attachment.path.startsWith('https://')) {
      if (!fs.existsSync(attachment.path)) {
        return {
          isValid: false,
          error: `Attachment path does not exist: ${attachment.path}`
        };
      }
    }
  }
  
  if (hasData) {
    if (typeof attachment.data !== 'string') {
      return {
        isValid: false,
        error: 'Attachment data must be a string (base64)'
      };
    }
    
    // mimeType is required for data pattern
    if (!attachment.mimeType) {
      return {
        isValid: false,
        error: 'Attachment mimeType is required when using data pattern'
      };
    }
    
    // Validate base64 format (basic check)
    try {
      Buffer.from(attachment.data, 'base64');
    } catch (e) {
      return {
        isValid: false,
        error: 'Attachment data must be valid base64 encoding'
      };
    }
  }
  
  // mimeType validation (if provided)
  if (attachment.mimeType && typeof attachment.mimeType !== 'string') {
    return {
      isValid: false,
      error: 'Attachment mimeType must be a string'
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

/**
 * Process attachment and return formatted data for provider
 * 
 * Handles all three patterns:
 * - URL: Returns URL directly
 * - Path: Reads file and converts to base64
 * - Data: Returns base64 data directly
 * 
 * @async
 * @function processAttachment
 * @param {Object} attachment - Attachment object
 * @returns {Promise<Object>} - Processed attachment with base64 data or URL
 * 
 * @example
 * const processed = await processAttachment({
 *   type: 'video',
   path: '/path/to/video.mp4'
 });
 
 // Returns: { type, mimeType, base64Data, isUrl }
 */
async function processAttachment(attachment) {
  const validation = validateAttachment(attachment);
  
  if (!validation.isValid) {
    throw new Error(validation.error);
  }
  
  const result = {
    type: attachment.type,
    mimeType: attachment.mimeType,
    isUrl: false,
    base64Data: null,
    url: null
  };
  
  // Pattern 1: URL
  if (attachment.url) {
    result.isUrl = true;
    result.url = attachment.url;
    
    // Auto-detect MIME type from URL if not provided
    if (!result.mimeType) {
      result.mimeType = detectMimeType(attachment.url);
    }
    
    return result;
  }
  
  // Pattern 2: Local Path
  if (attachment.path) {
    // Check if it's a URL or local path
    if (attachment.path.startsWith('http://') || attachment.path.startsWith('https://')) {
      // It's actually a URL in path field
      result.isUrl = true;
      result.url = attachment.path;
      
      // Auto-detect MIME type
      if (!result.mimeType) {
        result.mimeType = detectMimeType(attachment.path);
      }
      
      return result;
    }
    
    // Local file path - read and convert to base64
    result.base64Data = await fileToBase64(attachment.path);
    
    // Auto-detect MIME type from file extension
    if (!result.mimeType) {
      result.mimeType = detectMimeType(attachment.path);
    }
    
    return result;
  }
  
  // Pattern 3: Direct Base64 Data
  if (attachment.data) {
    result.base64Data = attachment.data;
    result.mimeType = attachment.mimeType; // Required for data pattern
    
    return result;
  }
  
  throw new Error('Invalid attachment: missing url, path, or data');
}

module.exports = {
  fileToBase64,
  detectMimeType,
  validateAttachment,
  processAttachment,
  MIME_TYPES,
};
