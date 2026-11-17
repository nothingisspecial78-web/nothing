import crypto from 'node:crypto';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import sharp from 'sharp';
import { DEFAULT_IMAGE_MAX_WIDTH, DEFAULT_IMAGE_QUALITY } from '@ai-assistant/core';
import { logger } from '../config.ts';

export interface ParsedDocumentResult {
  sha256: string;
  sizeBytes: number;
  pageCount?: number;
  geminiFileUri?: string;
  extractedText?: string;
  dataUrl?: string;
  previewSummary: string;
}

const MAX_CACHE_ENTRIES = 80;
const documentCache = new Map<string, ParsedDocumentResult>();

function cacheGet(key: string): ParsedDocumentResult | undefined {
  const existing = documentCache.get(key);
  if (!existing) return undefined;
  // Refresh LRU order
  documentCache.delete(key);
  documentCache.set(key, existing);
  return existing;
}

function cacheSet(key: string, value: ParsedDocumentResult): void {
  if (documentCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = documentCache.keys().next().value;
    if (oldest) documentCache.delete(oldest);
  }
  documentCache.set(key, value);
}

function estimatePdfPagesFast(buffer: Buffer): number {
  const raw = buffer.toString('latin1');
  const matches = raw.match(/\/Type\s*\/Page\b/g);
  return matches ? Math.max(1, matches.length) : 1;
}

async function extractPdfTextWithPdfJs(
  buffer: Buffer
): Promise<{ text: string; pageCount: number }> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (src: { data: Uint8Array; disableWorker?: boolean }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }>;
      }>;
    };
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;

  const pagesToRead = Math.min(doc.numPages, 20);
  const parts: string[] = [];
  for (let i = 1; i <= pagesToRead; i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items.map((it) => it.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (pageText) {
      parts.push(`[Page ${i}]\n${pageText}`);
    }
  }
  return {
    text: parts.join('\n\n').slice(0, 35000),
    pageCount: doc.numPages,
  };
}

async function uploadToGeminiFiles(params: {
  geminiApiKey: string;
  buffer: Buffer;
  mimeType: string;
  displayName: string;
}): Promise<string | undefined> {
  const ai = new GoogleGenAI({
    apiKey: params.geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const blob = new Blob([new Uint8Array(params.buffer)], { type: params.mimeType });
  const uploaded = await ai.files.upload({
    file: blob,
    config: {
      mimeType: params.mimeType,
      displayName: params.displayName,
    },
  });
  return uploaded?.uri || undefined;
}

export async function parseUploadedDocument(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  geminiApiKey?: string;
  conversationId?: string;
}): Promise<ParsedDocumentResult> {
  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const cacheKey = `${params.conversationId || 'default'}:${sha256}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const ext = path.extname(params.filename || '').toLowerCase();
  const sizeBytes = params.buffer.length;
  let result: ParsedDocumentResult;

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif' || ext === '.heic') {
    let dataUrl: string | undefined;
    let geminiFileUri: string | undefined;

    if (params.geminiApiKey && sizeBytes > 1.5 * 1024 * 1024) {
      try {
        geminiFileUri = await uploadToGeminiFiles({
          geminiApiKey: params.geminiApiKey,
          buffer: params.buffer,
          mimeType: params.mimeType || 'image/jpeg',
          displayName: params.filename,
        });
      } catch (err) {
        logger.warn({ err, filename: params.filename }, 'Gemini large image upload failed; falling back to inline compression');
      }
    }

    try {
      const processed = await sharp(params.buffer)
        .resize({ width: DEFAULT_IMAGE_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: DEFAULT_IMAGE_QUALITY, mozjpeg: true })
        .toBuffer();
      dataUrl = `data:image/jpeg;base64,${processed.toString('base64')}`;
    } catch {
      const mime = params.mimeType || 'image/png';
      dataUrl = `data:${mime};base64,${params.buffer.toString('base64')}`;
    }

    result = {
      sha256,
      sizeBytes,
      geminiFileUri,
      dataUrl,
      previewSummary: `Image (${Math.round(sizeBytes / 1024)} KB)${geminiFileUri ? ' · Gemini File API' : ''}`,
    };
  } else if (ext === '.pdf') {
    let pageCount = estimatePdfPagesFast(params.buffer);
    let geminiFileUri: string | undefined;
    let extractedText: string | undefined;

    if (params.geminiApiKey) {
      try {
        geminiFileUri = await uploadToGeminiFiles({
          geminiApiKey: params.geminiApiKey,
          buffer: params.buffer,
          mimeType: 'application/pdf',
          displayName: params.filename,
        });
      } catch (err) {
        logger.warn({ err, filename: params.filename }, 'Gemini PDF upload failed; using pdfjs-dist fallback');
      }
    }

    if (!geminiFileUri) {
      try {
        const pdfData = await extractPdfTextWithPdfJs(params.buffer);
        pageCount = pdfData.pageCount;
        extractedText = pdfData.text;
      } catch (err) {
        logger.warn({ err, filename: params.filename }, 'pdfjs-dist fallback extraction failed');
      }
    }

    result = {
      sha256,
      sizeBytes,
      pageCount,
      geminiFileUri,
      extractedText,
      previewSummary: `PDF · ${pageCount} page${pageCount === 1 ? '' : 's'} (${Math.max(1, Math.round(sizeBytes / 1024))} KB)`,
    };
  } else if (ext === '.docx') {
    const docx = await mammoth.extractRawText({ buffer: params.buffer });
    const text = (docx.value || '').trim().slice(0, 35000);
    result = {
      sha256,
      sizeBytes,
      extractedText: text,
      previewSummary: `DOCX document · ${text.length} chars extracted`,
    };
  } else {
    // .txt, .md, .json
    const rawText = params.buffer.toString('utf8').replace(/^\uFEFF/, '').trim().slice(0, 35000);
    result = {
      sha256,
      sizeBytes,
      extractedText: rawText,
      previewSummary: `${ext.replace('.', '').toUpperCase() || 'TEXT'} · ${rawText.length} chars`,
    };
  }

  cacheSet(cacheKey, result);
  return result;
}
