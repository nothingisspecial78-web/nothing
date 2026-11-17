import { describe, expect, it } from 'vitest';
import { computeAvatarPose } from './avatarKinematics.ts';

describe('3D AI Avatar Kinematics', () => {
  it('animates continuously when idle (levitation, halo orbit, periodic blink)', () => {
    const poseA = computeAvatarPose({
      elapsed: 0.2,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });
    const poseB = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });

    expect(poseA.state).toBe('idle');
    expect(poseB.state).toBe('idle');
    expect(poseA.bodyY).not.toBe(poseB.bodyY);
    expect(poseA.haloRotY).not.toBe(poseB.haloRotY);

    const blinkPose = computeAvatarPose({
      elapsed: 3.3,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });
    expect(blinkPose.eyeScaleY).toBeLessThan(0.3);
  });

  it('tracks pointer gaze and boosts glow on hover', () => {
    const idle = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });
    const hoveredRight = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: true,
      thinking: false,
      pointerX: 0.8,
      pointerY: -0.5,
    });

    expect(hoveredRight.state).toBe('hover');
    expect(hoveredRight.headRotY).toBeGreaterThan(idle.headRotY);
    expect(hoveredRight.glowIntensity).toBeGreaterThan(idle.glowIntensity);
  });

  it('produces hop, spin, raised waving right arm, and eye sparkle on click', () => {
    const clicked = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: 0.28,
      celebrateAgeSec: null,
      hovered: true,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });

    expect(clicked.state).toBe('clicked');
    expect(clicked.bodyY).toBeGreaterThan(0.12);
    expect(clicked.rightArmRotZ).toBeGreaterThan(1.7);
    expect(clicked.bodyRotY).toBeGreaterThan(1.0);
    expect(clicked.glowIntensity).toBeGreaterThan(2.0);

    const settled = computeAvatarPose({
      elapsed: 2.5,
      clickAgeSec: 2.1,
      celebrateAgeSec: null,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });
    expect(settled.state).toBe('idle');
  });

  it('produces distinct thinking and celebrate poses', () => {
    const thinking = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: null,
      celebrateAgeSec: null,
      hovered: false,
      thinking: true,
      pointerX: 0,
      pointerY: 0,
    });
    expect(thinking.state).toBe('thinking');
    expect(thinking.glowIntensity).toBeGreaterThan(1.3);

    const celebrate = computeAvatarPose({
      elapsed: 1.0,
      clickAgeSec: null,
      celebrateAgeSec: 0.25,
      hovered: false,
      thinking: false,
      pointerX: 0,
      pointerY: 0,
    });
    expect(celebrate.state).toBe('celebrate');
    expect(celebrate.leftArmRotZ).toBeLessThan(-1.5);
    expect(celebrate.rightArmRotZ).toBeGreaterThan(1.5);
  });
});
