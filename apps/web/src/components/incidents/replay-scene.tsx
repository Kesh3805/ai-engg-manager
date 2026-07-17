'use client';

import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Play, Pause, RotateCcw, StepForward } from 'lucide-react';
import { playSound } from '@/lib/sound';

/**
 * Incident temporal replay (plan §14.2), driven by the incident's evidence
 * graph. The 8-minute narrative is normalized to a 0–1 clock:
 *   0.00 normal → 0.15 deployment flashes amber → 0.30 primary service red →
 *   0.50 downstream cascade → 0.65 flare explosion → 0.80+ rollback recovery.
 * Play/pause/rewind/frame-step; camera stays user-controlled.
 */

export interface ReplayService {
  id: string;
  label: string;
  kind: 'deployment' | 'service' | 'downstream';
}

type NodeState = 'normal' | 'degraded' | 'failing' | 'recovering';

const STATE_COLOR: Record<NodeState, string> = {
  normal: '#30D158',
  degraded: '#FF9500',
  failing: '#FF3B30',
  recovering: '#30D158',
};

function stateAt(t: number, kind: ReplayService['kind'], index: number): NodeState {
  const cascade = 0.5 + index * 0.05;
  if (kind === 'deployment') {
    if (t < 0.15) return 'normal';
    if (t < 0.8) return 'degraded';
    return 'recovering';
  }
  if (kind === 'service') {
    if (t < 0.3) return t >= 0.15 ? 'degraded' : 'normal';
    if (t < 0.8) return 'failing';
    return 'recovering';
  }
  // downstream: staggered cascade
  if (t < cascade) return 'normal';
  if (t < cascade + 0.1) return 'degraded';
  if (t < 0.8 + index * 0.04) return 'failing';
  return 'recovering';
}

function ServiceNode({ service, index, t, position }: { service: ReplayService; index: number; t: number; position: [number, number, number] }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const state = stateAt(t, service.kind, index);

  useFrame((frame, delta) => {
    if (!mat.current || !mesh.current) return;
    const color = new THREE.Color(STATE_COLOR[state]);
    mat.current.emissive.lerp(color, Math.min(1, delta * 5));
    const pulse =
      state === 'failing' ? 0.7 + 0.5 * Math.abs(Math.sin(frame.clock.elapsedTime * 6)) :
      state === 'degraded' ? 0.5 + 0.25 * Math.abs(Math.sin(frame.clock.elapsedTime * 3)) :
      0.45;
    mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, pulse, Math.min(1, delta * 6));
    const scale = state === 'failing' ? 1.15 : 1;
    mesh.current.scale.lerp(new THREE.Vector3(scale, scale, scale), Math.min(1, delta * 6));
  });

  return (
    <group position={position}>
      <mesh ref={mesh}>
        {service.kind === 'deployment' ? <octahedronGeometry args={[1.1]} /> : <sphereGeometry args={[1, 20, 20]} />}
        <meshStandardMaterial ref={mat} color="#0B1524" emissive="#30D158" emissiveIntensity={0.45} roughness={0.4} metalness={0.5} />
      </mesh>
      <Html distanceFactor={26} position={[0, 1.9, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="glass whitespace-nowrap px-2 py-0.5 text-[10px] text-white" style={{ borderRadius: 6 }}>
          {service.label.slice(0, 28)}
          {state === 'failing' && <span className="ml-1 text-[#FF6961]">● ERR</span>}
        </div>
      </Html>
    </group>
  );
}

/** Red flare burst at explosion time (~0.65). */
function FlareBurst({ t, position }: { t: number; position: [number, number, number] }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!mesh.current) return;
    const k = (t - 0.62) / 0.15;
    const visible = k > 0 && k < 1;
    mesh.current.visible = visible;
    if (visible) {
      mesh.current.scale.setScalar(1 + k * 14);
      (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
  });
  return (
    <mesh ref={mesh} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1, 0.07, 8, 48]} />
      <meshBasicMaterial color="#FF3B30" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

const PHASE_LABELS: Array<[number, string]> = [
  [0, 'T−10m · systems nominal'],
  [0.15, 'T+0:00 · deployment lands'],
  [0.3, 'T+2:00 · primary service failing'],
  [0.5, 'T+4:00 · downstream cascade'],
  [0.65, 'T+6:00 · incident triggered'],
  [0.8, 'T+8:00 · rollback — recovering'],
];

export function ReplayScene({ services }: { services: ReplayService[] }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const tRef = useRef(0);
  tRef.current = t;

  const positions = useMemo(() => {
    const out = new Map<string, [number, number, number]>();
    const deployment = services.find((s) => s.kind === 'deployment');
    const primary = services.find((s) => s.kind === 'service');
    const downstream = services.filter((s) => s.kind === 'downstream');
    if (deployment) out.set(deployment.id, [-8, 3, 0]);
    if (primary) out.set(primary.id, [0, 0, 0]);
    downstream.forEach((s, i) => {
      const angle = (i / Math.max(1, downstream.length)) * Math.PI - Math.PI / 2;
      out.set(s.id, [6 + Math.cos(angle) * 5, Math.sin(angle) * 4, Math.sin(angle * 2) * 2]);
    });
    return out;
  }, [services]);

  const primaryPos = useMemo((): [number, number, number] => {
    const primary = services.find((s) => s.kind === 'service');
    return primary ? (positions.get(primary.id) ?? [0, 0, 0]) : [0, 0, 0];
  }, [services, positions]);

  const phase = [...PHASE_LABELS].reverse().find(([at]) => t >= at)?.[1] ?? PHASE_LABELS[0]![1];

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 6, 26], fov: 50 }}
        dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.25} />
        <pointLight position={[0, 20, 10]} intensity={400} color="#38AAFF" />
        <ReplayClock playing={playing} onTick={(next) => setT(next)} tRef={tRef} />
        {services.map((s, i) => {
          const pos = positions.get(s.id);
          if (!pos) return null;
          return <ServiceNode key={s.id} service={s} index={i} t={t} position={pos} />;
        })}
        <FlareBurst t={t} position={primaryPos} />
        <OrbitControls minDistance={10} maxDistance={60} enablePan={false} />
      </Canvas>

      {/* Transport controls */}
      <div className="glass absolute inset-x-3 bottom-3 flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => { playSound('click'); setPlaying((p) => !p); }}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          className="grid h-7 w-7 place-items-center rounded-lg border border-arc-400/40 bg-arc-500/10 text-arc-300 hover:bg-arc-500/20"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => { setT(0); setPlaying(true); }}
          aria-label="Restart replay"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => { setPlaying(false); setT((v) => Math.min(1, v + 0.02)); }}
          aria-label="Step forward"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <StepForward className="h-3.5 w-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(t * 1000)}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }}
          aria-label="Replay position"
          className="min-w-0 flex-1 accent-[#0D8BFF]"
        />
        <span className="w-44 flex-shrink-0 text-right font-mono text-[10px] text-arc-300">{phase}</span>
      </div>
    </div>
  );
}

/** Advances the replay clock inside the R3F loop (~24s full sweep). */
function ReplayClock({ playing, onTick, tRef }: { playing: boolean; onTick: (t: number) => void; tRef: React.RefObject<number> }) {
  useFrame((_, delta) => {
    if (!playing) return;
    const next = Math.min(1, (tRef.current ?? 0) + delta / 24);
    if (next !== tRef.current) onTick(next);
  });
  return null;
}
