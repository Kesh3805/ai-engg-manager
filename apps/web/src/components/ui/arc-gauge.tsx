'use client';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ArcGaugeProps {
  value: number; // 0-100
  label: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function ArcGauge({ value, label, size = 160, strokeWidth = 8, className }: ArcGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  // Arc goes from -120deg to +120deg (240deg total, or 2/3 of a circle)
  const arcLength = circumference * (240 / 360);
  const strokeDashoffset = arcLength - (value / 100) * arcLength;

  // Color gradient based on value
  const getColor = (v: number) => {
    if (v < 50) return '#FF3B30'; // red
    if (v < 80) return '#FF9500'; // amber
    return '#30D158'; // green
  };
  const color = getColor(value);

  return (
    <div className={cn('relative flex flex-col items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[150deg]">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
          className="opacity-40"
        />
        {/* Animated fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.2, ease: [0.34, 1.56, 0.64, 1], delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute flex flex-col items-center mt-2">
        <span className="text-display-lg font-bold" style={{ color }}>{Math.round(value)}</span>
        <span className="text-panel-label mt-1">{label}</span>
      </div>
    </div>
  );
}
