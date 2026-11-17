import React, { useEffect, useRef, useState } from 'react';
import { computeAvatarPose, type AvatarVisualState } from './avatarKinematics.ts';
import { detectSoftwareWebGl, draw2DAvatar } from './avatar2dRenderer.ts';

function damp(x: number, y: number, lambda: number, dt: number): number {
  return x + (y - x) * (1 - Math.exp(-lambda * dt));
}

export interface AssistantAvatar3DProps {
  title: string;
  open: boolean;
  thinking?: boolean;
  sensitive?: boolean;
  celebrateTick?: number;
  accentColor?: string;
  primaryColor?: string;
  onClick: () => void;
}

function AssistantAvatar3DComponent({
  title,
  open,
  thinking = false,
  sensitive = false,
  celebrateTick = 0,
  accentColor = '#f97316',
  primaryColor = '#0f172a',
  onClick,
}: AssistantAvatar3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [visualState, setVisualState] = useState<AvatarVisualState>('idle');
  const [clickCount, setClickCount] = useState(0);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const hoveredRef = useRef(false);
  const thinkingRef = useRef(thinking);
  const sensitiveRef = useRef(sensitive);
  const clickStartMsRef = useRef<number | null>(null);
  const celebrateStartMsRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const visualStateRef = useRef<AvatarVisualState>('idle');
  const triggerRepaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    thinkingRef.current = thinking;
    triggerRepaintRef.current?.();
  }, [thinking]);

  useEffect(() => {
    sensitiveRef.current = sensitive || passwordFocused;
    triggerRepaintRef.current?.();
  }, [sensitive, passwordFocused]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isSensitiveEl = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el instanceof HTMLInputElement && el.type === 'password') return true;
      return (
        el.getAttribute('data-guide-sensitive') === 'true' ||
        Boolean(el.closest('[data-guide-sensitive="true"]'))
      );
    };
    const onFocusIn = (e: FocusEvent) => {
      setPasswordFocused(isSensitiveEl(e.target));
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        setPasswordFocused(isSensitiveEl(document.activeElement));
      }, 20);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (celebrateTick > 0) {
      celebrateStartMsRef.current = performance.now();
      triggerRepaintRef.current?.();
    }
  }, [celebrateTick]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let disposed = false;
    let visibleOnScreen = true;
    let frameId = 0;

    // Cache prefers-reduced-motion instead of querying matchMedia on every animation frame
    const motionQuery =
      typeof window !== 'undefined'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionQuery?.matches ?? false;

    const isPaused = () =>
      disposed ||
      !visibleOnScreen ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden');

    const readPose = (now: number, startMs: number) => {
      const elapsed = (now - startMs) / 1000;
      const clickAgeSec =
        clickStartMsRef.current !== null ? (now - clickStartMsRef.current) / 1000 : null;
      const celebrateAgeSec =
        celebrateStartMsRef.current !== null ? (now - celebrateStartMsRef.current) / 1000 : null;

      const targetPose = computeAvatarPose({
        elapsed,
        clickAgeSec,
        celebrateAgeSec,
        hovered: hoveredRef.current,
        thinking: thinkingRef.current,
        pointerX: pointerRef.current.x,
        pointerY: pointerRef.current.y,
        sensitive: sensitiveRef.current,
        prefersReducedMotion: reducedMotion,
      });

      if (visualStateRef.current !== targetPose.state) {
        visualStateRef.current = targetPose.state;
        setVisualState(targetPose.state);
      }
      return { elapsed, targetPose };
    };

    const mount2DAvatar = () => {
      container.innerHTML = '';
      const canvas = document.createElement('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let width = Math.max(container.clientWidth || 112, 66);
      let height = Math.max(container.clientHeight || 118, 70);

      const syncCanvasSize = () => {
        width = Math.max(container.clientWidth || 112, 66);
        height = Math.max(container.clientHeight || 118, 70);
        const nextW = Math.round(width * dpr);
        const nextH = Math.round(height * dpr);
        if (canvas.width !== nextW) canvas.width = nextW;
        if (canvas.height !== nextH) canvas.height = nextH;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'none';
      };

      syncCanvasSize();
      canvas.setAttribute('data-renderer', '2d');
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) return () => {};

      const startMs = performance.now();
      let lastFrameMs = startMs;
      let lastDrawMs = 0;
      const smoothed = {
        bodyY: 0,
        bodyScaleY: 1,
        headRotX: 0,
        headRotY: 0,
        headRotZ: 0,
        leftArmRotZ: -0.18,
        leftArmRotX: 0,
        rightArmRotZ: 0.18,
        rightArmRotX: 0,
        haloRotZ: 0,
        haloY: 1.02,
        pedestalScale: 1,
        eyeScaleY: 1,
        glowIntensity: 1.2,
      };

      const paint2DNow = (now: number) => {
        if (disposed || width <= 0 || height <= 0) return;
        const dt = Math.min(Math.max((now - lastFrameMs) / 1000, 0.001), 0.1);
        lastFrameMs = now;
        lastDrawMs = now;
        const { elapsed, targetPose } = readPose(now, startMs);

        smoothed.bodyY = damp(smoothed.bodyY, targetPose.bodyY, 12, dt);
        smoothed.bodyScaleY = damp(smoothed.bodyScaleY, targetPose.bodyScaleY, 12, dt);
        smoothed.headRotX = damp(smoothed.headRotX, targetPose.headRotX, 12, dt);
        smoothed.headRotY = damp(smoothed.headRotY, targetPose.headRotY, 12, dt);
        smoothed.headRotZ = damp(smoothed.headRotZ, targetPose.headRotZ, 12, dt);
        smoothed.leftArmRotZ = damp(smoothed.leftArmRotZ, targetPose.leftArmRotZ, 12, dt);
        smoothed.leftArmRotX = damp(smoothed.leftArmRotX, targetPose.leftArmRotX, 12, dt);
        smoothed.rightArmRotZ = damp(smoothed.rightArmRotZ, targetPose.rightArmRotZ, 14, dt);
        smoothed.rightArmRotX = damp(smoothed.rightArmRotX, targetPose.rightArmRotX, 12, dt);
        smoothed.haloRotZ = damp(smoothed.haloRotZ, targetPose.haloRotZ, 12, dt);
        smoothed.haloY = damp(smoothed.haloY, targetPose.haloY, 12, dt);
        smoothed.pedestalScale = damp(smoothed.pedestalScale, targetPose.pedestalScale, 12, dt);
        smoothed.eyeScaleY = damp(smoothed.eyeScaleY, targetPose.eyeScaleY, 24, dt);
        smoothed.glowIntensity = damp(smoothed.glowIntensity, targetPose.glowIntensity, 10, dt);

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw2DAvatar(ctx, width, height, {
          elapsed,
          bodyY: smoothed.bodyY,
          bodyRotY: targetPose.bodyRotY,
          bodyRotX: targetPose.bodyRotX,
          bodyScaleY: smoothed.bodyScaleY,
          headRotX: smoothed.headRotX,
          headRotY: smoothed.headRotY,
          headRotZ: smoothed.headRotZ,
          leftArmRotZ: smoothed.leftArmRotZ,
          leftArmRotX: smoothed.leftArmRotX,
          rightArmRotZ: smoothed.rightArmRotZ,
          rightArmRotX: smoothed.rightArmRotX,
          haloRotY: targetPose.haloRotY,
          haloRotZ: smoothed.haloRotZ,
          haloY: smoothed.haloY,
          pedestalScale: smoothed.pedestalScale,
          eyeScaleY: smoothed.eyeScaleY,
          glowIntensity: smoothed.glowIntensity,
          sensitive: targetPose.state === 'sensitive',
          accentColor,
          primaryColor,
        });
        ctx.restore();
      };

      const render2DFrame = (forcePaint = false) => {
        if (disposed) return;
        const now = performance.now();
        if (forcePaint) {
          paint2DNow(now);
        } else {
          if (isPaused()) return;
          const isActive =
            hoveredRef.current ||
            thinkingRef.current ||
            sensitiveRef.current ||
            (clickStartMsRef.current !== null && now - clickStartMsRef.current < 1600) ||
            (celebrateStartMsRef.current !== null && now - celebrateStartMsRef.current < 1600);
          const minInterval = isActive ? 30 : 70;
          if (lastDrawMs === 0 || now - lastDrawMs >= minInterval) {
            paint2DNow(now);
          }
        }

        if (!reducedMotion && !isPaused()) {
          frameId = requestAnimationFrame(() => render2DFrame(false));
        }
      };

      triggerRepaintRef.current = () => {
        if (!disposed) {
          paint2DNow(performance.now());
        }
      };

      const resizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        cancelAnimationFrame(frameId);
        lastDrawMs = 0;
        // Always repaint immediately after canvas dimension assignment (which clears pixels)
        render2DFrame(true);
      });
      resizeObserver.observe(container);

      const onVisibilityChange = () => {
        if (!disposed && !isPaused()) {
          cancelAnimationFrame(frameId);
          lastFrameMs = performance.now();
          render2DFrame(true);
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      let intersectionObserver: IntersectionObserver | null = null;
      if (typeof IntersectionObserver !== 'undefined') {
        intersectionObserver = new IntersectionObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const wasVisible = visibleOnScreen;
          visibleOnScreen = entry.isIntersecting;
          if (!wasVisible && visibleOnScreen && !disposed) {
            cancelAnimationFrame(frameId);
            lastFrameMs = performance.now();
            render2DFrame(true);
          }
        });
        intersectionObserver.observe(container);
      }

      render2DFrame(true);

      return () => {
        triggerRepaintRef.current = null;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        intersectionObserver?.disconnect();
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        if (canvas.parentNode === container) {
          container.removeChild(canvas);
        }
      };
    };

    // Always mount the fast 2D canvas immediately so initial render has 0ms Three.js/WebGL blocking
    let activeCleanup: (() => void) | null = mount2DAvatar();

    const onMotionChange = () => {
      reducedMotion = motionQuery?.matches ?? false;
      triggerRepaintRef.current?.();
    };
    motionQuery?.addEventListener('change', onMotionChange);

    // Only upgrade to full Three.js 3D WebGL lazily after browser is idle and only on real hardware GPUs
    let upgradeTimer = 0;
    let webglCleanup: (() => void) | null = null;

    if (!detectSoftwareWebGl() && !reducedMotion) {
      upgradeTimer = window.setTimeout(() => {
        if (disposed) return;
        void (async () => {
          try {
            const [THREE, { RoomEnvironment }, { buildAssistantAvatarModel, createContactShadowTexture }] =
              await Promise.all([
                import('three'),
                import('three/examples/jsm/environments/RoomEnvironment.js'),
                import('./avatarModel.ts'),
              ]);
            if (disposed || !mountRef.current) return;

            let renderer: InstanceType<typeof THREE.WebGLRenderer>;
            try {
              renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance',
              });
            } catch {
              return;
            }

            const width = Math.max(container.clientWidth || 112, 66);
            const height = Math.max(container.clientHeight || 118, 70);

            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.15;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
            renderer.setSize(width, height, false);
            renderer.setClearColor(0x000000, 0);
            renderer.domElement.setAttribute('data-renderer', 'webgl');
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';
            renderer.domElement.style.display = 'block';
            renderer.domElement.style.pointerEvents = 'none';

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 30);
            camera.position.set(0, 0.25, 3.85);
            camera.lookAt(0, 0.08, 0);

            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
            scene.environment = envTarget.texture;
            pmremGenerator.dispose();

            scene.add(new THREE.HemisphereLight(0xfff7ed, 0x1e293b, 1.18));
            const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.25);
            keyLight.position.set(2.4, 3.6, 3.2);
            scene.add(keyLight);

            const rimLight = new THREE.PointLight(0xfb923c, 1.9, 12);
            rimLight.position.set(-2.2, 1.4, -1.8);
            scene.add(rimLight);

            const shadowTex = createContactShadowTexture();
            const textures = shadowTex ? [shadowTex] : [];
            const {
              avatarRoot,
              pedestalGroup,
              bodyGroup,
              headGroup,
              leftArmPivot,
              rightArmPivot,
              leftEye,
              rightEye,
              haloGroup,
              coreCrystal,
              matCyanGlow,
              matEyeGlow,
              geometries,
              materials,
            } = buildAssistantAvatarModel({
              accentColor,
              primaryColor,
              shadowTexture: shadowTex,
              includeContactShadow: true,
              detail: 'full',
            });
            scene.add(avatarRoot);

            // Render first WebGL frame before swapping out the 2D fallback canvas
            try {
              renderer.render(scene, camera);
            } catch {
              geometries.forEach((g) => g.dispose());
              materials.forEach((m) => m.dispose());
              textures.forEach((t) => t.dispose());
              envTarget.dispose();
              renderer.dispose();
              return;
            }

            if (disposed || !mountRef.current) {
              geometries.forEach((g) => g.dispose());
              materials.forEach((m) => m.dispose());
              textures.forEach((t) => t.dispose());
              envTarget.dispose();
              renderer.dispose();
              return;
            }

            if (activeCleanup) {
              activeCleanup();
              activeCleanup = null;
            }
            container.appendChild(renderer.domElement);

            let webglDisposed = false;
            let slowFrameCount = 0;
            let lastDrawMs = 0;

            const onContextLost = (ev: Event) => {
              ev.preventDefault();
              disposeWebGL();
              if (!disposed && !activeCleanup) {
                activeCleanup = mount2DAvatar();
              }
            };
            renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

            const disposeWebGL = () => {
              if (webglDisposed) return;
              webglDisposed = true;
              cancelAnimationFrame(frameId);
              triggerRepaintRef.current = null;
              renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
              resizeObserver.disconnect();
              document.removeEventListener('visibilitychange', onVisibilityChange);
              intersectionObserver?.disconnect();
              if (renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
              }
              geometries.forEach((g) => g.dispose());
              materials.forEach((m) => m.dispose());
              textures.forEach((t) => t.dispose());
              envTarget.dispose();
              renderer.dispose();
            };

            const resizeObserver = new ResizeObserver(() => {
              if (webglDisposed) return;
              const w = Math.max(container.clientWidth || 112, 66);
              const h = Math.max(container.clientHeight || 118, 70);
              camera.aspect = w / h;
              camera.updateProjectionMatrix();
              renderer.setSize(w, h, false);
              try {
                renderer.render(scene, camera);
              } catch {
                disposeWebGL();
                if (!disposed && !activeCleanup) activeCleanup = mount2DAvatar();
              }
            });
            resizeObserver.observe(container);

            const startMs = performance.now();
            let lastFrameMs = startMs;

            const tick = () => {
              if (isPaused() || webglDisposed) return;
              const now = performance.now();
              const isActive =
                hoveredRef.current ||
                thinkingRef.current ||
                sensitiveRef.current ||
                (clickStartMsRef.current !== null && now - clickStartMsRef.current < 1600) ||
                (celebrateStartMsRef.current !== null && now - celebrateStartMsRef.current < 1600);
              const minInterval = isActive ? 16 : 45;

              if (lastDrawMs === 0 || now - lastDrawMs >= minInterval) {
                const dt = Math.min(Math.max((now - lastFrameMs) / 1000, 0.001), 0.1);
                lastFrameMs = now;
                lastDrawMs = now;
                const { elapsed, targetPose } = readPose(now, startMs);

                const lambda = 11;
                bodyGroup.position.y = damp(bodyGroup.position.y, targetPose.bodyY - 0.05, lambda, dt);
                bodyGroup.rotation.y = damp(bodyGroup.rotation.y, targetPose.bodyRotY, lambda, dt);
                bodyGroup.rotation.x = damp(bodyGroup.rotation.x, targetPose.bodyRotX, lambda, dt);
                bodyGroup.scale.y = damp(bodyGroup.scale.y, targetPose.bodyScaleY, lambda, dt);

                headGroup.rotation.x = damp(headGroup.rotation.x, targetPose.headRotX, lambda, dt);
                headGroup.rotation.y = damp(headGroup.rotation.y, targetPose.headRotY, lambda, dt);
                headGroup.rotation.z = damp(headGroup.rotation.z, targetPose.headRotZ, lambda, dt);

                leftArmPivot.rotation.z = damp(leftArmPivot.rotation.z, targetPose.leftArmRotZ, lambda, dt);
                leftArmPivot.rotation.x = damp(leftArmPivot.rotation.x, targetPose.leftArmRotX, lambda, dt);
                rightArmPivot.rotation.z = damp(rightArmPivot.rotation.z, targetPose.rightArmRotZ, lambda + 4, dt);
                rightArmPivot.rotation.x = damp(rightArmPivot.rotation.x, targetPose.rightArmRotX, lambda, dt);

                haloGroup.rotation.y = targetPose.haloRotY;
                haloGroup.rotation.z = damp(haloGroup.rotation.z, targetPose.haloRotZ, lambda, dt);
                haloGroup.position.y = damp(haloGroup.position.y, targetPose.haloY, lambda, dt);

                pedestalGroup.scale.setScalar(
                  damp(pedestalGroup.scale.x, targetPose.pedestalScale, lambda, dt)
                );
                leftEye.scale.y = damp(leftEye.scale.y, targetPose.eyeScaleY, 24, dt);
                rightEye.scale.y = damp(rightEye.scale.y, targetPose.eyeScaleY, 24, dt);

                matCyanGlow.emissiveIntensity = damp(
                  matCyanGlow.emissiveIntensity,
                  targetPose.glowIntensity,
                  10,
                  dt
                );
                matEyeGlow.emissiveIntensity = damp(
                  matEyeGlow.emissiveIntensity,
                  targetPose.glowIntensity + 0.35,
                  10,
                  dt
                );
                coreCrystal.rotation.y = elapsed * 1.8;

                const renderStart = performance.now();
                try {
                  renderer.render(scene, camera);
                } catch {
                  disposeWebGL();
                  if (!disposed && !activeCleanup) {
                    activeCleanup = mount2DAvatar();
                  }
                  return;
                }
                const renderCost = performance.now() - renderStart;

                if (renderCost > 35 && elapsed > 0.2) {
                  slowFrameCount += 1;
                  if (slowFrameCount >= 2) {
                    disposeWebGL();
                    activeCleanup = mount2DAvatar();
                    return;
                  }
                } else {
                  slowFrameCount = 0;
                }
              }

              if (!reducedMotion) {
                frameId = requestAnimationFrame(tick);
              }
            };

            const onVisibilityChange = () => {
              if (!disposed && !webglDisposed && !isPaused()) {
                cancelAnimationFrame(frameId);
                lastFrameMs = performance.now();
                tick();
              }
            };
            document.addEventListener('visibilitychange', onVisibilityChange);

            let intersectionObserver: IntersectionObserver | null = null;
            if (typeof IntersectionObserver !== 'undefined') {
              intersectionObserver = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry) return;
                const wasVisible = visibleOnScreen;
                visibleOnScreen = entry.isIntersecting;
                if (!wasVisible && visibleOnScreen && !disposed && !webglDisposed) {
                  cancelAnimationFrame(frameId);
                  lastFrameMs = performance.now();
                  tick();
                }
              });
              intersectionObserver.observe(container);
            }

            webglCleanup = disposeWebGL;
            tick();
          } catch {
            // Keep 2D canvas avatar if Three.js chunk fails
          }
        })();
      }, 1200);
    }

    return () => {
      disposed = true;
      window.clearTimeout(upgradeTimer);
      motionQuery?.removeEventListener('change', onMotionChange);
      if (activeCleanup) activeCleanup();
      if (webglCleanup) webglCleanup();
    };
  }, [accentColor, primaryColor]);

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    pointerRef.current.x = Math.max(-1, Math.min(1, nx));
    pointerRef.current.y = Math.max(-1, Math.min(1, ny));
  };

  const handleAvatarClick = () => {
    clickStartMsRef.current = performance.now();
    visualStateRef.current = 'clicked';
    setClickCount((c) => c + 1);
    setVisualState('clicked');
    onClick();
  };

  const statusText = visualState === 'sensitive'
    ? 'Eyes Closed'
    : thinking
      ? 'Thinking…'
      : open
        ? 'AI Guide'
        : 'Ask AI';

  return (
    <button
      type="button"
      data-ai-id="assistant-launcher-btn"
      data-testid="assistant-launcher"
      data-avatar-state={visualState}
      data-click-count={clickCount}
      aria-label={open ? `${title} avatar — click to wave` : `Open ${title}`}
      title={open ? 'Click avatar to wave' : `Click to open ${title}`}
      className={`aia-avatar-btn ${open ? 'aia-avatar-open' : ''}`}
      onPointerEnter={() => {
        hoveredRef.current = true;
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        pointerRef.current = { x: 0, y: 0 };
      }}
      onPointerMove={handlePointerMove}
      onClick={handleAvatarClick}
    >
      <div
        ref={mountRef}
        data-testid="assistant-avatar-canvas-host"
        className="aia-avatar-stage"
        aria-hidden="true"
      />
      <span className="aia-avatar-label">{statusText}</span>
    </button>
  );
}

export const AssistantAvatar3D = React.memo(AssistantAvatar3DComponent, (prev, next) => {
  return (
    prev.open === next.open &&
    prev.thinking === next.thinking &&
    prev.sensitive === next.sensitive &&
    prev.celebrateTick === next.celebrateTick &&
    prev.accentColor === next.accentColor &&
    prev.primaryColor === next.primaryColor &&
    prev.title === next.title
  );
});
