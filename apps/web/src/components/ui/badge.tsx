import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        arc: 'border-arc-400/30 bg-arc-500/10 text-arc-300 shadow-[0_0_10px_rgba(13,139,255,0.2)]',
        plasma: 'border-plasma-400/30 bg-plasma-500/10 text-plasma-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]',
        green: 'border-signal-green/30 bg-signal-green/10 text-signal-green',
        red: 'border-signal-red/30 bg-signal-red/10 text-signal-red',
        amber: 'border-signal-amber/30 bg-signal-amber/10 text-signal-amber',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

/** Legacy `tone` prop (pre-spatial pages) mapped onto the cva variants. */
const TONE_TO_VARIANT: Record<string, BadgeVariant> = {
  neutral: 'outline',
  brand: 'arc',
  plasma: 'plasma',
  green: 'green',
  amber: 'amber',
  red: 'red',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  tone?: 'neutral' | 'brand' | 'plasma' | 'green' | 'amber' | 'red';
}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  const resolved = variant ?? (tone ? TONE_TO_VARIANT[tone] : undefined);
  return <div className={cn(badgeVariants({ variant: resolved }), className)} {...props} />;
}

export { Badge, badgeVariants };
