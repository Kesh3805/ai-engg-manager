'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Info } from 'lucide-react';
import type { GraphNode, GraphEdge } from '@/server/graph';
import { AstNode3D } from '@/components/3d/ast-node-3d';
import { AstEdge3D } from '@/components/3d/ast-edge-3d';
import { BlastShockwave } from '@/components/3d/blast-shockwave';
import { CameraRig } from '@/components/3d/camera-rig';
import { ParticleField } from '@/components/3d/particle-field';
import { forceLayout3d } from '@/components/3d/force-layout';
import { use3dEnabled } from '@/components/3d/galaxy-scene';
import { NodeDetailPanel } from './components/node-detail-panel';
import { Badge } from '@/components/ui/badge';
import { playSound } from '@/lib/sound';

const Map2D = dynamic(() => import('@/components/map/map-2d').then((m) => m.Map2D), { ssr: false });

/**
 * Architecture Map — 3D force-directed graph (plan §10). Falls back to the
 * preserved React Flow implementation when WebGL/motion are unavailable.
 */

interface BlastState {
  origin: string;
  ids: Set<string>;
  depthOf: Record<string, number>;
  wave: number; // shockwave remount key
}

const LEGEND: Array<[string, string]> = [
  ['file', '#0D8BFF'],
  ['class', '#A855F7'],
  ['function', '#22D3EE'],
  ['interface', '#30D158'],
  ['method', '#38AAFF'],
];

export default function ArchitectureMapPage() {
  const enabled3d = use3dEnabled();
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hotspotPaths, setHotspotPaths] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [blast, setBlast] = useState<BlastState | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    fetch('/api/v1/graph')
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }));
    fetch('/api/v1/hotspots')
      .then((r) => r.json())
      .then((d) => setHotspotPaths(new Set((d.hotspots ?? []).map((h: { filePath: string }) => h.filePath))))
      .catch(() => {});
  }, []);

  const positions = useMemo(() => {
    if (!graph) return new Map<string, [number, number, number]>();
    return forceLayout3d({
      nodes: graph.nodes.map((n) => ({ id: n.id, group: n.filePath })),
      edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    });
  }, [graph]);

  const activateBlast = useCallback(async (node: GraphNode) => {
    setSelected(node);
    try {
      const res = await fetch(`/api/v1/blast-radius?nodeId=${node.id}`);
      const { affectedIds, depthOf } = (await res.json()) as { affectedIds: string[]; depthOf: Record<string, number> };
      playSound('impact');
      setBlast({ origin: node.id, ids: new Set(affectedIds), depthOf, wave: Date.now() });
    } catch {
      setBlast({ origin: node.id, ids: new Set(), depthOf: {}, wave: Date.now() });
    }
  }, []);

  const clear = useCallback(() => {
    setBlast(null);
    setSelected(null);
  }, []);

  const postFx = useMemo(() => typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) >= 4, []);

  if (enabled3d === false) return <Map2D />;

  if (enabled3d === null || !graph) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Assembling architecture…
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-arc-500/15 text-arc-400">
          <Info className="h-6 w-6" />
        </div>
        <h2 className="font-display text-lg font-semibold">No architecture indexed yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Connect and index a repository to build its AST dependency graph.</p>
        <a href="/app/repos" className="mt-1 rounded-lg bg-arc-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-arc-400">
          Go to Repositories
        </a>
      </div>
    );
  }

  const originPos = blast ? positions.get(blast.origin) : null;
  const focusPos = selected ? (positions.get(selected.id) ?? null) : null;

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 20, 90], fov: 50 }}
        dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={clear}
      >
        <fog attach="fog" args={['#05070A', 90, 220]} />
        <ambientLight intensity={0.18} />
        <pointLight position={[0, 40, 20]} intensity={800} color="#38AAFF" />
        <pointLight position={[-30, -20, -30]} intensity={300} color="#A855F7" />
        <ParticleField count={1200} radius={110} size={0.09} />

        {graph.nodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const inBlast = blast?.ids.has(n.id) ?? false;
          const isOrigin = blast?.origin === n.id;
          return (
            <AstNode3D
              key={n.id}
              node={n}
              position={pos}
              dimmed={Boolean(blast) && !inBlast && !isOrigin}
              highlighted={inBlast}
              isOrigin={isOrigin}
              isHotspot={n.nodeType === 'file' && hotspotPaths.has(n.filePath)}
              flashDelayMs={300 + (blast?.depthOf[n.id] ?? 1) * 150}
              onSelect={(id) => {
                const g = graph.nodes.find((x) => x.id === id) ?? null;
                if (g) void activateBlast(g);
              }}
            />
          );
        })}

        {graph.edges.map((e) => {
          const from = positions.get(e.source);
          const to = positions.get(e.target);
          if (!from || !to) return null;
          const active = Boolean(
            blast &&
              (blast.ids.has(e.source) || blast.origin === e.source) &&
              (blast.ids.has(e.target) || blast.origin === e.target),
          );
          return <AstEdge3D key={e.id} from={from} to={to} edgeType={e.edgeType} blastMode={Boolean(blast)} blastActive={active} />;
        })}

        {blast && originPos && <BlastShockwave key={blast.wave} position={originPos} />}

        <CameraRig focus={focusPos} controlsRef={controlsRef} distance={22} />
        <OrbitControls ref={controlsRef} minDistance={12} maxDistance={180} />

        {postFx && (
          <EffectComposer>
            <Bloom luminanceThreshold={0.3} intensity={0.8} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>

      {/* Legend */}
      <div className="glass pointer-events-none absolute bottom-4 left-20 z-10 flex flex-wrap gap-2.5 px-3 py-2">
        {LEGEND.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} /> {label}
          </span>
        ))}
      </div>

      {/* Blast banner */}
      {blast && (
        <div className="glass absolute left-20 top-20 z-10 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Info className="h-3.5 w-3.5 text-arc-400" /> Blast radius active
          </div>
          <div className="text-muted-foreground">
            <Badge tone="brand" className="mr-1">{blast.ids.size}</Badge>
            downstream node{blast.ids.size === 1 ? '' : 's'} affected
          </div>
          <button onClick={clear} className="mt-2 text-arc-400 hover:underline">Clear</button>
        </div>
      )}

      {/* Detail + impact panel (plan §10.4 phase 3) */}
      <AnimatePresence>
        {selected && <NodeDetailPanel node={selected} affectedCount={blast?.ids.size ?? 0} onClose={clear} />}
      </AnimatePresence>
    </div>
  );
}
