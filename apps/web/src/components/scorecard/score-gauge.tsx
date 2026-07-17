'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { ArcGauge } from '@/components/ui/arc-gauge';

/**
 * Single scorecard gauge (plan §15.1): holographic arc + hoverable
 * "How calculated?" glass tooltip + explicit no-data state (null ≠ 0).
 */
export function ScoreGauge({
  value,
  label,
  how,
  source,
  sublabel,
}: {
  value: number | null;
  label: string;
  how: string;
  source: string;
  sublabel?: string | null;
}) {
  const [showHow, setShowHow] = useState(false);

  return (
    <div className="relative flex flex-col items-center" onMouseEnter={() => setShowHow(true)} onMouseLeave={() => setShowHow(false)}>
      {value === null ? (
        <div className="flex h-[200px] w-[200px] flex-col items-center justify-center rounded-full border border-dashed border-[var(--border-strong)]/50">
          <span className="text-display-lg text-muted-foreground/50">—</span>
          <span className="text-panel-label mt-1">{label}</span>
          <span className="mt-1 max-w-[140px] text-center text-[10px] text-muted-foreground/70">no data yet</span>
        </div>
      ) : (
        <ArcGauge value={value} label={label} size={200} strokeWidth={10} />
      )}
      {sublabel && <span className="mt-1 font-mono text-[10px] text-arc-300">{sublabel}</span>}

      <AnimatePresence>
        {showHow && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
            className="glass pointer-events-none absolute -bottom-2 z-20 w-64 translate-y-full p-3 text-left"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <HelpCircle className="h-3 w-3 text-arc-400" /> How calculated?
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{how}</p>
            <p className="mt-1.5 font-mono text-[10px] text-arc-300">source: {source}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
