import { computeSha256 } from '../../utils/crypto.js';

export interface FileValidationResult {
  isValid: boolean;
  detectedMimeType?: string;
  error?: string;
  sha256Hash: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MAX_FILE_SIZE_BYTES = parseInt(process.env.STORAGE_MAX_FILE_SIZE_BYTES || '10485760', 10); // 10MB

/**
 * Validate buffer magic bytes (file signature)
 */
export function detectMimeTypeFromMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // PNG: 89 50 4E 47 (0x89, 'P', 'N', 'G')
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PDF: %PDF (0x25, 0x50, 0x44, 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function validateReceiptFile(
  buffer: Buffer,
  declaredMimeType?: string
): FileValidationResult {
  const sha256Hash = computeSha256(buffer);

  if (buffer.length === 0) {
    return {
      isValid: false,
      error: 'Empty file uploaded',
      sha256Hash,
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      sha256Hash,
    };
  }

  const detectedMime = detectMimeTypeFromMagicBytes(buffer);

  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    return {
      isValid: false,
      error: 'Invalid file signature. Only authentic PNG, JPEG, WebP, and PDF receipt documents are accepted.',
      sha256Hash,
    };
  }

  return {
    isValid: true,
    detectedMimeType: detectedMime,
    sha256Hash,
  };
}
