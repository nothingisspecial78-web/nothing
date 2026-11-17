export async function parseJsonSafely<T = Record<string, unknown>>(
  res: Response,
  fallbackErrorPrefix = 'Request failed'
): Promise<{ data: T | null; isHtml: boolean; rawText: string; errorMessage?: string }> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (err) {
    return {
      data: null,
      isHtml: false,
      rawText: '',
      errorMessage: err instanceof Error ? err.message : `${fallbackErrorPrefix} (${res.status})`,
    };
  }

  const trimmed = rawText.trim();
  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  if (looksLikeHtml) {
    return {
      data: null,
      isHtml: true,
      rawText,
      errorMessage: `API endpoint returned an HTML page instead of JSON (${res.status}). Make sure the backend API server is running.`,
    };
  }

  if (!trimmed) {
    return {
      data: {} as T,
      isHtml: false,
      rawText,
      ...(res.ok ? {} : { errorMessage: `${fallbackErrorPrefix} (${res.status})` }),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return {
      data: parsed,
      isHtml: false,
      rawText,
    };
  } catch {
    return {
      data: null,
      isHtml: false,
      rawText,
      errorMessage: `${fallbackErrorPrefix}: invalid JSON response (${res.status})`,
    };
  }
}
