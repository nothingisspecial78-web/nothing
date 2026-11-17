import type * as THREEType from 'three';
import { detectSoftwareWebGl, draw2DAvatar } from '../components/avatar2dRenderer.ts';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface GuideAvatarTargetPoint {
  x: number; // screen px
  y: number; // screen px
  width: number;
  height: number;
}

export class GuideAvatarController {
  private canvas: HTMLCanvasElement;
  private THREE: typeof THREEType | null = null;
  private renderer: THREEType.WebGLRenderer | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private scene: THREEType.Scene | null = null;
  private camera: THREEType.PerspectiveCamera | null = null;
  private avatarRoot: THREEType.Group | null = null;
  private bodyGroup: THREEType.Group | null = null;
  private headGroup: THREEType.Group | null = null;
  private leftArmPivot: THREEType.Group | null = null;
  private rightArmPivot: THREEType.Group | null = null;
  private leftEye: THREEType.Mesh | null = null;
  private rightEye: THREEType.Mesh | null = null;
  private haloGroup: THREEType.Group | null = null;
  private coreCrystal: THREEType.Mesh | null = null;
  private matCyanGlow: THREEType.MeshStandardMaterial | null = null;

  private currentScreenPos = { x: 100, y: 100 };
  private targetScreenPos = { x: 100, y: 100 };
  private pointingTarget: { x: number; y: number } | null = null;
  private isSensitive = false;
  private isSpeaking = false;
  private isCelebrating = false;
  private celebrateStartMs = 0;
  private animationFrameId = 0;
  private disposed = false;
  private prefersReducedMotion = false;
  private isSoftwareGl = false;
  private use2DMode = false;
  private slowFrameCount = 0;

  private readonly boxW = 148;
  private readonly boxH = 160;
  private dpr = 1;
  private pose2D = {
    headRotX: 0,
    headRotY: 0,
    leftArmRotZ: -0.18,
    leftArmRotX: 0,
    rightArmRotZ: 0.18,
    rightArmRotX: 0,
    eyeScaleY: 1,
    haloRotY: 0,
    glowIntensity: 1.15,
  };

  private geometries: THREEType.BufferGeometry[] = [];
  private materials: THREEType.Material[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isSoftwareGl = detectSoftwareWebGl();
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    if (typeof window !== 'undefined') {
      this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.targetScreenPos = {
        x: window.innerWidth - 120,
        y: window.innerHeight - 150,
      };
      this.currentScreenPos = { ...this.targetScreenPos };
    }

    // Start in 2D immediately so guide startup has zero main-thread stutter; lazily upgrade to 3D if GPU present
    this.init2DMode();
    if (!this.isSoftwareGl) {
      void this.tryUpgradeToWebGL();
    }

    this.startLoop();
  }

  private onWebGlContextLost = (ev: Event) => {
    ev.preventDefault();
    this.teardownWebGL();
    this.swapToFresh2DCanvas();
    this.renderFrame(performance.now());
  };

  private replaceCanvasNode(nextCanvas: HTMLCanvasElement): void {
    const prev = this.canvas;
    if (prev.parentNode) {
      prev.parentNode.replaceChild(nextCanvas, prev);
    }
    this.canvas = nextCanvas;
  }

  private swapToFresh2DCanvas(): void {
    const freshCanvas = document.createElement('canvas');
    freshCanvas.className = this.canvas.className;
    freshCanvas.setAttribute('aria-hidden', 'true');
    this.replaceCanvasNode(freshCanvas);
    this.init2DMode();
  }

  private async tryUpgradeToWebGL(): Promise<void> {
    try {
      const [threeMod, { buildAssistantAvatarModel }] = await Promise.all([
        import('three'),
        import('../components/avatarModel.ts'),
      ]);
      if (this.disposed) return;

      const width = window.innerWidth || 800;
      const height = window.innerHeight || 600;
      const scene = new threeMod.Scene();
      const camera = new threeMod.PerspectiveCamera(40, width / height, 0.1, 100);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);

      // HTML5 Canvas spec forbids calling WebGL getContext on a canvas that already acquired '2d'
      const glCanvas = document.createElement('canvas');
      glCanvas.className = this.canvas.className;
      glCanvas.setAttribute('aria-hidden', 'true');
      glCanvas.setAttribute('data-renderer', 'webgl');
      glCanvas.style.position = 'fixed';
      glCanvas.style.inset = '0';
      glCanvas.style.width = '100%';
      glCanvas.style.height = '100%';
      glCanvas.style.pointerEvents = 'none';

      const renderer = new threeMod.WebGLRenderer({
        canvas: glCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = threeMod.SRGBColorSpace;
      renderer.toneMapping = threeMod.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);

      scene.add(new threeMod.HemisphereLight(0xfff7ed, 0x1e293b, 1.2));
      const keyLight = new threeMod.DirectionalLight(0xfffbeb, 2.2);
      keyLight.position.set(3, 4, 4);
      scene.add(keyLight);

      const rimLight = new threeMod.PointLight(0xfb923c, 1.8, 15);
      rimLight.position.set(-3, 2, -2);
      scene.add(rimLight);

      const built = buildAssistantAvatarModel({
        accentColor: '#f97316',
        primaryColor: '#0f172a',
        includeContactShadow: false,
        detail: 'full',
      });
      built.avatarRoot.scale.setScalar(0.72);
      scene.add(built.avatarRoot);

      // Verify first WebGL render succeeds before replacing the visible 2D canvas
      renderer.render(scene, camera);
      if (this.disposed) {
        built.geometries.forEach((g) => g.dispose());
        built.materials.forEach((m) => m.dispose());
        renderer.dispose();
        return;
      }

      this.THREE = threeMod;
      this.scene = scene;
      this.camera = camera;
      this.renderer = renderer;
      this.avatarRoot = built.avatarRoot;
      this.bodyGroup = built.bodyGroup;
      this.headGroup = built.headGroup;
      this.leftArmPivot = built.leftArmPivot;
      this.rightArmPivot = built.rightArmPivot;
      this.leftEye = built.leftEye;
      this.rightEye = built.rightEye;
      this.haloGroup = built.haloGroup;
      this.coreCrystal = built.coreCrystal;
      this.matCyanGlow = built.matCyanGlow;
      this.geometries = built.geometries;
      this.materials = built.materials;

      glCanvas.addEventListener('webglcontextlost', this.onWebGlContextLost, false);
      this.replaceCanvasNode(glCanvas);
      this.ctx2d = null;
      this.use2DMode = false;
    } catch {
      // Remain cleanly on fast 2D canvas mode
    }
  }

  private init2DMode(): void {
    this.use2DMode = true;
    this.canvas.setAttribute('data-renderer', '2d');
    this.canvas.width = Math.round(this.boxW * this.dpr);
    this.canvas.height = Math.round(this.boxH * this.dpr);
    this.canvas.style.position = 'fixed';
    this.canvas.style.inset = 'auto';
    this.canvas.style.top = '0px';
    this.canvas.style.left = '0px';
    this.canvas.style.width = `${this.boxW}px`;
    this.canvas.style.height = `${this.boxH}px`;
    this.canvas.style.willChange = 'transform';
    this.canvas.style.pointerEvents = 'none';
    this.ctx2d = this.canvas.getContext('2d');
  }

  private teardownWebGL(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onWebGlContextLost);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
  }

  private screenToWorld(screenX: number, screenY: number): THREEType.Vector3 | null {
    if (!this.THREE || !this.camera) return null;
    const width = window.innerWidth || 800;
    const height = window.innerHeight || 600;
    const ndcX = (screenX / width) * 2 - 1;
    const ndcY = -(screenY / height) * 2 + 1;
    const v = new this.THREE.Vector3(ndcX, ndcY, 0.5);
    v.unproject(this.camera);
    v.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / v.z;
    return this.camera.position.clone().add(v.multiplyScalar(distance));
  }

  moveToTarget(target: GuideAvatarTargetPoint | null): void {
    if (!target) {
      this.targetScreenPos = {
        x: window.innerWidth - 130,
        y: window.innerHeight - 170,
      };
      this.pointingTarget = null;
      return;
    }

    const { x, y, width, height } = target;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const isMobile = screenW < 768;

    this.pointingTarget = { x: x + width / 2, y: y + height / 2 };

    if (isMobile) {
      this.targetScreenPos = {
        x: screenW - 85,
        y: screenH - 135,
      };
      return;
    }

    const spaceRight = screenW - (x + width);
    const spaceLeft = x;

    let landingX = 0;
    let landingY = y + height / 2;

    if (spaceRight >= 180) {
      landingX = x + width + 90;
    } else if (spaceLeft >= 180) {
      landingX = x - 90;
    } else {
      landingX = Math.max(90, Math.min(x + width / 2, screenW - 90));
      landingY = y >= 200 ? y - 110 : y + height + 110;
    }

    landingX = Math.max(70, Math.min(landingX, screenW - 80));
    landingY = Math.max(80, Math.min(landingY, screenH - 120));

    this.targetScreenPos = { x: landingX, y: landingY };

    if (this.prefersReducedMotion) {
      this.currentScreenPos = { ...this.targetScreenPos };
      this.renderFrame(performance.now());
    }
  }

  setSensitive(sensitive: boolean): void {
    this.isSensitive = sensitive;
    if (this.prefersReducedMotion) this.renderFrame(performance.now());
  }

  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    if (this.prefersReducedMotion) this.renderFrame(performance.now());
  }

  celebrate(): void {
    this.isCelebrating = true;
    this.celebrateStartMs = performance.now();
    if (this.prefersReducedMotion) this.renderFrame(performance.now());
  }

  handleResize(): void {
    if (this.disposed) return;
    if (this.use2DMode) return;
    if (!this.renderer || !this.camera) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private startLoop(): void {
    const loop = (now: number) => {
      if (this.disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.animationFrameId = window.setTimeout(() => loop(performance.now()), 250);
        return;
      }
      this.renderFrame(now);
      if (this.prefersReducedMotion) return;
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private render2DFrame(now: number): void {
    if (!this.ctx2d) return;
    const t = now * 0.001;
    const dt = 0.016;

    const lerpSpeed = this.prefersReducedMotion ? 1.0 : 0.14;
    this.currentScreenPos.x += (this.targetScreenPos.x - this.currentScreenPos.x) * lerpSpeed;
    this.currentScreenPos.y += (this.targetScreenPos.y - this.currentScreenPos.y) * lerpSpeed;

    const tx = Math.round(this.currentScreenPos.x - this.boxW / 2);
    const ty = Math.round(this.currentScreenPos.y - this.boxH / 2);
    this.canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;

    const bob = this.prefersReducedMotion ? 0 : Math.sin(t * 2.2) * 0.06;

    if (this.pointingTarget && !this.isSensitive) {
      const dx = this.pointingTarget.x - this.currentScreenPos.x;
      const dy = this.pointingTarget.y - this.currentScreenPos.y;
      const angleY = Math.max(-0.6, Math.min(dx / 240, 0.6));
      const angleX = Math.max(-0.4, Math.min(dy / 240, 0.4));
      this.pose2D.headRotY = lerp(this.pose2D.headRotY, angleY, 0.14);
      this.pose2D.headRotX = lerp(this.pose2D.headRotX, angleX, 0.14);
      if (dx >= 0) {
        this.pose2D.rightArmRotZ = lerp(this.pose2D.rightArmRotZ, -0.95, 0.15);
        this.pose2D.rightArmRotX = lerp(this.pose2D.rightArmRotX, -0.65, 0.15);
        this.pose2D.leftArmRotZ = lerp(this.pose2D.leftArmRotZ, -0.18, 0.15);
        this.pose2D.leftArmRotX = lerp(this.pose2D.leftArmRotX, 0, 0.15);
      } else {
        this.pose2D.leftArmRotZ = lerp(this.pose2D.leftArmRotZ, 0.95, 0.15);
        this.pose2D.leftArmRotX = lerp(this.pose2D.leftArmRotX, -0.65, 0.15);
        this.pose2D.rightArmRotZ = lerp(this.pose2D.rightArmRotZ, 0.18, 0.15);
        this.pose2D.rightArmRotX = lerp(this.pose2D.rightArmRotX, 0, 0.15);
      }
    } else if (!this.isSensitive) {
      this.pose2D.headRotY = lerp(this.pose2D.headRotY, Math.sin(t * 0.9) * 0.14, 0.1);
      this.pose2D.headRotX = lerp(this.pose2D.headRotX, Math.sin(t * 1.3) * 0.05, 0.1);
      this.pose2D.leftArmRotZ = lerp(this.pose2D.leftArmRotZ, -0.18, 0.1);
      this.pose2D.leftArmRotX = lerp(this.pose2D.leftArmRotX, 0, 0.1);
      this.pose2D.rightArmRotZ = lerp(this.pose2D.rightArmRotZ, 0.18, 0.1);
      this.pose2D.rightArmRotX = lerp(this.pose2D.rightArmRotX, 0, 0.1);
    }

    if (this.isSensitive) {
      this.pose2D.eyeScaleY = 0.06;
      this.pose2D.headRotY = lerp(this.pose2D.headRotY, -0.42, 0.2);
      this.pose2D.headRotX = lerp(this.pose2D.headRotX, -0.18, 0.2);
      this.pose2D.leftArmRotZ = lerp(this.pose2D.leftArmRotZ, 0.72, 0.2);
      this.pose2D.leftArmRotX = lerp(this.pose2D.leftArmRotX, -1.2, 0.2);
      this.pose2D.rightArmRotZ = lerp(this.pose2D.rightArmRotZ, -0.72, 0.2);
      this.pose2D.rightArmRotX = lerp(this.pose2D.rightArmRotX, -1.2, 0.2);
    } else {
      const blinkPhase = t % 3.4;
      const isBlink = blinkPhase > 3.25 && blinkPhase < 3.38;
      this.pose2D.eyeScaleY = lerp(this.pose2D.eyeScaleY, isBlink ? 0.12 : 1.0, 0.3);
    }

    this.pose2D.glowIntensity = this.isSpeaking ? Math.sin(t * 14) * 0.35 + 1.25 : 1.15;

    let celebrateLift = 0;
    if (this.isCelebrating) {
      const ageSec = (now - this.celebrateStartMs) / 1000;
      if (ageSec < 1.5) {
        this.pose2D.haloRotY += dt * 8;
        celebrateLift = Math.sin(ageSec * Math.PI) * 0.22;
      } else {
        this.isCelebrating = false;
      }
    } else {
      this.pose2D.haloRotY += dt * 1.5;
    }

    this.ctx2d.save();
    this.ctx2d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    draw2DAvatar(this.ctx2d, this.boxW, this.boxH, {
      elapsed: t,
      bodyY: bob + celebrateLift,
      bodyRotY: 0,
      bodyRotX: 0,
      bodyScaleY: 1,
      headRotX: this.pose2D.headRotX,
      headRotY: this.pose2D.headRotY,
      headRotZ: 0,
      leftArmRotZ: this.pose2D.leftArmRotZ,
      leftArmRotX: this.pose2D.leftArmRotX,
      rightArmRotZ: this.pose2D.rightArmRotZ,
      rightArmRotX: this.pose2D.rightArmRotX,
      haloRotY: this.pose2D.haloRotY,
      haloRotZ: 0,
      haloY: 1.02,
      pedestalScale: 1,
      eyeScaleY: this.pose2D.eyeScaleY,
      glowIntensity: this.pose2D.glowIntensity,
      sensitive: this.isSensitive,
      accentColor: '#f97316',
      primaryColor: '#0f172a',
    });
    this.ctx2d.restore();
  }

  private renderFrame(now: number): void {
    if (this.disposed) return;
    if (this.use2DMode) {
      this.render2DFrame(now);
      return;
    }

    if (
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.avatarRoot ||
      !this.bodyGroup ||
      !this.headGroup ||
      !this.leftArmPivot ||
      !this.rightArmPivot ||
      !this.leftEye ||
      !this.rightEye ||
      !this.haloGroup ||
      !this.matCyanGlow
    ) {
      return;
    }

    const dt = 0.016;
    const t = now * 0.001;

    const lerpSpeed = this.prefersReducedMotion ? 1.0 : 0.08;
    this.currentScreenPos.x += (this.targetScreenPos.x - this.currentScreenPos.x) * lerpSpeed;
    this.currentScreenPos.y += (this.targetScreenPos.y - this.currentScreenPos.y) * lerpSpeed;

    const worldPos = this.screenToWorld(this.currentScreenPos.x, this.currentScreenPos.y);
    if (!worldPos) return;
    this.avatarRoot.position.copy(worldPos);

    const bob = this.prefersReducedMotion ? 0 : Math.sin(t * 2.2) * 0.06;
    this.bodyGroup.position.y = -0.05 + bob;

    if (this.pointingTarget && !this.isSensitive) {
      const targetWorld = this.screenToWorld(this.pointingTarget.x, this.pointingTarget.y);
      if (targetWorld) {
        const dx = targetWorld.x - worldPos.x;
        const dy = targetWorld.y - worldPos.y;
        const angleY = Math.max(-0.6, Math.min(Math.atan2(dx, 4), 0.6));
        const angleX = Math.max(-0.4, Math.min(-Math.atan2(dy, 4), 0.4));

        this.headGroup.rotation.y = lerp(this.headGroup.rotation.y, angleY, 0.1);
        this.headGroup.rotation.x = lerp(this.headGroup.rotation.x, angleX, 0.1);

        if (dx >= 0) {
          this.rightArmPivot.rotation.z = lerp(this.rightArmPivot.rotation.z, -0.95, 0.12);
          this.rightArmPivot.rotation.x = lerp(this.rightArmPivot.rotation.x, -0.65, 0.12);
          this.leftArmPivot.rotation.z = lerp(this.leftArmPivot.rotation.z, -0.18, 0.12);
        } else {
          this.leftArmPivot.rotation.z = lerp(this.leftArmPivot.rotation.z, 0.95, 0.12);
          this.leftArmPivot.rotation.x = lerp(this.leftArmPivot.rotation.x, -0.65, 0.12);
          this.rightArmPivot.rotation.z = lerp(this.rightArmPivot.rotation.z, 0.18, 0.12);
        }
      }
    } else if (!this.isSensitive) {
      this.headGroup.rotation.y = lerp(this.headGroup.rotation.y, Math.sin(t * 0.9) * 0.14, 0.08);
      this.headGroup.rotation.x = lerp(this.headGroup.rotation.x, Math.sin(t * 1.3) * 0.05, 0.08);
      this.leftArmPivot.rotation.z = lerp(this.leftArmPivot.rotation.z, -0.18, 0.08);
      this.leftArmPivot.rotation.x = lerp(this.leftArmPivot.rotation.x, 0, 0.08);
      this.rightArmPivot.rotation.z = lerp(this.rightArmPivot.rotation.z, 0.18, 0.08);
      this.rightArmPivot.rotation.x = lerp(this.rightArmPivot.rotation.x, 0, 0.08);
    }

    if (this.isSensitive) {
      this.leftEye.scale.y = 0.04;
      this.rightEye.scale.y = 0.04;
      this.headGroup.rotation.y = lerp(this.headGroup.rotation.y, -0.42, 0.2);
      this.headGroup.rotation.x = lerp(this.headGroup.rotation.x, -0.18, 0.2);
      this.leftArmPivot.rotation.z = lerp(this.leftArmPivot.rotation.z, 0.72, 0.2);
      this.leftArmPivot.rotation.x = lerp(this.leftArmPivot.rotation.x, -1.2, 0.2);
      this.rightArmPivot.rotation.z = lerp(this.rightArmPivot.rotation.z, -0.72, 0.2);
      this.rightArmPivot.rotation.x = lerp(this.rightArmPivot.rotation.x, -1.2, 0.2);
    } else {
      const blinkPhase = t % 3.4;
      const isBlink = blinkPhase > 3.25 && blinkPhase < 3.38;
      const targetEyeScale = isBlink ? 0.12 : 1.0;
      this.leftEye.scale.y = lerp(this.leftEye.scale.y, targetEyeScale, 0.3);
      this.rightEye.scale.y = lerp(this.rightEye.scale.y, targetEyeScale, 0.3);
    }

    if (this.isSpeaking) {
      this.matCyanGlow.emissiveIntensity = Math.sin(t * 14) * 0.35 + 1.25;
      this.headGroup.position.y = 0.56 + Math.sin(t * 12) * 0.015;
    } else {
      this.matCyanGlow.emissiveIntensity = 1.15;
      this.headGroup.position.y = 0.56;
    }

    if (this.isCelebrating) {
      const ageSec = (now - this.celebrateStartMs) / 1000;
      if (ageSec < 1.5) {
        this.haloGroup.rotation.y += dt * 8;
        this.bodyGroup.position.y += Math.sin(ageSec * Math.PI) * 0.35;
      } else {
        this.isCelebrating = false;
      }
    } else {
      this.haloGroup.rotation.y += dt * 1.5;
    }

    const rStart = performance.now();
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.teardownWebGL();
      this.swapToFresh2DCanvas();
      return;
    }
    const rCost = performance.now() - rStart;
    if (rCost > 35) {
      this.slowFrameCount += 1;
      if (this.slowFrameCount >= 2) {
        this.teardownWebGL();
        this.swapToFresh2DCanvas();
      }
    } else {
      this.slowFrameCount = 0;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      clearTimeout(this.animationFrameId);
    }
    this.teardownWebGL();
  }

  destroy(): void {
    this.dispose();
  }
}
