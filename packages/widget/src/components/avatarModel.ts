import * as THREE from 'three';

export interface AvatarModelOptions {
  accentColor?: string;
  primaryColor?: string;
  shadowTexture?: THREE.Texture | null;
  includeContactShadow?: boolean;
  detail?: 'full' | 'lite';
}

export interface BuiltAvatarModel {
  avatarRoot: THREE.Group;
  shadowPlane: THREE.Mesh;
  pedestalGroup: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  haloGroup: THREE.Group;
  coreCrystal: THREE.Mesh;
  matCyanGlow: THREE.MeshStandardMaterial;
  matEyeGlow: THREE.MeshStandardMaterial;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export function createContactShadowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
    grad.addColorStop(0.55, 'rgba(249, 115, 22, 0.22)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Shared procedural Three.js robot character (29 meshes, 15,834 triangles)
 * used by both AssistantAvatar3D (dock launcher) and GuideAvatarController (Guide Skill v2),
 * and verified directly by scripts/inspectAvatar.ts.
 */
export function buildAssistantAvatarModel(options: AvatarModelOptions = {}): BuiltAvatarModel {
  const isLite = options.detail === 'lite';
  const seg = (full: number, lite: number) => (isLite ? lite : full);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const accentThreeColor = new THREE.Color(options.accentColor || '#f97316');
  const primaryThreeColor = new THREE.Color(options.primaryColor || '#0f172a');

  const matCeramic = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfaf7f2,
      roughness: 0.26,
      metalness: 0.1,
    })
  );
  matCeramic.name = 'matCeramic';

  const matSlateMetal = trackMat(
    new THREE.MeshStandardMaterial({
      color: primaryThreeColor.clone().lerp(new THREE.Color(0x1e293b), 0.38),
      roughness: 0.24,
      metalness: 0.82,
    })
  );
  matSlateMetal.name = 'matSlateMetal';

  const matCobaltTrim = trackMat(
    new THREE.MeshStandardMaterial({
      color: accentThreeColor,
      roughness: 0.28,
      metalness: 0.62,
    })
  );
  matCobaltTrim.name = 'matCobaltTrim';

  const matVisorGlass = trackMat(
    isLite
      ? new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.12,
          metalness: 0.35,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x0f172a,
          roughness: 0.08,
          metalness: 0.2,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
        })
  );
  matVisorGlass.name = 'matVisorGlass';

  const matCyanGlow = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfdba74,
      emissive: accentThreeColor,
      emissiveIntensity: 1.25,
      roughness: 0.18,
      metalness: 0.1,
    })
  );
  matCyanGlow.name = 'matCyanGlow';

  const matEyeGlow = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: new THREE.Color(0xfb923c),
      emissiveIntensity: 1.65,
      roughness: 0.15,
      metalness: 0.05,
    })
  );
  matEyeGlow.name = 'matEyeGlow';

  const avatarRoot = new THREE.Group();
  avatarRoot.name = 'avatarRoot';

  // 1. Contact shadow disc (grounded beneath pedestal)
  const shadowMat = options.shadowTexture
    ? new THREE.MeshBasicMaterial({
        map: options.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      })
    : new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        depthWrite: false,
        opacity: options.includeContactShadow === false ? 0 : 0.35,
      });
  shadowMat.name = 'matShadow';
  const shadowPlane = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.7, 1.7)), trackMat(shadowMat));
  shadowPlane.name = 'shadowPlane';
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -0.96;
  if (options.includeContactShadow === false) {
    shadowPlane.visible = false;
  }
  avatarRoot.add(shadowPlane);

  // 2. Holographic pedestal ring + emitter torus
  const pedestalGroup = new THREE.Group();
  pedestalGroup.name = 'pedestalGroup';
  pedestalGroup.position.y = -0.84;
  avatarRoot.add(pedestalGroup);

  const outerPedestalRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.56, 0.045, seg(18, 8), seg(48, 22))),
    matSlateMetal
  );
  outerPedestalRing.name = 'outerPedestalRing';
  outerPedestalRing.rotation.x = Math.PI / 2;
  pedestalGroup.add(outerPedestalRing);

  const energyEmitterRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.42, 0.022, seg(16, 8), seg(48, 20))),
    matCyanGlow
  );
  energyEmitterRing.name = 'energyEmitterRing';
  energyEmitterRing.rotation.x = Math.PI / 2;
  energyEmitterRing.position.y = 0.015;
  pedestalGroup.add(energyEmitterRing);

  // 3. Articulated hovering character body group
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'bodyGroup';
  bodyGroup.position.y = -0.05;
  avatarRoot.add(bodyGroup);

  // Lower thruster skirt (LatheGeometry)
  const thrusterProfile = [
    new THREE.Vector2(0.01, -0.58),
    new THREE.Vector2(0.24, -0.54),
    new THREE.Vector2(0.32, -0.42),
    new THREE.Vector2(0.26, -0.34),
    new THREE.Vector2(0.01, -0.34),
  ];
  const thrusterMesh = new THREE.Mesh(
    trackGeo(new THREE.LatheGeometry(thrusterProfile, seg(32, 14))),
    matSlateMetal
  );
  thrusterMesh.name = 'thrusterMesh';
  bodyGroup.add(thrusterMesh);

  const thrusterGlow = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.16, 0.08, 0.06, seg(24, 12))),
    matCyanGlow
  );
  thrusterGlow.name = 'thrusterGlow';
  thrusterGlow.position.y = -0.57;
  bodyGroup.add(thrusterGlow);

  // Torso chassis (sculpted LatheGeometry)
  const torsoProfile = [
    new THREE.Vector2(0.01, -0.36),
    new THREE.Vector2(0.28, -0.34),
    new THREE.Vector2(0.41, -0.14),
    new THREE.Vector2(0.43, 0.08),
    new THREE.Vector2(0.33, 0.24),
    new THREE.Vector2(0.21, 0.28),
    new THREE.Vector2(0.01, 0.28),
  ];
  const torsoMesh = new THREE.Mesh(
    trackGeo(new THREE.LatheGeometry(torsoProfile, seg(36, 16))),
    matCeramic
  );
  torsoMesh.name = 'torsoMesh';
  bodyGroup.add(torsoMesh);

  // Chest emblem plate + AI core crystal
  const chestPlate = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.19, 0.21, 0.06, seg(28, 14))),
    matCobaltTrim
  );
  chestPlate.name = 'chestPlate';
  chestPlate.rotation.x = Math.PI / 2;
  chestPlate.position.set(0, -0.01, 0.39);
  bodyGroup.add(chestPlate);

  const coreCrystal = new THREE.Mesh(
    trackGeo(new THREE.OctahedronGeometry(0.1, 0)),
    matCyanGlow
  );
  coreCrystal.name = 'coreCrystal';
  coreCrystal.position.set(0, -0.01, 0.43);
  coreCrystal.scale.set(1, 1.15, 0.55);
  bodyGroup.add(coreCrystal);

  // Neck collar
  const neckCollar = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.16, 0.2, 0.1, seg(24, 12))),
    matSlateMetal
  );
  neckCollar.name = 'neckCollar';
  neckCollar.position.y = 0.31;
  bodyGroup.add(neckCollar);

  // Articulated Left & Right Arms (pivoted at shoulder)
  const armGeo = trackGeo(new THREE.CapsuleGeometry(0.085, 0.28, seg(8, 4), seg(16, 8)));
  const shoulderGeo = trackGeo(new THREE.SphereGeometry(0.105, seg(18, 10), seg(18, 8)));
  const cuffGeo = trackGeo(new THREE.TorusGeometry(0.088, 0.018, seg(12, 6), seg(24, 12)));

  const createArm = (side: -1 | 1, prefix: string) => {
    const pivot = new THREE.Group();
    pivot.name = `${prefix}ArmPivot`;
    pivot.position.set(side * 0.49, 0.16, 0.02);

    const shoulder = new THREE.Mesh(shoulderGeo, matSlateMetal);
    shoulder.name = `${prefix}Shoulder`;
    pivot.add(shoulder);

    const forearm = new THREE.Mesh(armGeo, matCeramic);
    forearm.name = `${prefix}Forearm`;
    forearm.position.set(side * 0.05, -0.22, 0.03);
    forearm.rotation.z = side * 0.14;
    pivot.add(forearm);

    const wristCuff = new THREE.Mesh(cuffGeo, matCyanGlow);
    wristCuff.name = `${prefix}WristCuff`;
    wristCuff.rotation.x = Math.PI / 2;
    wristCuff.position.set(side * 0.08, -0.34, 0.03);
    pivot.add(wristCuff);

    bodyGroup.add(pivot);
    return pivot;
  };

  const leftArmPivot = createArm(-1, 'left');
  const rightArmPivot = createArm(1, 'right');

  // 4. Articulated Head Group
  const headGroup = new THREE.Group();
  headGroup.name = 'headGroup';
  headGroup.position.set(0, 0.56, 0);
  bodyGroup.add(headGroup);

  const headShell = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.41, seg(32, 16), seg(24, 12))),
    matCeramic
  );
  headShell.name = 'headShell';
  headShell.scale.set(1.16, 0.92, 1.02);
  headGroup.add(headShell);

  const visorMesh = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.35, seg(32, 16), seg(24, 12), 0, Math.PI * 2, 0.28, Math.PI * 0.65)),
    matVisorGlass
  );
  visorMesh.name = 'visorMesh';
  visorMesh.scale.set(1.12, 0.72, 0.78);
  visorMesh.position.set(0, 0.01, 0.17);
  headGroup.add(visorMesh);

  // Expressive glowing eyes
  const eyeGeo = trackGeo(new THREE.CapsuleGeometry(0.044, 0.068, seg(8, 4), seg(16, 8)));
  const leftEye = new THREE.Mesh(eyeGeo, matEyeGlow);
  leftEye.name = 'leftEye';
  leftEye.position.set(-0.145, 0.025, 0.425);
  leftEye.rotation.z = 0.06;
  headGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, matEyeGlow);
  rightEye.name = 'rightEye';
  rightEye.position.set(0.145, 0.025, 0.425);
  rightEye.rotation.z = -0.06;
  headGroup.add(rightEye);

  // Side comms ear pods
  const earPodGeo = trackGeo(new THREE.CylinderGeometry(0.13, 0.13, 0.09, seg(24, 12)));
  const earRingGeo = trackGeo(new THREE.TorusGeometry(0.115, 0.018, seg(12, 6), seg(24, 12)));

  ([-1, 1] as const).forEach((side) => {
    const sideName = side === -1 ? 'left' : 'right';
    const pod = new THREE.Mesh(earPodGeo, matCobaltTrim);
    pod.name = `${sideName}EarPod`;
    pod.rotation.z = Math.PI / 2;
    pod.position.set(side * 0.48, 0.02, 0);
    headGroup.add(pod);

    const trim = new THREE.Mesh(earRingGeo, matCyanGlow);
    trim.name = `${sideName}EarTrim`;
    trim.rotation.y = Math.PI / 2;
    trim.position.set(side * 0.525, 0.02, 0);
    headGroup.add(trim);
  });

  // Top antenna + tip orb
  const antennaStem = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.018, 0.024, 0.18, seg(12, 8))),
    matSlateMetal
  );
  antennaStem.name = 'antennaStem';
  antennaStem.position.set(0, 0.43, -0.02);
  headGroup.add(antennaStem);

  const antennaOrb = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.055, seg(16, 10), seg(16, 8))),
    matCyanGlow
  );
  antennaOrb.name = 'antennaOrb';
  antennaOrb.position.set(0, 0.54, -0.02);
  headGroup.add(antennaOrb);

  // 5. Orbiting Neural Halo Ring
  const haloGroup = new THREE.Group();
  haloGroup.name = 'haloGroup';
  haloGroup.position.set(0, 1.02, 0);
  bodyGroup.add(haloGroup);

  const haloRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.36, 0.018, seg(14, 6), seg(48, 20))),
    matCyanGlow
  );
  haloRing.name = 'haloRing';
  haloRing.rotation.x = Math.PI / 2;
  haloGroup.add(haloRing);

  const haloNodeGeo = trackGeo(new THREE.SphereGeometry(0.036, seg(12, 8), seg(12, 6)));
  for (let i = 0; i < 3; i += 1) {
    const angle = (i * Math.PI * 2) / 3;
    const node = new THREE.Mesh(haloNodeGeo, matCobaltTrim);
    node.name = `haloNode_${i + 1}`;
    node.position.set(Math.cos(angle) * 0.36, 0, Math.sin(angle) * 0.36);
    haloGroup.add(node);
  }

  return {
    avatarRoot,
    shadowPlane,
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
  };
}
