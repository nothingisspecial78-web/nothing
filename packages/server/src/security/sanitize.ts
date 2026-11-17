import path from 'node:path';

/**
 * Wraps untrusted text (retrieved docs, spreadsheet rows, DOM context, OCR/vision output)
 * in clearly delimited XML tags while escaping any nested delimiter attempts.
 */
export function wrapUntrustedData(label: string, content: string): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const escaped = content
    .replace(/<untrusted_data/gi, '&lt;untrusted_data')
    .replace(/<\/untrusted_data>/gi, '&lt;/untrusted_data&gt;');

  return `<untrusted_data source="${safeLabel}">\n${escaped}\n</untrusted_data>`;
}

export function redactPiiForLog(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [TOKEN]');
}

export function validateExtensionAndMime(
  filename: string,
  mimeType: string,
  allowedExtensions: readonly string[],
  allowedMimes: readonly string[]
): { valid: boolean; reason?: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      reason: `Unsupported file extension "${ext || 'none'}". Allowed: ${allowedExtensions.join(', ')}`,
    };
  }
  const normalizedMime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (normalizedMime && !allowedMimes.includes(normalizedMime)) {
    return {
      valid: false,
      reason: `Unsupported MIME type "${normalizedMime}".`,
    };
  }
  return { valid: true };
}

/**
 * Detects whether text contains Malayalam script characters (\u0D00-\u0D7F).
 */
export function detectLanguage(text: string): 'ml' | 'en' {
  if (/[\u0D00-\u0D7F]/.test(text)) {
    return 'ml';
  }
  return 'en';
}

export function sanitizeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  // Neutralize CSV formula injection (=, +, -, @, tab, cr)
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
