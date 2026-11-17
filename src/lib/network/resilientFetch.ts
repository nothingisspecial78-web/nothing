import { useNetworkStore } from './networkStore';
import { enqueueOfflineAction, isPaymentEndpoint } from './offlineQueue';

export interface ResilientFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  queueIfOffline?: boolean;
  actionLabel?: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export class NetworkOfflineError extends Error {
  readonly code = 'NETWORK_OFFLINE';
  constructor(message = 'You are currently offline. Check your connection and retry.') {
    super(message);
    this.name = 'NetworkOfflineError';
  }
}

export class QueuedOfflineResult extends Response {
  readonly queued = true;
  constructor(queueId: string, label: string) {
    super(JSON.stringify({ ok: true, queued: true, queueId, label }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

export async function resilientFetch(
  input: string,
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 12_000,
    maxRetries = 3,
    baseDelayMs = 400,
    queueIfOffline = false,
    actionLabel = 'Saved action',
    idempotencyKey,
    fetchImpl = fetch,
    onRetry,
    ...init
  } = options;

  const isOfflineNow =
    typeof navigator !== 'undefined' && navigator.onLine === false;

  if (isOfflineNow) {
    if (queueIfOffline && !isPaymentEndpoint(input) && init.method && init.method !== 'GET') {
      let parsedBody: unknown = undefined;
      if (typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      const queued = enqueueOfflineAction({
        kind: 'http',
        url: input,
        method: init.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        headers: init.headers as Record<string, string> | undefined,
        body: parsedBody,
        label: actionLabel,
        idempotencyKey,
      });
      return new QueuedOfflineResult(queued.id, actionLabel);
    }
    throw new NetworkOfflineError(
      isPaymentEndpoint(input)
        ? 'Payments cannot be processed while offline. Reconnect to the internet and try again.'
        : 'You appear to be offline. Waiting to reconnect.'
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const elapsed =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      if (typeof window !== 'undefined') {
        useNetworkStore.getState().recordLatency(elapsed);
      }

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, delayMs, new Error(`HTTP ${response.status}`));
        if (typeof window !== 'undefined') useNetworkStore.getState().incrementRetries();
        await sleep(delayMs);
        if (typeof window !== 'undefined') useNetworkStore.getState().decrementRetries();
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      const offlineDuringCall =
        typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offlineDuringCall) {
        if (typeof window !== 'undefined') useNetworkStore.getState().setOnline(false);
        break;
      }

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, delayMs, err);
        if (typeof window !== 'undefined') useNetworkStore.getState().incrementRetries();
        await sleep(delayMs);
        if (typeof window !== 'undefined') useNetworkStore.getState().decrementRetries();
        continue;
      }
    }
  }

  if (queueIfOffline && !isPaymentEndpoint(input) && init.method && init.method !== 'GET') {
    let parsedBody: unknown = undefined;
    if (typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    const queued = enqueueOfflineAction({
      kind: 'http',
      url: input,
      method: init.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: init.headers as Record<string, string> | undefined,
      body: parsedBody,
      label: actionLabel,
      idempotencyKey,
    });
    return new QueuedOfflineResult(queued.id, actionLabel);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Network request failed after multiple retries.');
}
