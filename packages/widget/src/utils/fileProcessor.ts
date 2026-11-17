import {
  ALLOWED_MULTIMODAL_EXTENSIONS,
  BLOCKED_DANGEROUS_EXTENSIONS,
  DEFAULT_UPLOAD_MAX_BYTES,
  type ChatAttachment,
} from '@ai-assistant/core';

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

async function sniffDangerousMagicBytes(file: File): Promise<string | null> {
  const slice = file.slice(0, 8192);
  const buf = new Uint8Array(await slice.arrayBuffer());
  if (buf.length === 0) return `File "${file.name}" is empty.`;

  // PE MZ, ELF, Mach-O, Shebang
  if (
    (buf[0] === 0x4d && buf[1] === 0x5a) ||
    (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) ||
    (buf[0] === 0x23 && buf[1] === 0x21)
  ) {
    return `Executable or script payload detected in "${file.name}". Upload rejected.`;
  }

  // ZIP / OOXML macro marker check in first 8 KB + tail slice
  const ext = getExt(file.name);
  if (ext === '.xlsx' || ext === '.docx') {
    const fullCheckBuf = file.size <= 2 * 1024 * 1024 ? new Uint8Array(await file.arrayBuffer()) : buf;
    const text = new TextDecoder('latin1').decode(fullCheckBuf);
    if (text.includes('vbaProject.bin') || text.includes('vbaData.xml')) {
      return `Macro-enabled Office files (vbaProject.bin) are blocked for security.`;
    }
  }

  return null;
}

export async function validateClientFile(file: File): Promise<{ valid: boolean; reason?: string }> {
  const ext = getExt(file.name);
  if ((BLOCKED_DANGEROUS_EXTENSIONS as readonly string[]).includes(ext)) {
    return { valid: false, reason: `Dangerous or macro-enabled file type "${ext}" is blocked.` };
  }
  if (!ext || !(ALLOWED_MULTIMODAL_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      valid: false,
      reason: `Unsupported file type "${ext || 'unknown'}". Supported: PNG, JPG, WEBP, GIF, HEIC, PDF, XLSX, XLS, CSV, TSV, DOCX, TXT, JSON, MD.`,
    };
  }
  if (file.size > DEFAULT_UPLOAD_MAX_BYTES) {
    return {
      valid: false,
      reason: `"${file.name}" (${formatBytes(file.size)}) exceeds the 10 MB file size limit.`,
    };
  }

  const magicErr = await sniffDangerousMagicBytes(file);
  if (magicErr) {
    return { valid: false, reason: magicErr };
  }
  return { valid: true };
}

/**
 * Inline Blob Web Worker helper for non-blocking text hashing / preview prep when
 * external image compression is not applicable.
 */
async function resizeImageViaCanvasFallback(file: File, maxWidth = 1600): Promise<File> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
    );
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function prepareFileForUpload(file: File): Promise<{
  processedFile: File;
  localPreviewUrl?: string;
  localMeta?: string;
}> {
  const ext = getExt(file.name);
  const isHeic = ext === '.heic' || file.type === 'image/heic' || file.type === 'image/heif';
  let workingFile = file;

  if (isHeic) {
    try {
      const mod = await import('heic2any');
      const heic2any = (mod.default || mod) as unknown as (opts: {
        blob: Blob;
        toType: string;
        quality: number;
      }) => Promise<Blob | Blob[]>;
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      if (blob) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
        workingFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
      }
    } catch {
      // Fallback: let server handle HEIC bytes if browser decode unavailable
    }
  }

  const isRasterImage =
    /\.(png|jpg|jpeg|webp|gif)$/i.test(workingFile.name) || workingFile.type.startsWith('image/');

  if (isRasterImage && workingFile.size > 900 * 1024 && workingFile.type !== 'image/gif') {
    try {
      const mod = await import('browser-image-compression');
      const imageCompression = mod.default;
      const compressed = await imageCompression(workingFile, {
        maxSizeMB: 1.4,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      });
      const compressedBlob = compressed as File | Blob;
      if (compressedBlob && compressedBlob.size < workingFile.size) {
        workingFile =
          compressedBlob instanceof File
            ? compressedBlob
            : new File([compressedBlob], workingFile.name, {
                type: compressedBlob.type || workingFile.type,
              });
      }
    } catch {
      workingFile = await resizeImageViaCanvasFallback(workingFile, 1600);
    }
  }

  let localPreviewUrl: string | undefined;
  if (isRasterImage) {
    localPreviewUrl = await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(workingFile);
    });
  }

  let localMeta: string | undefined;
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      const XLSX = await import('xlsx');
      const buf = await workingFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
      const count = wb.SheetNames?.length || 1;
      localMeta = `${count} sheet${count === 1 ? '' : 's'} · ${formatBytes(workingFile.size)}`;
    } catch {
      localMeta = formatBytes(workingFile.size);
    }
  } else if (ext === '.csv' || ext === '.tsv') {
    try {
      const Papa = (await import('papaparse')).default;
      const sampleText = await workingFile.slice(0, 128 * 1024).text();
      const parsed = Papa.parse(sampleText, { skipEmptyLines: 'greedy' });
      const rowEst = Math.max(0, (parsed.data?.length || 1) - 1);
      localMeta = `~${rowEst} rows · ${formatBytes(workingFile.size)}`;
    } catch {
      localMeta = formatBytes(workingFile.size);
    }
  } else {
    localMeta = formatBytes(workingFile.size);
  }

  return {
    processedFile: workingFile,
    localPreviewUrl,
    localMeta,
  };
}

export function uploadFileWithProgress(params: {
  url: string;
  file: File;
  appId: string;
  conversationId?: string;
  headers: Record<string, string>;
  onProgress: (percent: number) => void;
}): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', params.url, true);

    for (const [k, v] of Object.entries(params.headers)) {
      if (k.toLowerCase() === 'content-type') continue;
      xhr.setRequestHeader(k, v);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
        params.onProgress(pct);
      }
    };

    xhr.onload = () => {
      let json: {
        ok?: boolean;
        attachments?: ChatAttachment[];
        error?: string;
        errorCode?: string;
        resetDate?: string;
      } = {};
      try {
        json = JSON.parse(xhr.responseText || '{}');
      } catch {
        // non-JSON response
      }

      if (xhr.status >= 200 && xhr.status < 300 && json.attachments && json.attachments[0]) {
        params.onProgress(100);
        resolve(json.attachments[0]);
      } else {
        const err = new Error(json.error || `Upload failed (HTTP ${xhr.status})`) as Error & {
          status?: number;
          errorCode?: string;
          resetDate?: string;
        };
        err.status = xhr.status;
        err.errorCode = json.errorCode;
        err.resetDate = json.resetDate;
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading file.'));
    xhr.onabort = () => reject(new Error('File upload was cancelled.'));

    const formData = new FormData();
    formData.append('appId', params.appId);
    if (params.conversationId) formData.append('conversationId', params.conversationId);
    formData.append('files', params.file);
    xhr.send(formData);
  });
}
