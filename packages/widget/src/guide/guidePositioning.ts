export interface LayoutRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface GuideBoxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type GuideTooltipPlacement = 'above' | 'below' | 'left' | 'right' | 'center';

export interface GuideCursorLayoutInput {
  targetRect: LayoutRectLike | null;
  cardSize: { width: number; height: number };
  viewport: { width: number; height: number };
  appName?: string;
  isComplete?: boolean;
  preferredAnchorCursor?: { x: number; y: number };
  containerRect?: LayoutRectLike | null;
  containerIsModal?: boolean;
  avoidRects?: LayoutRectLike[];
  floatingHint?: { x: number; y: number; placement: string } | null;
}

export interface GuideCursorLayoutResult {
  cursorPos: { x: number; y: number };
  cardLeft: number;
  cardTop: number;
  cardWidth: number;
  placement: GuideTooltipPlacement;
  hadCollision: boolean;
}

export function rectsOverlap(a: GuideBoxRect, b: GuideBoxRect, pad = 6): boolean {
  return !(
    a.right + pad <= b.left ||
    a.left - pad >= b.right ||
    a.bottom + pad <= b.top ||
    a.top - pad >= b.bottom
  );
}

function intersectionArea(a: GuideBoxRect, b: GuideBoxRect, pad = 0): number {
  const xOverlap = Math.max(0, Math.min(a.right + pad, b.right) - Math.max(a.left - pad, b.left));
  const yOverlap = Math.max(0, Math.min(a.bottom + pad, b.bottom) - Math.max(a.top - pad, b.top));
  return xOverlap * yOverlap;
}

function mapFloatingPlacement(raw?: string): GuideTooltipPlacement {
  if (!raw) return 'above';
  if (raw.startsWith('top')) return 'above';
  if (raw.startsWith('bottom')) return 'below';
  if (raw.startsWith('left')) return 'left';
  if (raw.startsWith('right')) return 'right';
  return 'above';
}

/**
 * Pure dynamic collision-detection & auto-flip layout solver for the tour step card
 * and agent cursor pointer + name pill.
 *
 * Guarantees:
 * - Cursor + app name pill stay clamped inside the viewport and never clip edges,
 *   while avoiding centered Stop Guide dock without prematurely pushing side-placed
 *   buttons' pointers upward onto unrelated inputs.
 * - Tooltip card measures real height/width and checks vertical space above vs below
 *   the target, active modal/drawer container (`containerRect`), and visible DOM
 *   obstacles (`avoidRects` like form fields, buttons, and table columns), preferring
 *   clear space outside active drawers/modals first.
 */
export function computeGuideCursorLayout(
  input: GuideCursorLayoutInput
): GuideCursorLayoutResult {
  const vw = Math.max(320, input.viewport.width);
  const vh = Math.max(320, input.viewport.height);
  const displayAppName = (input.appName || 'App').trim() || 'App';
  const isComplete = Boolean(input.isComplete);
  const targetRect = input.targetRect;
  const containerRect = input.containerRect ?? null;
  const containerIsModal = Boolean(input.containerIsModal);
  const avoidRects = Array.isArray(input.avoidRects) ? input.avoidRects : [];

  const cardWidth = Math.min(Math.max(240, input.cardSize.width || 310), Math.max(240, vw - 24));
  const cardHeight = Math.max(110, input.cardSize.height || 168);

  const margin = 12;
  const bottomSafeReserve = 76; // Centered Stop Guide dock height + margin
  const maxCardLeft = Math.max(margin, vw - cardWidth - margin);
  const maxCardTop = Math.max(margin, vh - cardHeight - bottomSafeReserve);

  // Estimate cursor pointer + name pill bounding box
  const pillEstimatedWidth = Math.min(185, Math.max(98, 56 + displayAppName.length * 7.5));
  const cursorFootprintWidth = Math.max(32, pillEstimatedWidth + 16);
  const cursorFootprintHeight = 46;

  // Compute clamped/adjusted cursor position
  const rawCursorX =
    input.preferredAnchorCursor?.x ??
    (targetRect
      ? targetRect.left + Math.min(targetRect.width * 0.72, Math.max(10, targetRect.width - 10))
      : vw * 0.5);
  const rawCursorY =
    input.preferredAnchorCursor?.y ??
    (targetRect
      ? targetRect.top + Math.min(targetRect.height * 0.65, Math.max(8, targetRect.height - 8))
      : vh * 0.42);

  // Clamp cursor + name pill cleanly inside viewport so pill never gets cut off on right/bottom edges
  const cursorX = Math.max(
    12,
    Math.min(vw - cursorFootprintWidth - 8, Math.round(rawCursorX))
  );

  // Bottom Stop Guide dock horizontal footprint: only reserve 76px vertically when cursor overlaps the centered Stop dock
  const stopDockLeft = vw / 2 - 110;
  const stopDockRight = vw / 2 + 110;
  const cursorOverlapsStopDockHorizontally =
    cursorX + cursorFootprintWidth >= stopDockLeft && cursorX <= stopDockRight;
  const cursorBottomLimit = cursorOverlapsStopDockHorizontally
    ? vh - cursorFootprintHeight - bottomSafeReserve
    : vh - cursorFootprintHeight - 6;

  const cursorY = Math.max(
    12,
    Math.min(cursorBottomLimit, Math.round(rawCursorY))
  );

  const cursorBox: GuideBoxRect = {
    left: cursorX - 6,
    top: cursorY - 6,
    right: cursorX + pillEstimatedWidth + 8,
    bottom: cursorY + cursorFootprintHeight,
  };

  // Top Screen Share pill box
  const topPillBox: GuideBoxRect = {
    left: vw / 2 - 175,
    top: 0,
    right: vw / 2 + 175,
    bottom: 58,
  };

  // Bottom Stop Guide dock box
  const bottomDockBox: GuideBoxRect = {
    left: vw / 2 - 96,
    top: vh - bottomSafeReserve,
    right: vw / 2 + 96,
    bottom: vh,
  };

  const clampCandidate = (
    rawLeft: number,
    rawTop: number,
    placement: GuideTooltipPlacement
  ): { left: number; top: number; placement: GuideTooltipPlacement } => ({
    left: Math.max(margin, Math.min(maxCardLeft, Math.round(rawLeft))),
    top: Math.max(margin, Math.min(maxCardTop, Math.round(rawTop))),
    placement,
  });

  const gap = 16;
  const candidates: Array<{
    left: number;
    top: number;
    placement: GuideTooltipPlacement;
    priorityBias: number;
  }> = [];

  const pushOutsideContainerCandidates = (baseBias: number) => {
    if (!containerRect) return;
    const anchorY = targetRect
      ? targetRect.top + targetRect.height / 2 - cardHeight / 2
      : containerRect.top + Math.min(96, containerRect.height * 0.2);
    const altY = targetRect
      ? targetRect.top - cardHeight + targetRect.height
      : containerRect.top + 24;

    if (containerRect.left - cardWidth - 18 >= margin) {
      candidates.push({
        ...clampCandidate(containerRect.left - cardWidth - 18, anchorY, 'left'),
        priorityBias: baseBias,
      });
      candidates.push({
        ...clampCandidate(containerRect.left - cardWidth - 18, altY, 'left'),
        priorityBias: baseBias + 0.5,
      });
      candidates.push({
        ...clampCandidate(containerRect.left - cardWidth - 18, containerRect.top + 28, 'left'),
        priorityBias: baseBias + 1,
      });
    }
    if (containerRect.right + cardWidth + 18 <= vw - margin) {
      candidates.push({
        ...clampCandidate(containerRect.right + 18, anchorY, 'right'),
        priorityBias: baseBias + 0.25,
      });
      candidates.push({
        ...clampCandidate(containerRect.right + 18, containerRect.top + 28, 'right'),
        priorityBias: baseBias + 1.25,
      });
    }
    if (containerRect.top - cardHeight - 18 >= margin) {
      candidates.push({
        ...clampCandidate(
          containerRect.left + containerRect.width / 2 - cardWidth / 2,
          containerRect.top - cardHeight - 18,
          'above'
        ),
        priorityBias: baseBias + 1.5,
      });
    }
    if (containerRect.bottom + cardHeight + 18 <= vh - bottomSafeReserve) {
      candidates.push({
        ...clampCandidate(
          containerRect.left + containerRect.width / 2 - cardWidth / 2,
          containerRect.bottom + 18,
          'below'
        ),
        priorityBias: baseBias + 1.75,
      });
    }
  };

  const pushClearFallbackCorners = (baseBias: number) => {
    candidates.push(
      { ...clampCandidate(vw - cardWidth - 18, 68, 'right'), priorityBias: baseBias },
      { ...clampCandidate(18, 68, 'left'), priorityBias: baseBias + 1 },
      { ...clampCandidate(18, maxCardTop, 'left'), priorityBias: baseBias + 2 },
      { ...clampCandidate(vw - cardWidth - 18, maxCardTop, 'right'), priorityBias: baseBias + 3 }
    );
  };

  const scoreObstacles = (box: GuideBoxRect): number => {
    let penalty = 0;
    if (rectsOverlap(box, cursorBox, 8)) {
      penalty += 3000 + intersectionArea(box, cursorBox, 8);
    }
    if (rectsOverlap(box, topPillBox, 6)) {
      penalty += 1500 + intersectionArea(box, topPillBox, 6);
    }
    if (rectsOverlap(box, bottomDockBox, 6)) {
      penalty += 1500 + intersectionArea(box, bottomDockBox, 6);
    }
    if (containerRect && (containerIsModal || containerRect.width < vw * 0.85)) {
      if (rectsOverlap(box, containerRect, 6)) {
        penalty += 1800 + intersectionArea(box, containerRect, 6);
      }
    }
    for (const obs of avoidRects) {
      if (rectsOverlap(box, obs, 4)) {
        penalty += 2200 + intersectionArea(box, obs, 4) * 1.5;
      }
    }
    return penalty;
  };

  if (targetRect && !isComplete) {
    const targetBox: GuideBoxRect = {
      left: targetRect.left,
      top: targetRect.top,
      right: targetRect.right,
      bottom: targetRect.bottom,
    };

    const effectiveTopFloor = rectsOverlap(
      {
        left: targetRect.left,
        top: 0,
        right: Math.max(targetRect.right, targetRect.left + cardWidth),
        bottom: 60,
      },
      topPillBox,
      4
    )
      ? 62
      : margin;

    const availAbove = targetRect.top - effectiveTopFloor;
    const availBelow = vh - bottomSafeReserve - targetRect.bottom;
    const canFitAbove = availAbove >= cardHeight + gap;
    const canFitBelow = availBelow >= cardHeight + gap;

    // Horizontal alignments centered over target, left-aligned with target, or shifted clear of cursor
    const targetCenterLeft = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    const xOffsets = [
      targetRect.left,
      targetCenterLeft,
      targetRect.right - cardWidth,
      cursorBox.left - cardWidth - 14,
      cursorBox.right + 14,
    ];

    const pushAbove = (bias: number) => {
      for (let i = 0; i < xOffsets.length; i++) {
        const clamped = clampCandidate(xOffsets[i]!, targetRect.top - cardHeight - gap, 'above');
        candidates.push({ ...clamped, priorityBias: bias + i });
      }
    };

    const pushBelow = (bias: number) => {
      const topBelowTarget = targetRect.bottom + gap;
      const topBelowCursor = Math.max(targetRect.bottom + gap, cursorBox.bottom + 12);
      for (let i = 0; i < xOffsets.length; i++) {
        const c1 = clampCandidate(xOffsets[i]!, topBelowTarget, 'below');
        candidates.push({ ...c1, priorityBias: bias + i });
        if (topBelowCursor !== topBelowTarget) {
          const c2 = clampCandidate(xOffsets[i]!, topBelowCursor, 'below');
          candidates.push({ ...c2, priorityBias: bias + i + 0.5 });
        }
      }
    };

    const pushSides = (bias: number) => {
      const fitsRight = targetRect.right + cardWidth + 22 <= vw - margin;
      const fitsLeft = targetRect.left - cardWidth - 22 >= margin;
      const midY = targetRect.top + targetRect.height / 2 - cardHeight / 2;
      if (fitsRight) {
        candidates.push({
          ...clampCandidate(targetRect.right + 20, targetRect.top - 8, 'right'),
          priorityBias: bias,
        });
        candidates.push({
          ...clampCandidate(targetRect.right + 20, midY, 'right'),
          priorityBias: bias + 1,
        });
      }
      if (fitsLeft) {
        candidates.push({
          ...clampCandidate(targetRect.left - cardWidth - 20, targetRect.top - 8, 'left'),
          priorityBias: bias,
        });
        candidates.push({
          ...clampCandidate(targetRect.left - cardWidth - 20, midY, 'left'),
          priorityBias: bias + 1,
        });
      }
    };

    // When target sits inside an active modal/drawer/narrow container, prioritize sitting right outside the container first
    if (containerRect && (containerIsModal || containerRect.width < vw * 0.85)) {
      pushOutsideContainerCandidates(0);
    }

    if (input.floatingHint) {
      candidates.push({
        ...clampCandidate(
          input.floatingHint.x,
          input.floatingHint.y,
          mapFloatingPlacement(input.floatingHint.placement)
        ),
        priorityBias: 2,
      });
    }

    // Automatic above <-> below dynamic preference based on available vertical room:
    // If above fits comfortably, evaluate above before below;
    // when scrolled so insufficient space exists above (`!canFitAbove`), automatically flip to below!
    if (canFitAbove && !canFitBelow) {
      pushAbove(4);
      pushSides(10);
      pushBelow(22);
    } else if (!canFitAbove && canFitBelow) {
      pushBelow(4);
      pushSides(10);
      pushAbove(22);
    } else if (canFitAbove && canFitBelow) {
      // Both fit: prefer above unless target is in upper quarter near top Share pill
      if (availAbove >= cardHeight + gap + 12) {
        pushAbove(4);
        pushBelow(10);
        pushSides(14);
      } else {
        pushBelow(4);
        pushAbove(10);
        pushSides(14);
      }
    } else {
      // Tight vertical viewport on both sides: try sides first, then whichever vertical side has more room
      pushSides(4);
      if (availBelow >= availAbove) {
        pushBelow(8);
        pushAbove(16);
      } else {
        pushAbove(8);
        pushBelow(16);
      }
    }

    // Fallback open corners when every immediate candidate collides with tables or fields
    pushClearFallbackCorners(40);

    let chosen = candidates[0]!;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const cand of candidates) {
      const box: GuideBoxRect = {
        left: cand.left,
        top: cand.top,
        right: cand.left + cardWidth,
        bottom: cand.top + cardHeight,
      };

      let penalty = cand.priorityBias + scoreObstacles(box);
      // Target overlap is unacceptable unless viewport cannot fit otherwise
      if (rectsOverlap(box, targetBox, 8)) {
        penalty += 5000 + intersectionArea(box, targetBox, 8);
      }

      if (penalty < bestScore) {
        bestScore = penalty;
        chosen = cand;
      }
    }

    return {
      cursorPos: { x: cursorX, y: cursorY },
      cardLeft: chosen.left,
      cardTop: chosen.top,
      cardWidth,
      placement: chosen.placement,
      hadCollision: bestScore >= 1500,
    };
  }

  // No target spotlight (e.g. loading transition, ask_user follow-up, completion, navigation, or error):
  if (containerRect && (containerIsModal || containerRect.width < vw * 0.85)) {
    pushOutsideContainerCandidates(0);
  }
  candidates.push(
    { ...clampCandidate((vw - cardWidth) / 2, cursorBox.bottom + 20, 'below'), priorityBias: 6 },
    {
      ...clampCandidate((vw - cardWidth) / 2, cursorBox.top - cardHeight - 20, 'above'),
      priorityBias: 7,
    },
    { ...clampCandidate(cursorBox.right + 20, cursorY - 20, 'right'), priorityBias: 8 },
    { ...clampCandidate(cursorBox.left - cardWidth - 20, cursorY - 20, 'left'), priorityBias: 9 },
    { ...clampCandidate((vw - cardWidth) / 2, vh * 0.25, 'center'), priorityBias: 12 }
  );
  pushClearFallbackCorners(14);

  let chosen = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const box: GuideBoxRect = {
      left: cand.left,
      top: cand.top,
      right: cand.left + cardWidth,
      bottom: cand.top + cardHeight,
    };
    const penalty = cand.priorityBias + scoreObstacles(box);
    if (penalty < bestScore) {
      bestScore = penalty;
      chosen = cand;
    }
  }

  return {
    cursorPos: { x: cursorX, y: cursorY },
    cardLeft: chosen.left,
    cardTop: chosen.top,
    cardWidth,
    placement: chosen.placement,
    hadCollision: bestScore >= 1500,
  };
}

