'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Info } from 'lucide-react';
import type { GraphNode, GraphEdge } from '@/server/graph';
import { ASTNode, NODE_COLORS, type NodeType } from '@/app/app/map/components/ast-node';
import { NodeDetailPanel } from '@/app/app/map/components/node-detail-panel';
import { Badge } from '@/components/ui/badge';

/**
 * 2D React Flow fallback for the Architecture Map (plan U7f): used when
 * WebGL is unavailable or prefers-reduced-motion is set. This is the
 * previous map implementation, preserved verbatim in behavior.
 */

const nodeTypes = { astNode: ASTNode };
const LEGEND: NodeType[] = ['file', 'class', 'function', 'method', 'interface'];

function MapContent() {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [blast, setBlast] = useState<{ origin: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    fetch('/api/v1/graph')
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }));
  }, []);

  const activateBlast = useCallback(async (nodeId: string) => {
    try {
      const res = await fetch(`/api/v1/blast-radius?nodeId=${nodeId}`);
      const { affectedIds } = (await res.json()) as { affectedIds: string[] };
      setBlast({ origin: nodeId, ids: new Set(affectedIds) });
    } catch {
      setBlast({ origin: nodeId, ids: new Set() });
    }
  }, []);

  const clearBlast = useCallback(() => {
    setBlast(null);
    setSelected(null);
  }, []);

  const rfNodes: Node[] = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.map((n) => {
      const inBlast = blast?.ids.has(n.id);
      const isOrigin = blast?.origin === n.id;
      return {
        id: n.id,
        type: 'astNode',
        position: n.position,
        data: {
          nodeType: n.nodeType,
          name: n.name,
          complexity: n.complexity,
          dimmed: blast ? !inBlast && !isOrigin : false,
          highlight: !!inBlast,
          isOrigin: !!isOrigin,
        },
      };
    });
  }, [graph, blast]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((e) => {
      const active = blast && (blast.ids.has(e.source) || blast.origin === e.source) && (blast.ids.has(e.target) || blast.origin === e.target);
      const isCall = e.edgeType === 'CALLS' || e.edgeType === 'USAGE' || e.edgeType === 'IMPLEMENTS';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.edgeType,
        animated: Boolean(active && isCall),
        labelStyle: { fontSize: 9, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.85 },
        style: {
          stroke: active ? '#0D8BFF' : 'var(--border-strong)',
          strokeWidth: active ? 2 : 1,
          opacity: blast && !active ? 0.2 : 1,
        },
      };
    });
  }, [graph, blast]);

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading architecture graph…
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-arc-500/15 text-arc-400">
          <Info className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">No architecture indexed yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Connect and index a repository to build its AST dependency graph.</p>
        <a href="/app/repos" className="mt-1 rounded-lg bg-arc-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-arc-400">
          Go to Repositories
        </a>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          const g = graph.nodes.find((n) => n.id === node.id) ?? null;
          setSelected(g);
          void activateBlast(node.id);
        }}
        onPaneClick={clearBlast}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} size={1} />
        <Controls className="!border-border [&_button]:!border-border [&_button]:!bg-surface [&_button]:!fill-foreground" />
        <MiniMap
          pannable
          zoomable
          className="!bg-surface-raised"
          maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
          nodeColor={(n) => NODE_COLORS[(n.data?.nodeType as NodeType) ?? 'file']?.border ?? '#888'}
        />
      </ReactFlow>

      <div className="pointer-events-none absolute bottom-4 left-20 z-10 flex flex-wrap gap-2 rounded-xl border border-border bg-surface/80 p-2.5 backdrop-blur">
        {LEGEND.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NODE_COLORS[t].border }} /> {t}
          </span>
        ))}
      </div>

      <AnimatePresence>
        {blast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass absolute left-20 top-20 z-10 p-3 text-xs"
          >
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <Info className="h-3.5 w-3.5 text-arc-400" /> Blast radius active
            </div>
            <div className="text-muted-foreground">
              <Badge tone="brand" className="mr-1">{blast.ids.size}</Badge> downstream node{blast.ids.size === 1 ? '' : 's'} affected
            </div>
            <button onClick={clearBlast} className="mt-2 text-arc-400 hover:underline">Clear</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{selected && <NodeDetailPanel node={selected} affectedCount={blast?.ids.size ?? 0} onClose={clearBlast} />}</AnimatePresence>
    </div>
  );
}

export function Map2D() {
  return (
    <ReactFlowProvider>
      <MapContent />
    </ReactFlowProvider>
  );
}
