import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArrowRight, FolderKanban, QrCode, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { formatINR } from '../../utils/currency.ts';
import type { AppRoute, GroupSummary, SimplifiedTransfer } from '../../types/index.ts';

interface DashboardRadialHubProps {
  groups: GroupSummary[];
  transfers: Array<SimplifiedTransfer & { groupId?: number; groupName?: string }>;
  userId: number;
  netBalancePaise: number;
  totalGroupExpenditurePaise: number;
  onNavigate: (route: AppRoute, params?: { groupId?: number }) => void;
  onOpenPayQr: (target: {
    groupId: number;
    groupName: string;
    payerUserId: number;
    payerName: string;
    receiverUserId: number;
    receiverName: string;
    amountPaise: number;
  }) => void;
}

export const DashboardRadialHub: React.FC<DashboardRadialHubProps> = ({
  groups,
  transfers,
  userId,
  netBalancePaise,
  totalGroupExpenditurePaise,
  onNavigate,
  onOpenPayQr,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groups[0]?.id ?? null);
  const [fallbackMode, setFallbackMode] = useState(false);

  const selectedGroupIdRef = useRef<number | null>(selectedGroupId);
  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId;
  }, [selectedGroupId]);

  useEffect(() => {
    if (groups.length > 0 && (selectedGroupId === null || !groups.some((g) => g.id === selectedGroupId))) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? groups[0] ?? null,
    [groups, selectedGroupId]
  );

  const groupTransfers = useMemo(
    () => (activeGroup ? transfers.filter((t) => t.groupId === activeGroup.id) : []),
    [transfers, activeGroup]
  );

  useEffect(() => {
    const container = mountRef.current;
    if (!container || groups.length === 0) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') || probe.getContext('webgl');
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

    const width = container.clientWidth || 560;
    const height = container.clientHeight || 360;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.cursor = 'pointer';
    container.appendChild(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setFallbackMode(true);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 3.6, 6.2);
    camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xd1fae5, 0x0f172a, 0.85);
    scene.add(hemi);

    const goldLight = new THREE.PointLight(0xf59e0b, 2.2, 14);
    goldLight.position.set(2.5, 3.2, 2.5);
    scene.add(goldLight);

    const emeraldLight = new THREE.PointLight(0x10b981, 2.4, 14);
    emeraldLight.position.set(-2.5, 2.5, -2.5);
    scene.add(emeraldLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(res: T): T => {
      disposables.push(res);
      return res;
    };

    const hubGroup = new THREE.Group();
    scene.add(hubGroup);

    // Central Glowing Core (Vault Icosahedron + Orbital Halos)
    const coreMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x059669,
        emissive: 0x065f46,
        emissiveIntensity: 0.4,
        metalness: 0.65,
        roughness: 0.18,
        clearcoat: 0.9,
      })
    );
    const coreMesh = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.62, 0)), coreMat);
    hubGroup.add(coreMesh);

    const coreWire = new THREE.Mesh(
      track(new THREE.OctahedronGeometry(0.84, 0)),
      track(new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.55 }))
    );
    hubGroup.add(coreWire);

    const innerRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(1.18, 0.015, 10, 72)),
      track(new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.45 }))
    );
    innerRing.rotation.x = Math.PI / 2;
    hubGroup.add(innerRing);

    const outerRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(2.55, 0.016, 10, 96)),
      track(new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 }))
    );
    outerRing.rotation.x = Math.PI / 2;
    hubGroup.add(outerRing);

    // Radial Group Nodes + Glowing Beams + Traveling Pulses
    const visibleGroups = groups.slice(0, 6);
    const radius = 2.55;
    const nodeEntries: Array<{
      groupId: number;
      mesh: THREE.Mesh;
      halo: THREE.Mesh;
      pulse: THREE.Mesh;
      curve: THREE.CatmullRomCurve3;
      basePos: THREE.Vector3;
    }> = [];

    visibleGroups.forEach((g, idx) => {
      const angle = (idx / Math.max(1, visibleGroups.length)) * Math.PI * 2 - Math.PI / 4;
      const pos = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);

      const nodeColor =
        g.myNetBalancePaise > 0 ? 0x10b981 : g.myNetBalancePaise < 0 ? 0xf59e0b : 0x14b8a6;

      const nodeMat = track(
        new THREE.MeshStandardMaterial({
          color: nodeColor,
          emissive: nodeColor,
          emissiveIntensity: 0.35,
          metalness: 0.55,
          roughness: 0.2,
        })
      );
      const nodeMesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.28, 24, 24)), nodeMat);
      nodeMesh.position.copy(pos);
      nodeMesh.userData = { groupId: g.id };
      hubGroup.add(nodeMesh);

      const halo = new THREE.Mesh(
        track(new THREE.TorusGeometry(0.42, 0.022, 10, 36)),
        track(new THREE.MeshBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.75 }))
      );
      halo.position.copy(pos);
      halo.rotation.x = Math.PI / 2;
      hubGroup.add(halo);

      // Luminous curved beam from Central Core -> Group Node
      const mid = new THREE.Vector3(pos.x * 0.5, 0.58, pos.z * 0.5);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), mid, pos]);
      const beamColor = g.myNetBalancePaise < 0 ? 0xf59e0b : 0x34d399;
      const beamMat = track(
        new THREE.MeshStandardMaterial({
          color: beamColor,
          emissive: beamColor,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.75,
        })
      );
      const beam = new THREE.Mesh(track(new THREE.TubeGeometry(curve, 24, 0.02, 8, false)), beamMat);
      hubGroup.add(beam);

      const pulse = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.065, 12, 12)),
        track(new THREE.MeshBasicMaterial({ color: 0xfef3c7 }))
      );
      hubGroup.add(pulse);

      nodeEntries.push({ groupId: g.id, mesh: nodeMesh, halo, pulse, curve, basePos: pos });
    });

    // Raycaster for direct 3D node clicking
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeEntries.map((n) => n.mesh), false);
      if (hits.length > 0) {
        const hitGroupId = hits[0].object.userData?.groupId;
        if (typeof hitGroupId === 'number') {
          setSelectedGroupId(hitGroupId);
        }
      }
    };
    container.addEventListener('pointerdown', onPointerDown);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 560;
      const h = container.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (prefersReducedMotion) {
      renderer.render(scene, camera);
      return () => {
        window.removeEventListener('resize', onResize);
        container.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        disposables.forEach((d) => d.dispose());
        envTex.dispose();
        renderer.dispose();
        if (canvas.parentElement === container) container.removeChild(canvas);
      };
    }

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    const targetLook = new THREE.Vector3(0, 0, 0);

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

      coreMesh.rotation.y += dt * 0.45;
      coreMesh.rotation.x += dt * 0.2;
      coreWire.rotation.y -= dt * 0.35;

      // Smooth 3D Camera Fly-To when user selects a group node
      const activeEntry = nodeEntries.find((n) => n.groupId === selectedGroupIdRef.current);
      const desiredCamX = activeEntry ? activeEntry.basePos.x * 0.55 : 0;
      const desiredCamZ = activeEntry ? activeEntry.basePos.z * 0.55 + 5.2 : 6.2;
      const desiredCamY = activeEntry ? 2.9 : 3.6;

      camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCamX, 3.8, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCamY, 3.8, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCamZ, 3.8, dt);

      const lookX = activeEntry ? activeEntry.basePos.x * 0.35 : 0;
      const lookZ = activeEntry ? activeEntry.basePos.z * 0.35 : 0;
      targetLook.x = THREE.MathUtils.damp(targetLook.x, lookX, 4.0, dt);
      targetLook.z = THREE.MathUtils.damp(targetLook.z, lookZ, 4.0, dt);
      camera.lookAt(targetLook);

      nodeEntries.forEach((n, idx) => {
        const isSelected = n.groupId === selectedGroupIdRef.current;
        const targetScale = isSelected ? 1.38 + Math.sin(elapsed * 3.5) * 0.08 : 1.0;
        const s = THREE.MathUtils.damp(n.mesh.scale.x, targetScale, 6, dt);
        n.mesh.scale.setScalar(s);
        n.halo.scale.setScalar(isSelected ? 1.45 + Math.sin(elapsed * 3) * 0.1 : 1.0);
        n.halo.rotation.z += dt * (isSelected ? 1.2 : 0.35);

        const t = (elapsed * 0.45 + idx * 0.23) % 1;
        n.pulse.position.copy(n.curve.getPointAt(t));
      });

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
      container.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      disposables.forEach((d) => d.dispose());
      envTex.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
    };
  }, [groups]);

  const spendSharePct =
    activeGroup && totalGroupExpenditurePaise > 0
      ? Math.round((activeGroup.totalExpenditurePaise / totalGroupExpenditurePaise) * 100)
      : 0;

  return (
    <section className="rounded-2xl overflow-hidden border border-slate-200 bg-gradient-to-br from-[#0B131E] via-[#0D211D] to-[#06382B] text-white shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left/Center 3D Interactive Radial Hub */}
        <div className="lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between relative border-b lg:border-b-0 lg:border-r border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>3D Radial Expense &amp; Debt Network</span>
              </p>
              <h2 className="font-display text-lg font-bold mt-0.5">
                Click any node to fly camera &amp; inspect live flows
              </h2>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-slate-300">Vault Net</p>
              <p
                className={`font-mono-num text-sm font-bold ${
                  netBalancePaise >= 0 ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {netBalancePaise > 0 ? `+${formatINR(netBalancePaise)}` : formatINR(netBalancePaise)}
              </p>
            </div>
          </div>

          {fallbackMode ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-emerald-200/80">
              Interactive Radial Graph active in 2D selector on right.
            </div>
          ) : (
            <div ref={mountRef} className="w-full h-[290px] sm:h-[330px]" />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 pt-2 border-t border-white/10">
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Receivable
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Payable
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-400" /> Settled
              </span>
            </span>
            <span>Luminous rays trace N − 1 debt paths</span>
          </div>
        </div>

        {/* Right Structured Node Inspector Panel */}
        <div className="lg:col-span-5 p-5 sm:p-6 bg-slate-950/35 flex flex-col justify-between space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Active Group Nodes ({groups.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {groups.slice(0, 6).map((g) => {
                const isSel = activeGroup?.id === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      isSel
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                        : 'bg-white/5 text-slate-200 border-white/15 hover:bg-white/10'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          {activeGroup && (
            <motion.div
              key={activeGroup.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="rounded-xl bg-white/10 border border-white/15 p-4 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-emerald-300 font-semibold">{activeGroup.category}</p>
                  <h3 className="font-display text-lg font-bold text-white">{activeGroup.name}</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    {activeGroup.memberCount} members · {activeGroup.expenseCount} expenses
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-300">Your Net</p>
                  <p
                    className={`font-mono-num text-base font-bold ${
                      activeGroup.myNetBalancePaise >= 0 ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {activeGroup.myNetBalancePaise > 0
                      ? `+${formatINR(activeGroup.myNetBalancePaise)}`
                      : formatINR(activeGroup.myNetBalancePaise)}
                  </p>
                </div>
              </div>

              {/* Live Percentage Share Meter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Share of Total Spend</span>
                  <span className="font-mono-num font-semibold text-white">
                    {formatINR(activeGroup.totalExpenditurePaise)} ({spendSharePct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(4, spendSharePct)}%` }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
                  />
                </div>
              </div>

              {/* Group Transfer Actions */}
              {groupTransfers.length > 0 && (
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Active Node Transfers
                  </p>
                  {groupTransfers.slice(0, 2).map((t, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 text-xs bg-slate-950/40 rounded-lg px-3 py-2"
                    >
                      <span className="truncate text-slate-200">
                        {t.fromUserId === userId ? 'You' : t.fromName} →{' '}
                        {t.toUserId === userId ? 'You' : t.toName}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-num font-bold text-amber-300">
                          {formatINR(t.amountPaise)}
                        </span>
                        {t.fromUserId === userId && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPayQr({
                                groupId: activeGroup.id,
                                groupName: activeGroup.name,
                                payerUserId: t.fromUserId,
                                payerName: t.fromName,
                                receiverUserId: t.toUserId,
                                receiverName: t.toName,
                                amountPaise: t.amountPaise,
                              })
                            }
                            className="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold cursor-pointer inline-flex items-center gap-1"
                          >
                            <QrCode className="w-3 h-3" />
                            <span>QR</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => onNavigate('/groups', { groupId: activeGroup.id })}
                className="w-full py-2 px-3 rounded-lg bg-white text-slate-900 hover:bg-emerald-50 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <FolderKanban className="w-3.5 h-3.5 text-[#065F46]" />
                <span>Open {activeGroup.name} Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};
