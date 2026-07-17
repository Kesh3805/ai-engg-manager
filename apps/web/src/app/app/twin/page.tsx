'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Boxes, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { use3dEnabled, type GalaxyNode, type GalaxyEdge } from '@/components/3d/galaxy-scene';
import { playSound } from '@/lib/sound';

const GalaxyScene = dynamic(() => import('@/components/3d/galaxy-scene').then((m) => m.GalaxyScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Assembling twin…
    </div>
  ),
});

/**
 * Digital Twin (plan §12): the org's cross-domain EKG as a galaxy — repos,
 * people, PRs, deployments, incidents, ADRs. Search flies the camera to the
 * matching node; click opens a detail panel.
 */

interface TwinPayload {
  nodes: Array<{ id: string; label: string; kind: GalaxyNode['kind']; severity?: string; status?: string; state?: string }>;
  edges: GalaxyEdge[];
  cap: number;
}

const KIND_BADGE: Record<string, 'arc' | 'green' | 'plasma' | 'amber' | 'red'> = {
  repo: 'arc',
  user: 'green',
  pr: 'plasma',
  deployment: 'amber',
  incident: 'red',
  adr: 'arc',
};

export default function TwinPage() {
  const enabled3d = use3dEnabled();
  const [data, setData] = useState<TwinPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/v1/twin')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [], cap: 500 }));
  }, []);

  const nodes: GalaxyNode[] = useMemo(
    () => (data?.nodes ?? []).map((n) => ({ id: n.id, label: n.label, kind: n.kind, severity: n.severity, status: n.status ?? n.state })),
    [data],
  );
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);

  const search = (q: string) => {
    setQuery(q);
    if (q.length < 2) return;
    const match = nodes.find((n) => n.label.toLowerCase().includes(q.toLowerCase()));
    if (match) {
      playSound('nodeSelect');
      setSelected(match.id); // CameraRig flies to it
    }
  };

  if (!data || enabled3d === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading digital twin…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {enabled3d ? (
        <GalaxyScene nodes={nodes} edges={data.edges} selectedId={selected} onSelect={setSelected} autoRotate />
      ) : (
        <div className="h-full overflow-y-auto px-24 py-24">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-3">
            {nodes.slice(0, 60).map((n) => (
              <button key={n.id} onClick={() => setSelected(n.id)} className="glass p-3 text-left transition-colors hover:border-arc-400/50">
                <Badge variant={KIND_BADGE[n.kind] ?? 'arc'}>{n.kind}</Badge>
                <div className="mt-1 truncate text-sm">{n.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header + search */}
      <div className="pointer-events-none absolute left-24 top-20 z-20">
        <h1 className="font-display flex items-center gap-2 text-display-lg">
          <Boxes className="h-6 w-6 text-arc-400" /> Digital Twin
        </h1>
        <p className="text-panel-label mt-0.5">
          {nodes.length} knowledge-graph nodes (cap {data.cap})
        </p>
        <div className="glass pointer-events-auto mt-3 flex w-72 items-center gap-2 px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Fly to a node…"
            aria-label="Search twin nodes"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-3 flex gap-3 text-[10px] text-muted-foreground">
          {(['repo', 'user', 'pr', 'deployment', 'incident', 'adr'] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: { repo: '#0D8BFF', user: '#30D158', pr: '#A855F7', deployment: '#FF9500', incident: '#FF3B30', adr: '#22D3EE' }[kind],
                }}
              />
              {kind}
            </span>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="glass glass-heavy absolute right-6 top-1/2 z-30 w-72 -translate-y-1/2 p-4"
          >
            <div className="flex items-start justify-between">
              <Badge variant={KIND_BADGE[selectedNode.kind] ?? 'arc'}>{selectedNode.kind}</Badge>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <h3 className="font-display mt-2 break-words text-base font-semibold">{selectedNode.label}</h3>
            {selectedNode.status && <p className="mt-1 font-mono text-[11px] text-arc-300">status: {selectedNode.status}</p>}
            {selectedNode.severity && <p className="mt-1 font-mono text-[11px] text-signal-red">severity: {selectedNode.severity}</p>}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Edges into this node light up in the scene. Click empty space to release the camera.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
