'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
export type NodeType = 'class' | 'function' | 'method' | 'interface' | 'file';

export const NODE_COLORS: Record<NodeType, { border: string }> = {
  class: { border: '#eab308' }, // yellow-500
  function: { border: '#8b5cf6' }, // violet-500
  method: { border: '#a855f7' }, // purple-500
  interface: { border: '#06b6d4' }, // cyan-500
  file: { border: '#64748b' }, // slate-500
};

export interface ASTNodeData {
  nodeType: NodeType;
  name: string;
  complexity?: number;
  dimmed?: boolean;
  highlight?: boolean;
  isOrigin?: boolean;
  [key: string]: unknown;
}

export function ASTNode({ data, selected }: NodeProps) {
  const d = data as ASTNodeData;
  const colors = NODE_COLORS[d.nodeType] ?? NODE_COLORS.file;
  const accent = colors.border;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: d.isOrigin ? 1.06 : 1,
        opacity: d.dimmed ? 0.28 : 1,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="min-w-[124px] max-w-[200px] cursor-pointer select-none rounded-xl px-3 py-2 transition-shadow"
      style={{
        background: `color-mix(in srgb, ${accent} 13%, var(--surface))`,
        border: `${selected || d.isOrigin ? 2 : 1}px solid ${d.highlight || d.isOrigin ? accent : 'var(--border)'}`,
        boxShadow: d.isOrigin
          ? `0 0 0 3px color-mix(in srgb, ${accent} 35%, transparent)`
          : d.highlight
            ? `0 0 0 2px color-mix(in srgb, ${accent} 45%, transparent)`
            : undefined,
      }}
    >
      <div className="mb-0.5 font-mono text-[10px]" style={{ color: accent }}>
        {d.nodeType}
      </div>
      <div className="truncate text-xs font-medium text-foreground">{d.name}</div>
      {d.complexity != null && (
        <div className="mt-1 text-[9px] text-muted-foreground">complexity: {d.complexity}</div>
      )}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-none" style={{ background: accent }} />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-none" style={{ background: accent }} />
    </motion.div>
  );
}
