'use client';

import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';

/** Clickable AST node reference chip with arc glow (plan §17.1). */
export function NodeChip({
  name,
  nodeType,
  onClick,
  className,
}: {
  name: string;
  nodeType?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        playSound('nodeSelect');
        onClick?.();
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-[var(--rim-bright)]/60 bg-[rgba(13,139,255,0.08)] px-2 py-1',
        'font-mono text-[11px] text-[#7EC8FF] transition-shadow hover:shadow-[var(--glow-arc)]',
        className,
      )}
    >
      {nodeType && <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{nodeType}</span>}
      <span className="max-w-[180px] truncate">{name}</span>
      {onClick && <ArrowUpRight className="h-3 w-3 opacity-60" />}
    </motion.button>
  );
}
