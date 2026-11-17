export const DEFAULT_CHUNK_TOKENS = 500;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 75;
export const DEFAULT_MAX_HISTORY_TOKENS = 3000;
export const DEFAULT_AGENT_MAX_STEPS = 6;
export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_UPLOAD_MAX_ROWS = 5000;
export const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_IMAGE_MAX_WIDTH = 1280;
export const DEFAULT_IMAGE_QUALITY = 80;
export const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_IMPORT_BATCH_SIZE = 50;
export const MAX_CHAT_ATTACHMENTS = 5;
export const DEFAULT_FREE_MONTHLY_CREDITS = 100;

export const BLOCKED_DANGEROUS_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.psm1',
  '.msi',
  '.msp',
  '.dll',
  '.scr',
  '.vbs',
  '.vbe',
  '.jse',
  '.wsf',
  '.hta',
  '.xlsm',
  '.xlsb',
  '.xltm',
  '.docm',
  '.dotm',
  '.pptm',
  '.jar',
  '.app',
  '.dmg',
] as const;

export const ALLOWED_SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv'] as const;
export const ALLOWED_SPREADSHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/tab-separated-values',
  'application/csv',
  'text/plain',
  'application/octet-stream',
] as const;

export const ALLOWED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.heic',
] as const;

export const ALLOWED_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const;

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.txt',
  '.json',
  '.md',
] as const;

export const ALLOWED_MULTIMODAL_EXTENSIONS = [
  ...ALLOWED_IMAGE_EXTENSIONS,
  ...ALLOWED_DOCUMENT_EXTENSIONS,
  ...ALLOWED_SPREADSHEET_EXTENSIONS,
] as const;

export const ALLOWED_MULTIMODAL_MIMES = [
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_SPREADSHEET_MIMES,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
  'text/markdown',
  'text/x-markdown',
  'application/zip',
] as const;

export const RTL_LANGUAGE_CODES = new Set(['ar', 'he', 'fa', 'ur']);

export const SUPPORTED_LANGUAGES = {
  en: 'English',
  ml: 'Malayalam',
} as const;
