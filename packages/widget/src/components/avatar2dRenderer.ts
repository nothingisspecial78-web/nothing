export interface Avatar2DState {
  elapsed: number;
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
  sensitive: boolean;
  accentColor?: string;
  primaryColor?: string;
}

/**
 * Detects CPU/software WebGL rasterizers (SwiftShader, llvmpipe, softpipe, etc.)
 * where continuous Three.js PBR draws stall the Chromium compositor.
 */
export function detectSoftwareWebGl(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = String(
      (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '') || gl.getParameter(gl.RENDERER) || ''
    );
    const vendorStr = String(
      (ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '') || gl.getParameter(gl.VENDOR) || ''
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const combined = `${rendererStr} ${vendorStr}`;
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(combined);
  } catch {
    return true;
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Lightweight 60fps Canvas 2D renderer matching the Khazna 3D ceramic/slate/ember companion robot.
 * Used seamlessly when WebGL is software-rendered or unavailable so UI stays smooth.
 */
export function draw2DAvatar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pose: Avatar2DState
): void {
  const accent = pose.accentColor || '#f97316';
  const primary = pose.primaryColor || '#0f172a';
  ctx.clearRect(0, 0, width, height);

  const scale = Math.min(width / 116, height / 124);
  const cx = width * 0.5;
  const cy = height * 0.54;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // 1. Contact shadow & Holographic pedestal ring
  const pedScale = Math.max(0.75, Math.min(1.25, pose.pedestalScale || 1));
  ctx.save();
  ctx.translate(0, 41);
  ctx.scale(pedScale, pedScale);

  const shadowGrad = ctx.createRadialGradient(0, 3, 2, 0, 3, 34);
  shadowGrad.addColorStop(0, 'rgba(15, 23, 42, 0.32)');
  shadowGrad.addColorStop(0.55, 'rgba(249, 115, 22, 0.16)');
  shadowGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(0, 3, 34, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = primary;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, 7.2, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = 0.72 + Math.min(0.28, (pose.glowIntensity - 1) * 0.25);
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 19.5, 5.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Apply hovering body displacement
  const floatOffsetY = -pose.bodyY * 36;
  const gazeOffsetX = Math.max(-6, Math.min(6, pose.headRotY * 14));
  const gazeOffsetY = Math.max(-4, Math.min(4, pose.headRotX * 10));

  ctx.save();
  ctx.translate(0, floatOffsetY);
  ctx.scale(1, Math.max(0.88, Math.min(1.12, pose.bodyScaleY || 1)));

  // 2. Thruster skirt + ember glow
  const thrusterGrad = ctx.createRadialGradient(0, 25, 1, 0, 25, 13);
  thrusterGrad.addColorStop(0, '#ffedd5');
  thrusterGrad.addColorStop(0.5, accent);
  thrusterGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
  ctx.fillStyle = thrusterGrad;
  ctx.beginPath();
  ctx.ellipse(0, 26, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(-12, 16);
  ctx.lineTo(12, 16);
  ctx.lineTo(8, 24);
  ctx.lineTo(-8, 24);
  ctx.closePath();
  ctx.fill();

  // 3. Torso chassis
  const torsoGrad = ctx.createLinearGradient(-18, -4, 18, 20);
  torsoGrad.addColorStop(0, '#ffffff');
  torsoGrad.addColorStop(0.55, '#faf7f2');
  torsoGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = torsoGrad;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, -18, -3, 36, 22, 10);
  ctx.fill();
  ctx.stroke();

  // Chest plate & core crystal
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(gazeOffsetX * 0.25, 8, 8.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffedd5';
  ctx.save();
  ctx.translate(gazeOffsetX * 0.25, 8);
  ctx.rotate(pose.elapsed * 1.4);
  ctx.beginPath();
  ctx.moveTo(0, -4.4);
  ctx.lineTo(3.4, 0);
  ctx.lineTo(0, 4.4);
  ctx.lineTo(-3.4, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Neck collar
  ctx.fillStyle = '#1e293b';
  drawRoundedRect(ctx, -8, -8, 16, 6, 3);
  ctx.fill();

  // Helper to draw each articulated arm
  const drawArm = (side: -1 | 1, rotZ: number, rotX: number) => {
    ctx.save();
    ctx.translate(side * 22, 2);
    // Raise arms cleanly upward toward eyes when covering eyes / waving
    const liftAngle = side === -1 ? -rotZ + rotX * 0.45 : -rotZ - rotX * 0.45;
    ctx.rotate(liftAngle);

    // Shoulder joint
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 0, 4.8, 0, Math.PI * 2);
    ctx.fill();

    // Ceramic forearm
    ctx.fillStyle = '#faf7f2';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, -4, 2, 8, 15, 4);
    ctx.fill();
    ctx.stroke();

    // Glowing orange wrist cuff
    ctx.fillStyle = accent;
    drawRoundedRect(ctx, -4.3, 12.5, 8.6, 3.2, 1.5);
    ctx.fill();
    ctx.restore();
  };

  // Draw arms behind head normally, or after head when raised over face in sensitive mode
  const armsOverFace = pose.sensitive || pose.leftArmRotX < -0.7 || pose.rightArmRotX < -0.7;
  if (!armsOverFace) {
    drawArm(-1, pose.leftArmRotZ, pose.leftArmRotX);
    drawArm(1, pose.rightArmRotZ, pose.rightArmRotX);
  }

  // 4. Articulated Head Group
  ctx.save();
  ctx.translate(0, -24);
  ctx.rotate(pose.headRotZ * 0.6);

  // Side ear pods
  ctx.fillStyle = accent;
  drawRoundedRect(ctx, -26, -7, 6, 13, 3);
  ctx.fill();
  drawRoundedRect(ctx, 20, -7, 6, 13, 3);
  ctx.fill();

  // Antenna stem + orb
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(0, -24);
  ctx.stroke();

  const orbGlow = 0.75 + Math.sin(pose.elapsed * 3.5) * 0.25;
  ctx.fillStyle = accent;
  ctx.globalAlpha = orbGlow;
  ctx.beginPath();
  ctx.arc(0, -26.5, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Head ceramic shell
  const headGrad = ctx.createLinearGradient(-22, -18, 22, 18);
  headGrad.addColorStop(0, '#ffffff');
  headGrad.addColorStop(0.65, '#faf7f2');
  headGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = headGrad;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 17.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Dark glossy visor
  const visorGrad = ctx.createLinearGradient(0, -10, 0, 10);
  visorGrad.addColorStop(0, '#1e293b');
  visorGrad.addColorStop(0.45, '#0f172a');
  visorGrad.addColorStop(1, '#020617');
  ctx.fillStyle = visorGrad;
  drawRoundedRect(ctx, -16.5 + gazeOffsetX * 0.45, -9.5 + gazeOffsetY * 0.45, 33, 18.5, 9);
  ctx.fill();

  // Subtle visor specular reflection
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.ellipse(-6 + gazeOffsetX * 0.45, -5.5 + gazeOffsetY * 0.45, 8, 2.2, -0.18, 0, Math.PI * 2);
  ctx.fill();

  // Glowing expressive eyes
  const eyeScaleY = pose.sensitive ? 0.1 : Math.max(0.08, Math.min(1.25, pose.eyeScaleY));
  const eyeH = 6.2 * eyeScaleY;
  const eyeY = -0.5 + gazeOffsetY * 0.65;

  // Soft outer glow without CPU shadowBlur
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(-6.5 + gazeOffsetX * 0.75, eyeY, 4.1, Math.max(1.4, eyeH * 0.75), 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6.5 + gazeOffsetX * 0.75, eyeY, 4.1, Math.max(1.4, eyeH * 0.75), -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#ffedd5';
  // Left eye
  ctx.beginPath();
  ctx.ellipse(-6.5 + gazeOffsetX * 0.75, eyeY, 2.7, Math.max(0.8, eyeH * 0.55), 0.06, 0, Math.PI * 2);
  ctx.fill();
  // Right eye
  ctx.beginPath();
  ctx.ellipse(6.5 + gazeOffsetX * 0.75, eyeY, 2.7, Math.max(0.8, eyeH * 0.55), -0.06, 0, Math.PI * 2);
  ctx.fill();

  // 5. Orbiting Neural Halo Ring
  ctx.save();
  ctx.translate(0, -29 + (pose.haloY - 1.02) * 20);
  ctx.rotate(pose.haloRotZ);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.9;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 4.2, 0, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 3; i += 1) {
    const a = pose.haloRotY + (i * Math.PI * 2) / 3;
    const nx = Math.cos(a) * 17;
    const ny = Math.sin(a) * 4.2;
    ctx.fillStyle = i === 0 ? '#ffedd5' : accent;
    ctx.beginPath();
    ctx.arc(nx, ny, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore(); // end headGroup

  if (armsOverFace) {
    drawArm(-1, pose.leftArmRotZ, pose.leftArmRotX);
    drawArm(1, pose.rightArmRotZ, pose.rightArmRotX);
  }

  ctx.restore(); // end floating bodyGroup
  ctx.restore(); // end stage transform
}
