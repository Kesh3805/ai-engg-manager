'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RepoNode } from './repo-node';
import { EkgEdge } from './ekg-edge';
import { IncidentFlare } from './incident-flare';
import { ParticleField } from './particle-field';
import { CameraRig } from './camera-rig';

/**
 * Shared R3F galaxy (plan §9 + §12): repos as planets, people as glowing
 * orbs, deployments as amber diamonds, incidents as red flares, PRs as
 * plasma orbiters, ADRs as teal slates — EKG edges as energy beams.
 *
 * Deterministic layout: nodes sit on kind-specific rings, angle from an id
 * hash, so the universe is stable across reloads without a physics engine.
 */

export interface GalaxyNode {
  id: string;
  label: string;
  kind: 'repo' | 'user' | 'pr' | 'deployment' | 'incident' | 'adr';
  status?: string;
  severity?: string;
  size?: number;
  moons?: number;
  sublabel?: string;
}

export interface GalaxyEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
}

const RING_RADIUS: Record<GalaxyNode['kind'], number> = {
  repo: 16,
  pr: 26,
  user: 34,
  adr: 40,
  deployment: 46,
  incident: 52,
};

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function layoutGalaxy(nodes: GalaxyNode[]): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const byKind = new Map<string, GalaxyNode[]>();
  for (const n of nodes) {
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  }
  for (const [kind, list] of byKind) {
    const base = RING_RADIUS[kind as GalaxyNode['kind']] ?? 30;
    list.forEach((n, i) => {
      const angle = (i / list.length) * Math.PI * 2 + hash(n.id) * 0.6;
      const r = base + (hash(n.id + 'r') - 0.5) * base * 0.35;
      const y = (hash(n.id + 'y') - 0.5) * 14;
      out.set(n.id, [Math.cos(angle) * r, y, Math.sin(angle) * r]);
    });
  }
  return out;
}

/** WebGL + motion capability probe — pages fall back to 2D lists when false. */
export function use3dEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEnabled(false);
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      setEnabled(Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl')));
    } catch {
      setEnabled(false);
    }
  }, []);
  return enabled;
}

function UserOrb({ node, position, dimmed, onSelect }: { node: GalaxyNode; position: [number, number, number]; dimmed: boolean; onSelect?: (id: string) => void }) {
  return (
    <group position={position}>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); }}>
        <sphereGeometry args={[0.9, 20, 20]} />
        <meshStandardMaterial color="#0F2A1C" emissive="#30D158" emissiveIntensity={dimmed ? 0.1 : 0.5} transparent opacity={dimmed ? 0.25 : 1} />
      </mesh>
      {!dimmed && (
        <Html distanceFactor={50} center position={[0, 0, 0]} style={{ pointerEvents: 'none' }}>
          <span className="font-display text-[10px] font-bold text-white">{node.label.slice(0, 2).toUpperCase()}</span>
        </Html>
      )}
    </group>
  );
}

function DeploymentDiamond({ node, position, dimmed, onSelect }: { node: GalaxyNode; position: [number, number, number]; dimmed: boolean; onSelect?: (id: string) => void }) {
  const failing = node.status === 'failure';
  return (
    <mesh position={position} rotation={[0.5, 0.5, 0]} onClick={(e) => { e.stopPropagation(); onSelect?.(node.id); }}>
      <octahedronGeometry args={[0.9]} />
      <meshStandardMaterial
        color={failing ? '#3A1210' : '#2A2008'}
        emissive={failing ? '#FF3B30' : '#FF9500'}
        emissiveIntensity={dimmed ? 0.1 : 0.6}
        transparent
        opacity={dimmed ? 0.25 : 1}
      />
    </mesh>
  );
}

function PrOrbiter({ position, dimmed, onSelect, id }: { position: [number, number, number]; dimmed: boolean; onSelect?: (id: string) => void; id: string }) {
  return (
    <mesh position={position} onClick={(e) => { e.stopPropagation(); onSelect?.(id); }}>
      <sphereGeometry args={[0.5, 14, 14]} />
      <meshStandardMaterial color="#1E0A33" emissive="#A855F7" emissiveIntensity={dimmed ? 0.1 : 0.5} transparent opacity={dimmed ? 0.25 : 1} />
    </mesh>
  );
}

function AdrSlate({ position, dimmed, onSelect, id }: { position: [number, number, number]; dimmed: boolean; onSelect?: (id: string) => void; id: string }) {
  return (
    <mesh position={position} rotation={[0, hash(id) * Math.PI, 0]} onClick={(e) => { e.stopPropagation(); onSelect?.(id); }}>
      <boxGeometry args={[1.2, 1.6, 0.08]} />
      <meshStandardMaterial color="#062E33" emissive="#22D3EE" emissiveIntensity={dimmed ? 0.08 : 0.35} transparent opacity={dimmed ? 0.25 : 0.95} />
    </mesh>
  );
}

export function GalaxyScene({
  nodes,
  edges,
  selectedId,
  onSelect,
  autoRotate = true,
}: {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  autoRotate?: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const positions = useMemo(() => layoutGalaxy(nodes), [nodes]);
  const postFx = useMemo(
    () => typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) >= 4,
    [],
  );

  const focus = selectedId ? (positions.get(selectedId) ?? null) : null;
  const dimTest = (id: string) => Boolean(selectedId && selectedId !== id);

  const visibleEdges = useMemo(
    () => edges.filter((e) => positions.has(e.source) && positions.has(e.target)).slice(0, 400),
    [edges, positions],
  );

  return (
    <Canvas
      camera={{ position: [0, 18, 60], fov: 60 }}
      dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => onSelect?.(null)}
    >
      <fog attach="fog" args={['#05070A', 70, 170]} />
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 30, 0]} intensity={600} color="#38AAFF" />
      <pointLight position={[40, -20, 40]} intensity={300} color="#A855F7" />

      <ParticleField count={2200} radius={85} />

      {nodes.map((node) => {
        const pos = positions.get(node.id)!;
        const dimmed = dimTest(node.id);
        switch (node.kind) {
          case 'repo':
            return <RepoNode key={node.id} node={node} position={pos} dimmed={dimmed} selected={selectedId === node.id} onSelect={(id) => onSelect?.(id)} />;
          case 'user':
            return <UserOrb key={node.id} node={node} position={pos} dimmed={dimmed} onSelect={(id) => onSelect?.(id)} />;
          case 'deployment':
            return <DeploymentDiamond key={node.id} node={node} position={pos} dimmed={dimmed} onSelect={(id) => onSelect?.(id)} />;
          case 'incident':
            return <IncidentFlare key={node.id} id={node.id} label={node.label} severity={node.severity} position={pos} onSelect={(id) => onSelect?.(id)} />;
          case 'pr':
            return <PrOrbiter key={node.id} id={node.id} position={pos} dimmed={dimmed} onSelect={(id) => onSelect?.(id)} />;
          case 'adr':
            return <AdrSlate key={node.id} id={node.id} position={pos} dimmed={dimmed} onSelect={(id) => onSelect?.(id)} />;
        }
      })}

      {visibleEdges.map((edge) => (
        <EkgEdge
          key={edge.id}
          from={positions.get(edge.source)!}
          to={positions.get(edge.target)!}
          edgeType={edge.edgeType}
          pulsing={edge.edgeType === 'CAUSED'}
          dimmed={Boolean(selectedId) && selectedId !== edge.source && selectedId !== edge.target}
        />
      ))}

      <CameraRig focus={focus} controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={20}
        maxDistance={120}
        autoRotate={autoRotate && !selectedId}
        autoRotateSpeed={0.15}
      />

      {postFx && (
        <EffectComposer>
          <Bloom luminanceThreshold={0.4} intensity={1.2} mipmapBlur />
        </EffectComposer>
      )}
    </Canvas>
  );
}
