import type { GuideStepTarget } from '@ai-assistant/core';

export interface ResolvedTarget {
  element: HTMLElement | null;
  rect: DOMRect | null;
  isFallback: boolean;
  notFound: boolean;
}

/**
 * TargetResolver: Finds UI elements by data-guide-id with fallbacks,
 * MutationObserver polling, scroll-into-view, and mobile drawer handling.
 */
export class TargetResolver {
  private observer: MutationObserver | null = null;
  private timeoutId: number | null = null;

  /**
   * Resolves target element on screen.
   * Order: [data-guide-id="id"] -> fallbacks -> text match
   */
  resolveDirect(target: GuideStepTarget | null): HTMLElement | null {
    if (!target) return null;
    if (typeof document === 'undefined') return null;

    // 1. Primary data-guide-id
    const primary = document.querySelector<HTMLElement>(`[data-guide-id="${target.guideId}"]`);
    if (primary && this.isVisible(primary)) return primary;

    // 2. Check fallbacks
    if (target.fallbacks) {
      for (const fb of target.fallbacks) {
        try {
          if (fb.startsWith('[') || fb.startsWith('.') || fb.startsWith('#') || fb.includes('[')) {
            const el = document.querySelector<HTMLElement>(fb);
            if (el && this.isVisible(el)) return el;
          } else if (fb.startsWith('button:contains(')) {
            const textMatch = fb.slice(17, -2).trim().toLowerCase();
            const btns = Array.from(document.querySelectorAll<HTMLElement>('button, a'));
            const found = btns.find((b) => (b.textContent || '').toLowerCase().includes(textMatch));
            if (found && this.isVisible(found)) return found;
          } else {
            const el = document.querySelector<HTMLElement>(`[data-guide-id="${fb}"]`);
            if (el && this.isVisible(el)) return el;
          }
        } catch {
          // ignore selector parse error
        }
      }
    }

    return null;
  }

  /**
   * Checks if element is visible and rendered
   */
  isVisible(el: HTMLElement): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Asynchronously waits up to timeoutMs for element to appear in DOM.
   * Handles collapsed mobile menus by opening them if needed.
   */
  async waitForTarget(
    target: GuideStepTarget | null,
    timeoutMs = 8000
  ): Promise<ResolvedTarget> {
    if (!target) {
      return { element: null, rect: null, isFallback: false, notFound: false };
    }

    // Try immediate resolve
    const immediate = this.resolveDirect(target);
    if (immediate) {
      if (target.scrollIntoView !== false) {
        immediate.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
      return {
        element: immediate,
        rect: immediate.getBoundingClientRect(),
        isFallback: false,
        notFound: false,
      };
    }

    // Check if element is inside a collapsed mobile navigation
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    if (isMobile && target.guideId.startsWith('nav-')) {
      const mobileBtn = document.querySelector<HTMLElement>('[data-guide-id="mobile-menu-button"]');
      if (mobileBtn && this.isVisible(mobileBtn)) {
        mobileBtn.click();
      }
    }

    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }
        if (this.timeoutId !== null) {
          window.clearTimeout(this.timeoutId);
          this.timeoutId = null;
        }
      };

      const check = () => {
        if (resolved) return;
        const el = this.resolveDirect(target);
        if (el) {
          resolved = true;
          cleanup();
          if (target.scrollIntoView !== false) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
          }
          resolve({
            element: el,
            rect: el.getBoundingClientRect(),
            isFallback: false,
            notFound: false,
          });
        }
      };

      this.observer = new MutationObserver(() => check());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      this.timeoutId = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        console.warn(`[TargetResolver] Target not found after ${timeoutMs}ms:`, target);
        resolve({
          element: null,
          rect: null,
          isFallback: true,
          notFound: true,
        });
      }, timeoutMs);

      // Initial tick check
      check();
    });
  }

  async resolve(target: GuideStepTarget | null, timeoutMs = 8000): Promise<ResolvedTarget> {
    return this.waitForTarget(target, timeoutMs);
  }

  cancel(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  destroy(): void {
    this.cancel();
  }
}
