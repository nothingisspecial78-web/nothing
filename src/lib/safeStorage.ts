export function getSafeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getSafeSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function safeLocalGet(key: string): string | null {
  try {
    return getSafeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeLocalSet(key: string, value: string): void {
  try {
    getSafeLocalStorage()?.setItem(key, value);
  } catch {
    // ignore storage restrictions in cross-origin iframes
  }
}

export function safeLocalRemove(key: string): void {
  try {
    getSafeLocalStorage()?.removeItem(key);
  } catch {
    // ignore storage restrictions in cross-origin iframes
  }
}

export function safeSessionGet(key: string): string | null {
  try {
    return getSafeSessionStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSessionSet(key: string, value: string): void {
  try {
    getSafeSessionStorage()?.setItem(key, value);
  } catch {
    // ignore storage restrictions in cross-origin iframes
  }
}

export function safeSessionRemove(key: string): void {
  try {
    getSafeSessionStorage()?.removeItem(key);
  } catch {
    // ignore storage restrictions in cross-origin iframes
  }
}
