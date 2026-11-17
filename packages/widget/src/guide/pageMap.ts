import type { AvailableRouteHint, PageMapElement } from '@ai-assistant/core';

const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [role="tab"], [role="button"], [data-ai-id]';

const EXCLUDED_CONTAINER_SELECTOR =
  '.aia-root, .aia-guide-cursor-root, .aia-guide-root, [data-testid="assistant-panel"], .aia-avatar-dock, [aria-hidden="true"]';

function stripHtmlAndWhitespace(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyId(raw: string, fallbackPrefix: string, idx: number): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean ? `${fallbackPrefix}-${clean}` : `${fallbackPrefix}-${idx}`;
}

export function isSensitiveDomElement(el: Element): boolean {
  if (el.getAttribute('data-sensitive') === 'true') return true;
  if (el.getAttribute('data-guide-sensitive') === 'true') return true;
  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement && el.type === 'password') {
    return true;
  }
  return el.getAttribute('type') === 'password';
}

export function getElementLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return stripHtmlAndWhitespace(aria).slice(0, 80);

  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const idAttr = el.getAttribute('id');
    if (idAttr && typeof document !== 'undefined') {
      const assoc = document.querySelector(`label[for="${CSS.escape(idAttr)}"]`);
      if (assoc?.textContent) {
        return stripHtmlAndWhitespace(assoc.textContent).replace(/\s*\*\s*$/, '').slice(0, 60);
      }
    }
    const parentLabel = typeof el.closest === 'function' ? el.closest('label') : null;
    if (parentLabel) {
      const firstSpan = parentLabel.querySelector('span');
      const raw = firstSpan?.textContent || '';
      if (raw.trim()) {
        return stripHtmlAndWhitespace(raw).replace(/\s*\*\s*$/, '').slice(0, 60);
      }
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      return stripHtmlAndWhitespace(placeholder).replace(/^e\.g\.\s+/i, '').slice(0, 80);
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return stripHtmlAndWhitespace(title).slice(0, 80);
    const name = el.getAttribute('name') || el.getAttribute('data-ai-id') || '';
    return stripHtmlAndWhitespace(name).slice(0, 60);
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return stripHtmlAndWhitespace(placeholder).slice(0, 80);

  const title = el.getAttribute('title');
  if (title && title.trim()) return stripHtmlAndWhitespace(title).slice(0, 80);

  // Join multi-span/block button text cleanly (e.g. "Sector Manager" + "Dept Fiqh ledger")
  const rawInner =
    typeof HTMLElement !== 'undefined' &&
    el instanceof HTMLElement &&
    typeof el.innerText === 'string' &&
    el.innerText.trim()
      ? el.innerText.replace(/\s*\n+\s*/g, ' · ')
      : el.textContent || '';
  const text = stripHtmlAndWhitespace(rawInner);
  return text.slice(0, 64);
}

function getElementType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  const role = el.getAttribute('role');
  if (role === 'tab') return 'tab';
  const typeAttr = el.getAttribute('type');
  if (typeAttr) return typeAttr.toLowerCase();
  if (tag === 'button') return 'button';
  return tag;
}

/**
 * Privacy-preserving check: NEVER reads or returns the actual string inside input fields.
 * Returns only true/false whether the control currently holds a non-empty value or checked state.
 */
function getElementHasValue(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const inp = el as HTMLInputElement;
    const type = (inp.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return Boolean(inp.checked);
    }
    return typeof inp.value === 'string' && inp.value.length > 0;
  }
  if (tag === 'select') {
    const sel = el as HTMLSelectElement;
    return typeof sel.value === 'string' && sel.value.length > 0;
  }
  if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement;
    return typeof ta.value === 'string' && ta.value.length > 0;
  }
  return false;
}

function isElementVisible(el: Element, ignoreLayoutRects = false): boolean {
  if (el.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;
  if ((el as HTMLElement).hidden) return false;
  if ((el as HTMLButtonElement).disabled) return false;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return false;

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    let cur: Element | null = el;
    let depth = 0;
    while (cur && depth < 6 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
      const style = window.getComputedStyle(cur);
      const op = Number.parseFloat(style.opacity || '1');
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        op <= 0.05 ||
        style.pointerEvents === 'none'
      ) {
        return false;
      }
      cur = cur.parentElement;
      depth += 1;
    }
  }

  if (!ignoreLayoutRects && typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
  }

  return true;
}

export interface GetPageMapOptions {
  root?: ParentNode;
  currentRoute?: string;
  ignoreLayoutRects?: boolean;
  maxElements?: number;
}

/**
 * Lightweight DOM scanner (Zero screenshots, strict privacy):
 * Scans ONLY visible interactive elements and outputs compact JSON with:
 * { id, tag, type, label, hasValue, currentRoute, sensitive? }
 */
export function getPageMap(options: GetPageMapOptions = {}): PageMapElement[] {
  if (typeof document === 'undefined' && !options.root) return [];

  const root = options.root || document;
  const currentRoute =
    options.currentRoute ||
    (typeof window !== 'undefined' ? window.location.pathname : '/');
  const maxElements = options.maxElements ?? 80;

  const nodes = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
  const seenIds = new Set<string>();
  const result: PageMapElement[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    if (!isElementVisible(el, options.ignoreLayoutRects)) continue;

    const tag = el.tagName.toLowerCase();
    const explicitId =
      el.getAttribute('data-ai-id')?.trim() ||
      el.getAttribute('data-guide-id')?.trim() ||
      el.getAttribute('data-testid')?.trim() ||
      '';

    const label = getElementLabel(el);
    let id = explicitId || slugifyId(label || el.getAttribute('href') || tag, tag, i);

    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);

    const sensitive = isSensitiveDomElement(el);
    result.push({
      id,
      tag,
      type: getElementType(el),
      label,
      hasValue: getElementHasValue(el),
      currentRoute,
      ...(sensitive ? { sensitive: true } : {}),
    });

    if (result.length >= maxElements) break;
  }

  return result;
}

/**
 * App-agnostic DOM route scanner: extracts unique internal route links (<a href="/...">)
 * currently rendered in navigation or page content outside the assistant widget.
 */
export function getAvailableRoutes(options: { root?: ParentNode; ignoreLayoutRects?: boolean } = {}): AvailableRouteHint[] {
  if (typeof document === 'undefined' && !options.root) return [];
  const scope = options.root || document;
  const links = Array.from(scope.querySelectorAll('a[href]'));
  const seenRoutes = new Set<string>();
  const routes: AvailableRouteHint[] = [];

  for (const link of links) {
    if (!isElementVisible(link, options.ignoreLayoutRects)) continue;
    const rawHref = link.getAttribute('href')?.trim() || '';
    if (!rawHref.startsWith('/') || rawHref.startsWith('//')) continue;
    const cleanRoute = rawHref.split('#')[0]?.split('?')[0] || '';
    if (!cleanRoute || seenRoutes.has(cleanRoute)) continue;
    const label = getElementLabel(link) || cleanRoute;
    seenRoutes.add(cleanRoute);
    routes.push({ route: cleanRoute, label: label.slice(0, 80) });
    if (routes.length >= 40) break;
  }

  return routes;
}

export function findElementByAiId(targetId: string, root?: ParentNode): HTMLElement | null {
  if (typeof document === 'undefined' && !root) return null;
  const scope = root || document;
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(targetId)
      : targetId.replace(/"/g, '\\"');

  const direct =
    scope.querySelector(`[data-ai-id="${escaped}"]`) ||
    scope.querySelector(`[data-guide-id="${escaped}"]`) ||
    scope.querySelector(`[data-testid="${escaped}"]`);
  if (direct instanceof HTMLElement && !direct.closest(EXCLUDED_CONTAINER_SELECTOR)) {
    return direct;
  }

  // Fallback: match synthetic slug IDs generated by getPageMap when data-ai-id wasn't present
  const nodes = Array.from(scope.querySelectorAll(INTERACTIVE_SELECTOR));
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    if (el.closest(EXCLUDED_CONTAINER_SELECTOR)) continue;
    const tag = el.tagName.toLowerCase();
    const label = getElementLabel(el);
    const computed = slugifyId(label || el.getAttribute('href') || tag, tag, i);
    if (computed === targetId && el instanceof HTMLElement) {
      return el;
    }
  }
  return null;
}

function isErrorNodeVisible(el: Element): boolean {
  if (el.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;
  if ((el as HTMLElement).hidden) return false;

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    let cur: Element | null = el;
    let depth = 0;
    while (cur && depth < 6 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
      const style = window.getComputedStyle(cur);
      const op = Number.parseFloat(style.opacity || '1');
      if (style.display === 'none' || style.visibility === 'hidden' || op <= 0.05) {
        return false;
      }
      cur = cur.parentElement;
      depth += 1;
    }
  }

  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
  }

  return true;
}

const ERROR_BANNER_SELECTOR =
  '[role="alert"], [data-error="true"], [data-guide-error], .text-debit, .text-destructive, [class*="error-banner"], [class*="form-error"]';

/**
 * Scans the host app DOM outside the assistant widget for visible error messages
 * (e.g. failed login alerts, validation errors, permission denials).
 */
export function getVisiblePageErrors(root?: ParentNode): string[] {
  if (typeof document === 'undefined' && !root) return [];
  const scope = root || document;
  const nodes = Array.from(scope.querySelectorAll(ERROR_BANNER_SELECTOR));
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const el of nodes) {
    if (!isErrorNodeVisible(el)) continue;
    // Skip negative balance/ledger numeric table cells that happen to use .text-debit
    if (
      el.classList.contains('text-debit') &&
      el.closest('td, th, table, .tabular-nums, .num') &&
      !el.matches('[role="alert"], [data-error="true"], [data-guide-error]')
    ) {
      continue;
    }
    const rawText = stripHtmlAndWhitespace(el.textContent || '');
    if (!rawText || rawText.length < 4 || rawText.length > 220) continue;
    if (/^[+\-\u2212\u2013\u2014]?\s*(?:₹|rs\.?|inr|\$|€|£)?\s*[\d,]+(?:\.\d+)?$/i.test(rawText)) {
      continue;
    }
    if (/^\d+\s*(?:debit|credit|students?|entries|rows?)/i.test(rawText)) continue;

    const norm = rawText.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    errors.push(rawText);
    if (errors.length >= 5) break;
  }

  return errors;
}

