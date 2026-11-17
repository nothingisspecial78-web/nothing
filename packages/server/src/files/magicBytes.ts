import path from 'node:path';
import { BLOCKED_DANGEROUS_EXTENSIONS } from '@ai-assistant/core';

export interface MagicByteCheckResult {
  valid: boolean;
  detectedKind:
    | 'png'
    | 'jpeg'
    | 'webp'
    | 'gif'
    | 'heic'
    | 'pdf'
    | 'zip-ooxml'
    | 'ole-xls'
    | 'text'
    | 'unknown';
  reason?: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic']);
const TEXT_EXTS = new Set(['.csv', '.tsv', '.txt', '.json', '.md']);

function hasBytes(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function looksBinaryText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  if (sample.length === 0) return false;
  // Allow UTF-8 BOM + UTF-16 BOM? Prefer UTF-8; reject NUL bytes
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0x00) return true;
  }
  return false;
}

/**
 * Inspects file magic bytes, blocks dangerous/executable payloads, rejects
 * macro-enabled OOXML (`vbaProject.bin` / `.xlsm` / `.docm`), and checks that
 * container signatures match declared extensions.
 */
export function inspectFileMagicBytes(
  buffer: Buffer,
  filename: string,
  _declaredMime = ''
): MagicByteCheckResult {
  const ext = path.extname(filename || '').toLowerCase();

  if ((BLOCKED_DANGEROUS_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      valid: false,
      detectedKind: 'unknown',
      reason: `Dangerous or macro-enabled file extension "${ext}" is blocked for security.`,
    };
  }

  if (buffer.length === 0) {
    return {
      valid: false,
      detectedKind: 'unknown',
      reason: `Uploaded file "${filename}" is empty.`,
    };
  }

  // Block executable headers regardless of extension
  if (
    hasBytes(buffer, 0, [0x4d, 0x5a]) || // PE / DOS MZ (.exe/.dll)
    hasBytes(buffer, 0, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    hasBytes(buffer, 0, [0xfe, 0xed, 0xfa, 0xce]) || // Mach-O 32
    hasBytes(buffer, 0, [0xfe, 0xed, 0xfa, 0xcf]) || // Mach-O 64
    hasBytes(buffer, 0, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / Java class
    hasBytes(buffer, 0, [0x23, 0x21]) // Shebang (#!) script
  ) {
    return {
      valid: false,
      detectedKind: 'unknown',
      reason: `Executable or script payload detected inside "${filename}". Upload rejected.`,
    };
  }

  // PNG
  if (hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (!IMAGE_EXTS.has(ext) && ext !== '') {
      return { valid: false, detectedKind: 'png', reason: `File "${filename}" is a PNG image but uses extension "${ext}".` };
    }
    return { valid: true, detectedKind: 'png' };
  }

  // JPEG
  if (hasBytes(buffer, 0, [0xff, 0xd8, 0xff])) {
    if (!IMAGE_EXTS.has(ext) && ext !== '') {
      return { valid: false, detectedKind: 'jpeg', reason: `File "${filename}" is a JPEG image but uses extension "${ext}".` };
    }
    return { valid: true, detectedKind: 'jpeg' };
  }

  // WEBP (RIFF....WEBP)
  if (
    hasBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { valid: true, detectedKind: 'webp' };
  }

  // GIF
  const head6 = buffer.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { valid: true, detectedKind: 'gif' };
  }

  // HEIC / ISO BMFF (`ftypheic`, `ftypmif1`, `ftypmsf1`, `ftypheix`)
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') {
      return { valid: true, detectedKind: 'heic' };
    }
  }

  // PDF
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    if (ext && ext !== '.pdf') {
      return { valid: false, detectedKind: 'pdf', reason: `PDF content cannot be uploaded with "${ext}" extension.` };
    }
    return { valid: true, detectedKind: 'pdf' };
  }

  // Legacy OLE2 Compound Document (.xls)
  if (hasBytes(buffer, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (ext !== '.xls') {
      return { valid: false, detectedKind: 'ole-xls', reason: `OLE2 binary content only allowed for .xls files (found "${ext}").` };
    }
    // Check for VBA macro stream marker in legacy XLS
    if (buffer.includes(Buffer.from('_VBA_PROJECT', 'ascii'))) {
      return { valid: false, detectedKind: 'ole-xls', reason: `Macro-enabled legacy Excel files are blocked for security.` };
    }
    return { valid: true, detectedKind: 'ole-xls' };
  }

  // ZIP / OOXML (.xlsx / .docx)
  if (hasBytes(buffer, 0, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext !== '.xlsx' && ext !== '.docx') {
      return {
        valid: false,
        detectedKind: 'zip-ooxml',
        reason: `Archive/OOXML payloads are only accepted as .xlsx or .docx files (received "${ext}").`,
      };
    }
    // Reject OOXML packages containing VBA macro binaries
    if (
      buffer.includes(Buffer.from('vbaProject.bin', 'ascii')) ||
      buffer.includes(Buffer.from('vbaData.xml', 'ascii'))
    ) {
      return {
        valid: false,
        detectedKind: 'zip-ooxml',
        reason: `Macro-enabled Office files (containing VBA macros) are blocked for security.`,
      };
    }
    if (ext === '.xlsx' && !buffer.includes(Buffer.from('xl/', 'ascii'))) {
      return {
        valid: false,
        detectedKind: 'zip-ooxml',
        reason: `Invalid .xlsx file: missing OOXML workbook entries.`,
      };
    }
    if (ext === '.docx' && !buffer.includes(Buffer.from('word/', 'ascii'))) {
      return {
        valid: false,
        detectedKind: 'zip-ooxml',
        reason: `Invalid .docx file: missing OOXML document entries.`,
      };
    }
    return { valid: true, detectedKind: 'zip-ooxml' };
  }

  // UTF-8 text-based formats (.csv, .tsv, .txt, .json, .md)
  if (TEXT_EXTS.has(ext)) {
    if (looksBinaryText(buffer)) {
      return {
        valid: false,
        detectedKind: 'unknown',
        reason: `File "${filename}" contains binary null bytes and is not valid UTF-8 text.`,
      };
    }
    if (ext === '.json') {
      try {
        JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
      } catch {
        return {
          valid: false,
          detectedKind: 'text',
          reason: `File "${filename}" is not valid JSON.`,
        };
      }
    }
    return { valid: true, detectedKind: 'text' };
  }

  return {
    valid: false,
    detectedKind: 'unknown',
    reason: `Unrecognized or mismatched file signature for "${filename}".`,
  };
}
