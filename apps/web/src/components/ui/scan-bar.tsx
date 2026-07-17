'use client';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { StatusDot } from './status-dot';

export type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error';

interface ScanBarProps {
  label: string;
  status: ScanStatus;
  progress?: number; // 0-100
  detail?: string;
  className?: string;
}

export function ScanBar({ label, status, progress = 0, detail, className }: ScanBarProps) {
  const isComplete = status === 'complete';
  const isScanning = status === 'scanning';
  const isError = status === 'error';

  const dotColor = isComplete ? 'green' : isError ? 'red' : isScanning ? 'arc' : 'amber';
  const barColor = isComplete ? 'bg-signal-green' : isError ? 'bg-signal-red' : 'bg-arc-400';
  const barGlow = isComplete
    ? 'shadow-[0_0_10px_rgba(48,209,88,0.4)]'
    : isError
    ? 'shadow-[0_0_10px_rgba(255,59,48,0.4)]'
    : 'shadow-[0_0_10px_rgba(13,139,255,0.4)]';

  const displayProgress = isComplete ? 100 : progress;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <StatusDot color={dotColor} size="sm" animate={isScanning} />
          <span className={cn('font-mono', isComplete ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
        </div>
        {(detail || isScanning) && (
          <span className="text-mono text-xs opacity-80">
            {detail || `${Math.round(displayProgress)}%`}
          </span>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-raised border border-border">
        <motion.div
          className={cn('h-full rounded-full', barColor, barGlow)}
          initial={{ width: 0 }}
          animate={{ width: `${displayProgress}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
