'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2, History } from 'lucide-react';
import { TimeScrubber, type CommitTick } from '@/components/timeline/time-scrubber';
import { ParticleField } from '@/components/3d/particle-field';
import { forceLayout3d } from '@/components/3d/force-layout';
import { use3dEnabled } from '@/components/3d/galaxy-scene';
import { GlassPanel } from '@/components/ui/glass-panel';

/**
 * Architecture Timeline (plan §13): scrub a year of history; the 3D graph
 * morphs — entities that exist at the scrubbed instant scale in, the rest
 * scale out. Layout is computed once over the union so nodes never jump.
 */

interface TimelineNodeData {
  id: string;
  nodeType: string;
  name: string;
  filePath: string;
}

interface TimelinePayload {
  repo: { id: string; fullName: string } | null;
  anchorCommit: { sha: string; committedAt: string; message: string | null } | null;
  nodes: TimelineNodeData[];
  edges: Array<{ id: string; source: string; target: string; edgeType: string }>;
}

const TYPE_COLOR: Record<string, string> = {
  file: '#0D8BFF',
  class: '#A855F7',
  function: '#22D3EE',
  interface: '#30D158',
  method: '#38AAFF',
  enum: '#FF9500',
};

function MorphNode({ position, color, present }: { position: [number, number, number]; color: string; present: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    const target = present ? 1 : 0.001;
    mesh.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, delta * 6));
    mesh.current.visible = mesh.current.scale.x > 0.01;
  });
  return (
    <mesh ref={mesh} position={position} scale={0.001}>
      <sphereGeometry args={[0.7, 14, 14]} />
      <meshStandardMaterial color="#0B1524" emissive={color} emissiveIntensity={0.45} />
    </mesh>
  );
}

const DAY_MS = 24 * 3600 * 1000;
const RANGE_MS = 365 * DAY_MS;

export default function TimelinePage() {
  const enabled3d = use3dEnabled();
  const [repos, setRepos] = useState<Array<{ id: string; fullName: string }>>([]);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [valueMs, setValueMs] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState<TimelinePayload | null>(null);
  const [union, setUnion] = useState<Map<string, TimelineNodeData>>(new Map());
  const [unionEdges, setUnionEdges] = useState<Map<string, { id: string; source: string; target: string; edgeType: string }>>(new Map());
  const [ticks, setTicks] = useState<CommitTick[]>([]);
  const [loading, setLoading] = useState(false);

  const endMs = useMemo(() => Date.now(), []);
  const startMs = endMs - RANGE_MS;

  useEffect(() => {
    fetch('/api/v1/repos')
      .then((r) => r.json())
      .then((d) => {
        const indexed = (d.repos ?? []).filter((r: { id: string }) => !String(r.id).startsWith('gh:'));
        setRepos(indexed);
        if (indexed[0]) setRepoId(indexed[0].id);
      })
      .catch(() => setRepos([]));
  }, []);

  const load = useCallback(
    (at: number) => {
      if (!repoId) return;
      setLoading(true);
      fetch(`/api/v1/timeline?repoId=${repoId}&at=${new Date(at).toISOString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: TimelinePayload) => {
          setSnapshot(d);
          // Grow the union so departed nodes can morph out instead of vanish.
          setUnion((prev) => {
            const next = new Map(prev);
            for (const n of d.nodes) next.set(n.id, n);
            return next;
          });
          setUnionEdges((prev) => {
            const next = new Map(prev);
            for (const e of d.edges) next.set(e.id, e);
            return next;
          });
          if (d.anchorCommit) {
            const atMs = new Date(d.anchorCommit.committedAt).getTime();
            setTicks((prev) =>
              prev.some((t) => t.atMs === atMs) ? prev : [...prev, { atMs, message: d.anchorCommit!.message ?? d.anchorCommit!.sha.slice(0, 8) }].sort((a, b) => a.atMs - b.atMs),
            );
          }
        })
        .catch(() => setSnapshot(null))
        .finally(() => setLoading(false));
    },
    [repoId],
  );

  // Reset accumulated state when switching repos, then load.
  useEffect(() => {
    setUnion(new Map());
    setUnionEdges(new Map());
    setTicks([]);
    setSnapshot(null);
    if (repoId) load(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  // Debounced load while scrubbing.
  useEffect(() => {
    const t = setTimeout(() => load(valueMs), 220);
    return () => clearTimeout(t);
  }, [valueMs, load]);

  const unionNodes = useMemo(() => [...union.values()], [union]);
  const presentIds = useMemo(() => new Set((snapshot?.nodes ?? []).map((n) => n.id)), [snapshot]);
  const positions = useMemo(
    () =>
      forceLayout3d({
        nodes: unionNodes.map((n) => ({ id: n.id, group: n.filePath })),
        edges: [...unionEdges.values()].map((e) => ({ source: e.source, target: e.target })),
      }),
    [unionNodes, unionEdges],
  );

  return (
    <div className="relative h-full w-full">
      {/* Scene */}
      <div className="absolute inset-0">
        {enabled3d === false ? (
          <div className="flex h-full items-center justify-center px-24 text-center text-sm text-muted-foreground">
            {snapshot ? `${snapshot.nodes.length} entities existed at ${new Date(valueMs).toLocaleDateString()}` : 'Scrub the timeline to inspect history.'}
          </div>
        ) : enabled3d === null ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading timeline…
          </div>
        ) : (
          <Canvas
            camera={{ position: [0, 16, 80], fov: 55 }}
            dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
            gl={{ antialias: true, alpha: true }}
          >
            <fog attach="fog" args={['#05070A', 80, 200]} />
            <ambientLight intensity={0.18} />
            <pointLight position={[0, 30, 20]} intensity={600} color="#38AAFF" />
            <ParticleField count={900} radius={100} size={0.08} />
            {unionNodes.map((n) => {
              const pos = positions.get(n.id);
              if (!pos) return null;
              return <MorphNode key={n.id} position={pos} color={TYPE_COLOR[n.nodeType] ?? '#38AAFF'} present={presentIds.has(n.id)} />;
            })}
            <OrbitControls minDistance={15} maxDistance={160} />
          </Canvas>
        )}
      </div>

      {/* Header */}
      <div className="pointer-events-none absolute left-24 top-20 z-20">
        <h1 className="font-display flex items-center gap-2 text-display-lg">
          <History className="h-6 w-6 text-arc-400" /> Timeline
        </h1>
        <p className="text-panel-label mt-0.5">
          {snapshot?.anchorCommit
            ? `anchored @ ${snapshot.anchorCommit.sha.slice(0, 8)} — "${(snapshot.anchorCommit.message ?? '').slice(0, 50)}"`
            : 'entity membership over the last year'}
          {loading && ' · loading…'}
        </p>
        {repos.length > 1 && (
          <select
            value={repoId ?? ''}
            onChange={(e) => setRepoId(e.target.value)}
            className="glass pointer-events-auto mt-2 px-3 py-1.5 text-sm outline-none"
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.fullName}</option>
            ))}
          </select>
        )}
      </div>

      {/* Scrubber — top-center floating (plan §13.1) */}
      <div className="absolute left-1/2 top-20 z-20 w-[min(680px,60vw)] -translate-x-1/2">
        <GlassPanel noHover className="px-4 py-2">
          <TimeScrubber startMs={startMs} endMs={endMs} valueMs={valueMs} ticks={ticks} onChange={setValueMs} />
        </GlassPanel>
      </div>
    </div>
  );
}
