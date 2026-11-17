import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeGuideCursorLayout, rectsOverlap } from './guidePositioning.ts';

describe('GuideCursor Dynamic Collision & Auto-Flip Layout', () => {
  const viewport = { width: 1280, height: 720 };
  const cardSize = { width: 320, height: 170 };

  it('places the tooltip card above the target when sufficient vertical space exists', () => {
    const targetRect = {
      left: 460,
      top: 340,
      right: 760,
      bottom: 388,
      width: 300,
      height: 48,
    };

    const res = computeGuideCursorLayout({
      targetRect,
      cardSize,
      viewport,
      appName: 'Khazna',
    });

    assert.equal(res.placement, 'above');
    assert.ok(res.cardTop + cardSize.height <= targetRect.top, 'Card should sit cleanly above target');
    assert.equal(res.hadCollision, false);

    const cardBox = {
      left: res.cardLeft,
      top: res.cardTop,
      right: res.cardLeft + res.cardWidth,
      bottom: res.cardTop + cardSize.height,
    };
    assert.equal(rectsOverlap(cardBox, targetRect, 4), false);
  });

  it('automatically flips tooltip from above to below when scrolling target near the top of viewport', () => {
    const targetNearTop = {
      left: 460,
      top: 78,
      right: 760,
      bottom: 124,
      width: 300,
      height: 46,
    };

    const res = computeGuideCursorLayout({
      targetRect: targetNearTop,
      cardSize,
      viewport,
      appName: 'Khazna',
    });

    assert.equal(res.placement, 'below');
    assert.ok(res.cardTop >= targetNearTop.bottom, 'Card should flip below target when vertical space above is insufficient');
    assert.equal(res.hadCollision, false);
  });

  it('automatically flips tooltip from below back to above when target sits near the bottom dock', () => {
    const targetNearBottom = {
      left: 460,
      top: 560,
      right: 760,
      bottom: 606,
      width: 300,
      height: 46,
    };

    const res = computeGuideCursorLayout({
      targetRect: targetNearBottom,
      cardSize,
      viewport,
      appName: 'Khazna',
    });

    assert.equal(res.placement, 'above');
    assert.ok(res.cardTop + cardSize.height <= targetNearBottom.top);
    assert.equal(res.hadCollision, false);
  });

  it('clamps the agent cursor pointer and app pill inside the viewport near right/bottom edges without drifting off side buttons', () => {
    const targetAtRightEdge = {
      left: 1180,
      top: 640,
      right: 1272,
      bottom: 684,
      width: 92,
      height: 44,
    };

    const res = computeGuideCursorLayout({
      targetRect: targetAtRightEdge,
      cardSize,
      viewport,
      appName: 'Khazna Campus',
    });

    assert.ok(res.cursorPos.x <= viewport.width - 120, `Expected clamped cursor X, got ${res.cursorPos.x}`);
    assert.ok(res.cursorPos.y <= viewport.height - 46, `Expected pill inside viewport bottom, got ${res.cursorPos.y}`);
    assert.ok(
      res.cursorPos.y >= targetAtRightEdge.top,
      `Expected cursor Y (${res.cursorPos.y}) to point onto the button (${targetAtRightEdge.top}..${targetAtRightEdge.bottom}) instead of drifting up onto fields above`
    );

    // Centered bottom target should still stay clear above centered Stop Guide dock
    const centeredBottomTarget = {
      left: 560,
      top: 650,
      right: 720,
      bottom: 694,
      width: 160,
      height: 44,
    };
    const centeredRes = computeGuideCursorLayout({
      targetRect: centeredBottomTarget,
      cardSize,
      viewport,
      appName: 'Khazna',
    });
    assert.ok(centeredRes.cursorPos.y <= viewport.height - 110);
  });

  it('moves the tour card cleanly outside an active right-side drawer so Guardian/Phone/Date inputs are never hidden (Pic 2)', () => {
    const drawerRect = {
      left: 832,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 448,
      height: 720,
    };
    const addStudentSubmitBtn = {
      left: 1120,
      top: 652,
      right: 1256,
      bottom: 696,
      width: 136,
      height: 44,
    };
    const drawerFields = [
      { left: 856, top: 270, right: 1256, bottom: 314, width: 400, height: 44 }, // Guardian Name
      { left: 856, top: 355, right: 1048, bottom: 399, width: 192, height: 44 }, // Phone Number
      { left: 1064, top: 355, right: 1256, bottom: 399, width: 192, height: 44 }, // Joined Date
      { left: 1016, top: 652, right: 1104, bottom: 696, width: 88, height: 44 }, // Cancel
    ];

    const res = computeGuideCursorLayout({
      targetRect: addStudentSubmitBtn,
      cardSize,
      viewport,
      appName: 'Khazna',
      containerRect: drawerRect,
      containerIsModal: true,
      avoidRects: drawerFields,
    });

    assert.equal(res.placement, 'left');
    assert.equal(res.hadCollision, false);
    assert.ok(
      res.cardLeft + res.cardWidth <= drawerRect.left,
      `Expected card (${res.cardLeft}..${res.cardLeft + res.cardWidth}) to sit left of drawer (${drawerRect.left})`
    );
    const cardBox = {
      left: res.cardLeft,
      top: res.cardTop,
      right: res.cardLeft + res.cardWidth,
      bottom: res.cardTop + cardSize.height,
    };
    for (const field of drawerFields) {
      assert.equal(rectsOverlap(cardBox, field, 4), false, 'Card must not overlap drawer inputs or buttons');
    }
  });

  it('keeps the loading/transition tour card clear of Students table columns when no modal is open (Pic 1)', () => {
    const tableHeaderAndRows = [
      { left: 260, top: 230, right: 1240, bottom: 278, width: 980, height: 48 },
      { left: 260, top: 278, right: 1240, bottom: 334, width: 980, height: 56 },
      { left: 260, top: 334, right: 1240, bottom: 390, width: 980, height: 56 },
    ];

    const res = computeGuideCursorLayout({
      targetRect: null,
      cardSize,
      viewport,
      appName: 'Khazna',
      preferredAnchorCursor: { x: 340, y: 168 },
      avoidRects: tableHeaderAndRows,
    });

    assert.equal(res.hadCollision, false);
    const cardBox = {
      left: res.cardLeft,
      top: res.cardTop,
      right: res.cardLeft + res.cardWidth,
      bottom: res.cardTop + cardSize.height,
    };
    for (const row of tableHeaderAndRows) {
      assert.equal(rectsOverlap(cardBox, row, 4), false, 'Card must not cover table header/columns');
    }
  });
});

