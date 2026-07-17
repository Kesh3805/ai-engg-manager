'use client';
import { cn } from '@/lib/utils';
import { StatusDot } from './status-dot';

interface DataReadoutProps {
  label: string;
  value: string | number;
  status?: 'green' | 'amber' | 'red' | 'arc' | 'plasma';
  className?: string;
}

export function DataReadout({ label, value, status, className }: DataReadoutProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-panel-label">{label}</span>
      <div className="flex items-center gap-2">
        {status && <StatusDot color={status} size="sm" />}
        <span className="text-display-lg text-foreground tracking-tight">{value}</span>
      </div>
    </div>
  );
}
