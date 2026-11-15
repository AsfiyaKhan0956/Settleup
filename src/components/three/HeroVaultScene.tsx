import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Interactive 3D Geometric Financial Sculpture for the SettleUp Hero.
 * Combines a slate ledger card with a brushed-gold bezel, floating crystal octahedron core,
 * stacked 3D coin tower, dual intersecting orbital rings with 3D receipt prisms & polyhedra,
 * and curved TubeGeometry transfer arcs depicting debt simplification.
 */
export const HeroVaultScene: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFallbackMode(true);
      return;
    }

    const width = container.clientWidth || 540;
    const height = container.clientHeight || 460;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setFallbackMode(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 1.4, 8.2);
    camera.lookAt(0, 0.1, 0);

    // Three-point studio lighting with warm/emerald/teal rim contrast
    const hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
    keyLight.position.set(5, 7, 5.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x14b8a6, 1.3);
    rimLight.position.set(-5.5, 2.8, -4);
    scene.add(rimLight);

    const accentLight = new THREE.PointLight(0xf59e0b, 1.6, 10);
    accentLight.position.set(2.4, 1.6, 2.5);
    scene.add(accentLight);

    // Track disposables cleanly
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(res: T): T => {
      disposables.push(res);
      return res;
    };

    const sculpture = new THREE.Group();
    scene.add(sculpture);

    // 1. Central Slate Ledger Card + Brushed Gold Frame + Holographic Chip + Split Bars
    const ledgerGroup = new THREE.Group();
    ledgerGroup.rotation.set(-0.16, 0.24, 0.03);
    sculpture.add(ledgerGroup);

    const ledgerGeo = track(new THREE.BoxGeometry(2.45, 1.56, 0.2));
    const ledgerMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x0f172a,
        metalness: 0.45,
        roughness: 0.22,
        clearcoat: 0.8,
        clearcoatRoughness: 0.15,
      })
    );
    const ledgerSlab = new THREE.Mesh(ledgerGeo, ledgerMat);
    ledgerSlab.castShadow = true;
    ledgerGroup.add(ledgerSlab);

    const frameMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xd97706,
        metalness: 0.9,
        roughness: 0.2,
        clearcoat: 0.5,
      })
    );
    const topBar = new THREE.Mesh(track(new THREE.BoxGeometry(2.53, 0.06, 0.24)), frameMat);
    topBar.position.y = 0.78;
    const botBar = new THREE.Mesh(track(new THREE.BoxGeometry(2.53, 0.06, 0.24)), frameMat);
    botBar.position.y = -0.78;
    const leftBar = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 1.62, 0.24)), frameMat);
    leftBar.position.x = -1.235;
    const rightBar = new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 1.62, 0.24)), frameMat);
    rightBar.position.x = 1.235;
    ledgerGroup.add(topBar, botBar, leftBar, rightBar);

    // Glowing holographic chip on card top-left
    const chipMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x059669,
        emissiveIntensity: 0.45,
        metalness: 0.8,
        roughness: 0.18,
      })
    );
    const chip = new THREE.Mesh(track(new THREE.BoxGeometry(0.36, 0.28, 0.04)), chipMat);
    chip.position.set(-0.82, 0.42, 0.11);
    ledgerGroup.add(chip);

    // 4 Split-ratio bars on ledger face (Emerald, Teal, Amber, Indigo)
    const barColors = [0x10b981, 0x14b8a6, 0xf59e0b, 0x6366f1];
    const barWidths = [1.55, 1.12, 1.38, 0.85];
    const barMeshes: THREE.Mesh[] = [];
    barWidths.forEach((bw, idx) => {
      const bMat = track(
        new THREE.MeshStandardMaterial({
          color: barColors[idx],
          emissive: barColors[idx],
          emissiveIntensity: 0.18,
          metalness: 0.55,
          roughness: 0.25,
        })
      );
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(bw, 0.13, 0.05)), bMat);
      bar.position.set(-0.9 + bw / 2, 0.1 - idx * 0.22, 0.11);
      ledgerGroup.add(bar);
      barMeshes.push(bar);
    });

    // 2. Faceted 3D Crystal Octahedron + Inner Golden Wireframe Core (Upper-Left)
    const crystalGroup = new THREE.Group();
    crystalGroup.position.set(-1.75, 1.05, 0.45);
    sculpture.add(crystalGroup);

    const crystalMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x10b981,
        metalness: 0.15,
        roughness: 0.08,
        transmission: 0.55,
        transparent: true,
        opacity: 0.88,
        clearcoat: 1.0,
      })
    );
    const crystal = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.46, 0)), crystalMat);
    crystal.castShadow = true;
    const wireCore = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(0.56, 0)),
      track(new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.55 }))
    );
    crystalGroup.add(crystal, wireCore);

    // 3. Stacked 3D Coin Tower on Tiered Pedestal (Bottom-Left)
    const coinTowerGroup = new THREE.Group();
    coinTowerGroup.position.set(-1.72, -0.82, 0.72);
    sculpture.add(coinTowerGroup);

    const coinGeo = track(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 36));
    const coinRimGeo = track(new THREE.TorusGeometry(0.4, 0.026, 12, 36));
    const goldCoinMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        metalness: 0.92,
        roughness: 0.16,
        clearcoat: 0.45,
      })
    );
    const emeraldCoinMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x059669,
        metalness: 0.85,
        roughness: 0.2,
      })
    );
    const tealCoinMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x0d9488,
        metalness: 0.85,
        roughness: 0.2,
      })
    );

    [goldCoinMat, emeraldCoinMat, tealCoinMat].forEach((mat, i) => {
      const c = new THREE.Mesh(coinGeo, mat);
      c.position.set((i % 2 === 0 ? 1 : -1) * 0.06, i * 0.13, 0);
      c.castShadow = true;
      const r = new THREE.Mesh(coinRimGeo, mat);
      r.rotation.x = Math.PI / 2;
      r.position.copy(c.position);
      coinTowerGroup.add(c, r);
    });

    // 4. Floating Milled Gold Coin & Receipt Prism (Upper-Right)
    const floatingCoinGroup = new THREE.Group();
    const floatCoin = new THREE.Mesh(coinGeo, goldCoinMat);
    floatCoin.rotation.x = Math.PI / 2;
    const floatRim = new THREE.Mesh(coinRimGeo, goldCoinMat);
    floatingCoinGroup.add(floatCoin, floatRim);
    floatingCoinGroup.position.set(1.68, 0.95, 0.68);
    floatingCoinGroup.scale.setScalar(1.15);
    sculpture.add(floatingCoinGroup);

    const receiptMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.22,
        clearcoat: 0.65,
      })
    );
    const receiptPrism = new THREE.Mesh(track(new THREE.BoxGeometry(0.68, 0.9, 0.08)), receiptMat);
    receiptPrism.position.set(1.75, -0.58, 0.55);
    receiptPrism.rotation.set(0.18, -0.45, -0.14);
    const receiptStripe = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.46, 0.08, 0.1)),
      track(new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.3 }))
    );
    receiptStripe.position.y = 0.24;
    const receiptStripe2 = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.34, 0.06, 0.1)),
      track(new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.3 }))
    );
    receiptStripe2.position.y = 0.04;
    receiptPrism.add(receiptStripe, receiptStripe2);
    sculpture.add(receiptPrism);

    // 5. Dual Intersecting Orbital Rings + 5 Friend Nodes + Curved 3D Transfer Arcs
    const orbitRingGeo = track(new THREE.TorusGeometry(2.38, 0.018, 12, 96));
    const orbitRingMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.72,
        roughness: 0.32,
      })
    );
    const orbitRing1 = new THREE.Mesh(orbitRingGeo, orbitRingMat);
    orbitRing1.rotation.set(1.16, 0.22, 0.08);
    sculpture.add(orbitRing1);

    const orbitRing2Geo = track(new THREE.TorusGeometry(2.68, 0.014, 10, 96));
    const orbitRing2Mat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0d9488,
        metalness: 0.75,
        roughness: 0.28,
      })
    );
    const orbitRing2 = new THREE.Mesh(orbitRing2Geo, orbitRing2Mat);
    orbitRing2.rotation.set(-0.78, -0.42, 0.25);
    sculpture.add(orbitRing2);

    const nodeGeo = track(new THREE.SphereGeometry(0.15, 24, 24));
    const nodeColors = [0x065f46, 0x0d9488, 0x4f46e5, 0xe11d48, 0xf59e0b];
    const nodeOrbitGroup = new THREE.Group();
    orbitRing1.add(nodeOrbitGroup);

    const nodePositions: THREE.Vector3[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const nMat = track(
        new THREE.MeshStandardMaterial({
          color: nodeColors[i],
          emissive: nodeColors[i],
          emissiveIntensity: 0.16,
          metalness: 0.55,
          roughness: 0.22,
        })
      );
      const node = new THREE.Mesh(nodeGeo, nMat);
      const pos = new THREE.Vector3(Math.cos(angle) * 2.38, Math.sin(angle) * 2.38, 0);
      node.position.copy(pos);
      nodePositions.push(pos);
      nodeOrbitGroup.add(node);
    }

    // Add 3 curved 3D transfer arcs connecting debtor nodes to central hub on orbitRing1
    const arcMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x065f46,
        emissiveIntensity: 0.25,
        metalness: 0.6,
        roughness: 0.25,
      })
    );
    [0, 2, 4].forEach((idx) => {
      const start = nodePositions[idx];
      const mid = new THREE.Vector3(start.x * 0.45, start.y * 0.45, 0.55);
      const end = new THREE.Vector3(0, 0, 0.12);
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      const tubeGeo = track(new THREE.TubeGeometry(curve, 24, 0.016, 8, false));
      const arc = new THREE.Mesh(tubeGeo, arcMat);
      nodeOrbitGroup.add(arc);
    });

    // Secondary ring orbiting polyhedra (Tetrahedron + Dodecahedron badges)
    const badgeGroup2 = new THREE.Group();
    orbitRing2.add(badgeGroup2);
    const tetra = new THREE.Mesh(
      track(new THREE.TetrahedronGeometry(0.18, 0)),
      track(new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.75, roughness: 0.2 }))
    );
    tetra.position.set(2.68, 0, 0);
    const dodeca = new THREE.Mesh(
      track(new THREE.DodecahedronGeometry(0.16, 0)),
      track(new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.65, roughness: 0.22 }))
    );
    dodeca.position.set(-2.68, 0, 0);
    badgeGroup2.add(tetra, dodeca);

    // 6. Soft radial contact shadow plane underneath sculpture
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(128, 128, 12, 128, 128, 120);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0.24)');
      grad.addColorStop(0.6, 'rgba(15, 23, 42, 0.08)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 256, 256);
    }
    const shadowTex = track(new THREE.CanvasTexture(shadowCanvas));
    const shadowMat = track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    const shadowPlane = new THREE.Mesh(track(new THREE.PlaneGeometry(5.6, 3.6)), shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.92;
    scene.add(shadowPlane);

    // Interactive pointer parallax + drag-to-orbit
    let targetRotX = 0;
    let targetRotY = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };
    const onPointerUp = () => {
      isDragging = false;
      canvas.style.cursor = 'grab';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (isDragging) {
        dragOffsetY += (e.clientX - lastX) * 0.008;
        dragOffsetX = Math.max(-0.5, Math.min(0.5, dragOffsetX + (e.clientY - lastY) * 0.006));
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ny = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      targetRotY = nx * 0.28;
      targetRotX = -ny * 0.16;
    };

    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointermove', onPointerMove);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 540;
      const h = container.clientHeight || 460;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (prefersReducedMotion) {
      renderer.render(scene, camera);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        disposables.forEach((d) => d.dispose());
        envTexture.dispose();
        renderer.dispose();
        if (canvas.parentElement === container) container.removeChild(canvas);
      };
    }

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      sculpture.rotation.y = THREE.MathUtils.damp(sculpture.rotation.y, targetRotY + dragOffsetY, 4.5, dt);
      sculpture.rotation.x = THREE.MathUtils.damp(sculpture.rotation.x, targetRotX + dragOffsetX, 4.5, dt);
      sculpture.position.y = Math.sin(elapsed * 1.1) * 0.08;

      // Subtle pulse on split bars
      barMeshes.forEach((bar, i) => {
        bar.scale.x = 1 + Math.sin(elapsed * 2.1 + i * 0.8) * 0.06;
      });

      crystalGroup.position.y = 1.05 + Math.sin(elapsed * 1.5) * 0.1;
      crystalGroup.rotation.y += dt * 0.6;
      crystalGroup.rotation.x += dt * 0.25;

      coinTowerGroup.position.y = -0.82 + Math.cos(elapsed * 1.35) * 0.07;
      coinTowerGroup.rotation.y += dt * 0.3;

      floatingCoinGroup.position.y = 0.95 + Math.sin(elapsed * 1.7 + 0.5) * 0.1;
      floatingCoinGroup.rotation.y += dt * 0.65;

      receiptPrism.position.y = -0.58 + Math.sin(elapsed * 1.45 + 1.2) * 0.09;
      receiptPrism.rotation.y = -0.45 + Math.sin(elapsed * 0.9) * 0.12;

      nodeOrbitGroup.rotation.z += dt * 0.26;
      badgeGroup2.rotation.z -= dt * 0.34;
      tetra.rotation.x += dt * 0.9;
      dodeca.rotation.y += dt * 0.8;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);

      disposables.forEach((d) => d.dispose());
      envTexture.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  if (fallbackMode) {
    return (
      <div className="w-full h-full min-h-[380px] rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[#065F46] text-white flex items-center justify-center font-display text-3xl font-bold mb-4 shadow-md">
          ₹
        </div>
        <p className="font-display font-semibold text-slate-900">Precision Ledger Geometry</p>
        <p className="text-sm text-slate-600 mt-1 max-w-xs">
          Every shared item and settlement path resolved cleanly in integer paise.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className="w-full h-[380px] sm:h-[440px] lg:h-[480px] relative select-none"
      aria-label="Interactive 3D geometric expense ledger visualization. Drag to rotate."
    />
  );
};
