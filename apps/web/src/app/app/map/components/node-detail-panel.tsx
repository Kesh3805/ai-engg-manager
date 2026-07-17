'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, FileCode, Hash, Workflow, Zap, Loader2 } from 'lucide-react';
import type { GraphNode } from '@/server/graph';
import { Badge } from '@/components/ui/badge';

interface SimulationResult {
  affectedNodeCount: number;
  affectedTestCount: number;
  affectedDeploymentCount: number;
}

export function NodeDetailPanel({
  node,
  affectedCount,
  onClose,
}: {
  node: GraphNode;
  affectedCount: number;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="absolute right-4 top-4 z-10 w-72 rounded-xl border border-border bg-surface p-4 shadow-lg"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <Badge tone="brand" className="mb-1.5 font-mono">{node.nodeType}</Badge>
          <h3 className="text-sm font-semibold">{node.name}</h3>
        </div>
        <button onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md hover:bg-surface-overlay">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {node.signature && (
        <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-surface-raised p-2 font-mono text-[11px] text-muted-foreground">
          {node.signature}
        </pre>
      )}

      <dl className="space-y-2 text-xs">
        <Row icon={FileCode} label="File">
          <span className="font-mono">{node.filePath}</span>
        </Row>
        <Row icon={Hash} label="Lines">
          {node.lineStart}–{node.lineEnd}
        </Row>
        {node.complexity != null && (
          <Row icon={Workflow} label="Complexity">
            <Badge tone={node.complexity > 10 ? 'red' : node.complexity > 6 ? 'amber' : 'green'}>{node.complexity}</Badge>
          </Row>
        )}
      </dl>

      <div className="mt-3 rounded-lg border border-border bg-surface-raised p-2.5 text-xs">
        <span className="font-medium text-foreground">{affectedCount}</span>{' '}
        <span className="text-muted-foreground">node{affectedCount === 1 ? '' : 's'} in blast radius</span>
      </div>

      <SimulateImpact nodeId={node.id} />
    </motion.div>
  );
}

/** "Simulate Impact" (plan 4b-10): factual counts only — never effort estimates. */
function SimulateImpact({ nodeId }: { nodeId: string }) {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const simulate = () => {
    setLoading(true);
    fetch(`/api/v1/blast-radius-simulate?nodeId=${encodeURIComponent(nodeId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mt-3">
      <button
        onClick={simulate}
        disabled={loading}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-400 transition-colors hover:bg-brand-500/20 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Simulate Impact
      </button>
      {result && (
        <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center text-xs">
          {(
            [
              [result.affectedNodeCount, 'entities'],
              [result.affectedTestCount, 'tests'],
              [result.affectedDeploymentCount, 'deploys'],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className="rounded-lg bg-surface-raised px-2 py-1.5">
              <dt className="text-sm font-semibold tabular-nums text-foreground">{value}</dt>
              <dd className="text-[10px] text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}
