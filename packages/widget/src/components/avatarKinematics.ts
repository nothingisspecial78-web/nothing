export type AvatarVisualState = 'idle' | 'hover' | 'clicked' | 'thinking' | 'celebrate' | 'sensitive';

export interface AvatarPoseInput {
  elapsed: number;
  clickAgeSec: number | null;
  celebrateAgeSec: number | null;
  hovered: boolean;
  thinking: boolean;
  pointerX: number;
  pointerY: number;
  sensitive?: boolean;
  prefersReducedMotion?: boolean;
}

export interface AvatarPose {
  state: AvatarVisualState;
  bodyY: number;
  bodyRotY: number;
  bodyRotX: number;
  bodyScaleY: number;
  headRotX: number;
  headRotY: number;
  headRotZ: number;
  leftArmRotZ: number;
  leftArmRotX: number;
  rightArmRotZ: number;
  rightArmRotX: number;
  haloRotY: number;
  haloRotZ: number;
  haloY: number;
  pedestalScale: number;
  eyeScaleY: number;
  glowIntensity: number;
}

const CLICK_DURATION_SEC = 1.9;
const CELEBRATE_DURATION_SEC = 1.5;

export function computeAvatarPose(input: AvatarPoseInput): AvatarPose {
  const {
    elapsed,
    clickAgeSec,
    celebrateAgeSec,
    hovered,
    thinking,
    pointerX,
    pointerY,
    sensitive = false,
    prefersReducedMotion = false,
  } = input;

  const isClicked = !sensitive && clickAgeSec !== null && clickAgeSec >= 0 && clickAgeSec < CLICK_DURATION_SEC;
  const isCelebrating =
    !sensitive &&
    !isClicked &&
    celebrateAgeSec !== null &&
    celebrateAgeSec >= 0 &&
    celebrateAgeSec < CELEBRATE_DURATION_SEC;

  const state: AvatarVisualState = sensitive
    ? 'sensitive'
    : isClicked
      ? 'clicked'
      : isCelebrating
        ? 'celebrate'
        : thinking
          ? 'thinking'
          : hovered
            ? 'hover'
            : 'idle';

  // Privacy Gesture: Closes eyes completely, turns head away, raises arms to cover eyes
  if (sensitive) {
    return {
      state: 'sensitive',
      bodyY: 0,
      bodyRotY: -0.22,
      bodyRotX: 0,
      bodyScaleY: 1,
      headRotX: -0.18,
      headRotY: -0.42,
      headRotZ: -0.06,
      leftArmRotZ: 0.72,
      leftArmRotX: -1.2,
      rightArmRotZ: -0.72,
      rightArmRotX: -1.2,
      haloRotY: prefersReducedMotion ? 0 : elapsed * 0.6,
      haloRotZ: 0.08,
      haloY: 1.02,
      pedestalScale: 1,
      eyeScaleY: 0,
      glowIntensity: 0.75,
    };
  }

  // Natural periodic eye blink every ~3.4 seconds
  const blinkPhase = elapsed % 3.4;
  const isBlinking = blinkPhase > 3.24 && blinkPhase < 3.38;
  let eyeScaleY = isBlinking ? 0.14 : 1.0;

  if (prefersReducedMotion) {
    return {
      state,
      bodyY: 0,
      bodyRotY: 0,
      bodyRotX: 0,
      bodyScaleY: 1,
      headRotX: 0,
      headRotY: hovered ? pointerX * 0.2 : 0,
      headRotZ: 0,
      leftArmRotZ: -0.18,
      leftArmRotX: 0,
      rightArmRotZ: 0.18,
      rightArmRotX: 0,
      haloRotY: 0,
      haloRotZ: 0.18,
      haloY: 1.02,
      pedestalScale: 1,
      eyeScaleY,
      glowIntensity: thinking ? 1.55 : 1.15,
    };
  }

  // Base continuous idle animations (when not clicked)
  let bodyY = Math.sin(elapsed * 2.1) * 0.065;
  let bodyRotY = Math.sin(elapsed * 0.95) * 0.16;
  let bodyRotX = Math.sin(elapsed * 1.4) * 0.03;
  let bodyScaleY = 1 + Math.sin(elapsed * 2.3) * 0.018;

  let headRotX = Math.sin(elapsed * 1.3) * 0.05;
  let headRotY = Math.sin(elapsed * 0.8) * 0.14;
  let headRotZ = Math.sin(elapsed * 1.05) * 0.04;

  let leftArmRotZ = -0.18 + Math.sin(elapsed * 2.1) * 0.08;
  let leftArmRotX = Math.sin(elapsed * 1.6) * 0.08;
  let rightArmRotZ = 0.18 - Math.sin(elapsed * 2.1) * 0.08;
  let rightArmRotX = -Math.sin(elapsed * 1.6) * 0.08;

  let haloRotY = elapsed * 1.35;
  let haloRotZ = 0.18 + Math.sin(elapsed * 1.7) * 0.06;
  let haloY = 1.02 + Math.sin(elapsed * 2.6) * 0.03;

  let pedestalScale = 1 + Math.sin(elapsed * 2.1) * 0.04;
  let glowIntensity = 1.15 + Math.sin(elapsed * 2.8) * 0.18;

  // Hover gaze tracking & alert posture
  if (hovered) {
    headRotY += pointerX * 0.38;
    headRotX += -pointerY * 0.22 - 0.04;
    bodyRotY += pointerX * 0.16;
    bodyY += 0.035;
    haloRotY = elapsed * 2.4;
    glowIntensity = 1.55;
  }

  // Thinking / streaming state
  if (thinking && !isClicked && !isCelebrating) {
    headRotZ = 0.12 + Math.sin(elapsed * 3.2) * 0.06;
    headRotX = -0.06 + Math.sin(elapsed * 4.5) * 0.05;
    bodyY += Math.sin(elapsed * 4.2) * 0.025;
    leftArmRotX = -0.35 + Math.sin(elapsed * 5) * 0.15;
    rightArmRotX = -0.35 - Math.sin(elapsed * 5) * 0.15;
    haloRotY = elapsed * 4.2;
    haloRotZ = 0.26;
    glowIntensity = 1.7 + Math.sin(elapsed * 7.5) * 0.35;
  }

  // Click animation: energetic hop, 360° celebratory twist, right-arm wave, eye sparkle
  if (isClicked && clickAgeSec !== null) {
    const t = clickAgeSec / CLICK_DURATION_SEC;
    const envelope = Math.sin(Math.min(t, 1) * Math.PI);
    const decay = Math.exp(-t * 2.1);

    bodyY = 0.24 * Math.abs(Math.sin(t * Math.PI * 1.6)) * decay + 0.04;
    bodyRotY = (1 - Math.pow(1 - Math.min(t * 1.35, 1), 3)) * Math.PI * 2;
    bodyScaleY = 1 + Math.sin(t * Math.PI * 3) * 0.07 * decay;
    headRotZ = Math.sin(clickAgeSec * 10) * 0.12 * decay;
    headRotX = -0.14 * envelope;

    // Enthusiastic right-arm wave + left arm balance
    rightArmRotZ = 2.25 + Math.sin(clickAgeSec * 20) * 0.48 * (1 - t * 0.35);
    rightArmRotX = -0.35;
    leftArmRotZ = -0.45 - 0.2 * envelope;
    leftArmRotX = 0.15;

    haloRotY = elapsed * 1.35 + t * Math.PI * 4;
    haloY = 1.08 + 0.09 * envelope;
    pedestalScale = 1.12 + 0.08 * envelope;
    eyeScaleY = 1.18;
    glowIntensity = 2.35;
  } else if (isCelebrating && celebrateAgeSec !== null) {
    const t = celebrateAgeSec / CELEBRATE_DURATION_SEC;
    const decay = Math.exp(-t * 2.0);
    bodyY = 0.18 * Math.abs(Math.sin(t * Math.PI * 2)) * decay;
    leftArmRotZ = -2.1 + Math.sin(celebrateAgeSec * 14) * 0.25 * decay;
    rightArmRotZ = 2.1 - Math.sin(celebrateAgeSec * 14) * 0.25 * decay;
    haloRotY = elapsed * 5.0;
    glowIntensity = 2.2;
    eyeScaleY = 1.15;
  }

  return {
    state,
    bodyY,
    bodyRotY,
    bodyRotX,
    bodyScaleY,
    headRotX,
    headRotY,
    headRotZ,
    leftArmRotZ,
    leftArmRotX,
    rightArmRotZ,
    rightArmRotX,
    haloRotY,
    haloRotZ,
    haloY,
    pedestalScale,
    eyeScaleY,
    glowIntensity,
  };
}
