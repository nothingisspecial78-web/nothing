import { useCallback } from 'react';
import type { RightClickContext } from '@ai-assistant/core';

function buildCssSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current.nodeType === 1 && depth < 4) {
    let selector = current.tagName.toLowerCase();
    const classList = Array.from(current.classList)
      .filter((c) => !c.startsWith('hover:') && !c.startsWith('focus:') && c.length < 32)
      .slice(0, 2);
    if (classList.length > 0) {
      selector += '.' + classList.map((c) => CSS.escape(c)).join('.');
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const currentTag = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === currentTag
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(selector);
    if (current.tagName.toLowerCase() === 'main' || current.tagName.toLowerCase() === 'body') {
      break;
    }
    current = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

function extractReadableText(el: Element): string {
  if (typeof document === 'undefined' || typeof document.createTreeWalker !== 'function') {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent && parent.closest('[aria-hidden="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent && node.textContent.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const chunk = current.textContent?.replace(/\s+/g, ' ').trim();
    if (chunk) parts.push(chunk);
    current = walker.nextNode();
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function findNearbyLabel(el: Element): string | undefined {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim();
  }

  const th = el.closest('th, td');
  if (th) {
    const table = th.closest('table');
    if (table && th instanceof HTMLTableCellElement) {
      const headerCell = table.querySelectorAll('thead th')[th.cellIndex];
      if (headerCell?.textContent) return headerCell.textContent.trim();
    }
  }

  const ownHeading = el.querySelector(
    'h1, h2, h3, h4, legend, [data-card-title], .uppercase, [class*="tracking-wider"]'
  );
  if (ownHeading) {
    const text = extractReadableText(ownHeading);
    if (text) return text.slice(0, 120);
  }

  if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (!parent || !parent.closest('[aria-hidden="true"]')) {
        const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (text.length >= 2 && text.length <= 64 && /[A-Za-z\u0600-\u06FF\u0900-\u097F\u0D00-\u0D7F]/.test(text)) {
          return text;
        }
      }
      node = walker.nextNode();
    }
  }

  return undefined;
}

export function useContextCapture() {
  return useCallback((target: EventTarget | null): RightClickContext => {
    const selectedText = window.getSelection()?.toString().trim().slice(0, 500) || undefined;
    const routePath = `${window.location.pathname}${window.location.hash || ''}`;
    const pageTitle = document.title || undefined;

    if (!(target instanceof Element)) {
      return { routePath, pageTitle, selectedText };
    }

    let rawText = extractReadableText(target).slice(0, 450) || undefined;
    const nearbyLabel = findNearbyLabel(target);

    // If a user clicked a bare metric/value leaf node (e.g. "4" or "130,500") inside a compact card div,
    // include the compact card container text so the assistant sees both the label and value.
    const parentEl = target.parentElement;
    if (
      parentEl &&
      (!rawText || rawText.length < 32) &&
      ['div', 'li', 'tr', 'a', 'button'].includes(parentEl.tagName.toLowerCase())
    ) {
      const parentText = extractReadableText(parentEl);
      if (parentText.length > (rawText?.length || 0) && parentText.length <= 280) {
        rawText = parentText;
      }
    }

    return {
      tag: target.tagName.toLowerCase(),
      text: rawText,
      nearbyLabel,
      cssSelector: buildCssSelector(target),
      routePath,
      selectedText,
      pageTitle,
    };
  }, []);
}
