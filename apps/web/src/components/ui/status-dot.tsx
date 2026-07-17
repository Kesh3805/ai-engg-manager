'use client';
import { cn } from '@/lib/utils';

interface StatusDotProps {
  color?: 'green' | 'amber' | 'red' | 'arc' | 'plasma';
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  className?: string;
}

export function StatusDot({ color = 'green', size = 'md', animate = true, className }: StatusDotProps) {
  const colorClass = {
    green:  'bg-signal-green shadow-[0_0_8px_rgba(48,209,88,0.5)]',
    amber:  'bg-signal-amber shadow-[0_0_8px_rgba(255,149,0,0.5)]',
    red:    'bg-signal-red shadow-[0_0_8px_rgba(255,59,48,0.5)]',
    arc:    'bg-arc-400 shadow-[0_0_8px_rgba(13,139,255,0.5)]',
    plasma: 'bg-plasma-400 shadow-[0_0_8px_rgba(168,85,247,0.5)]',
  }[color];

  const sizeClass = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2.5 h-2.5',
    lg: 'w-3.5 h-3.5',
  }[size];

  return (
    <div className="relative inline-flex items-center justify-center">
      <div className={cn('rounded-full', colorClass, sizeClass, className)} />
      {animate && (
        <div
          className={cn(
            'absolute inset-0 rounded-full animate-pulse-glow',
            colorClass,
          )}
          style={{ transform: 'scale(2.5)', opacity: 0.2 }}
        />
      )}
    </div>
  );
}
