'use client';

import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

export function MetricCard({ label, value, delta, unit }: { label: string; value: number; delta?: number; unit?: string }) {
  const count = useMotionValue(0);
  const spring = useSpring(count, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => (Number.isInteger(value) ? Math.round(v).toString() : v.toFixed(1)));

  useEffect(() => {
    count.set(value);
  }, [value, count]);

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px oklch(0 0 0 / 0.18)' }}
      transition={{ duration: 0.2 }}
      className="cursor-default rounded-xl border border-border bg-surface p-4"
    >
      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-semibold tabular-nums">
          <motion.span>{display}</motion.span>
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {delta !== undefined && (
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-xs font-medium',
              delta >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500',
            )}
          >
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
    </motion.div>
  );
}
