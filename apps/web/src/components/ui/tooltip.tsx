'use client';

import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Glass tooltip with spring scale-in (plan §17.1). Side: right (nav rail) or top. */
export function Tooltip({
  content,
  side = 'top',
  children,
  className,
}: {
  content: string;
  side?: 'top' | 'right';
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.9, ...(side === 'right' ? { x: -4 } : { y: 4 }) }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={cn(
              'glass pointer-events-none absolute z-[60] whitespace-nowrap px-2.5 py-1.5 text-[11px] font-medium text-foreground !rounded-lg',
              side === 'right' ? 'left-full top-1/2 ml-2.5 -translate-y-1/2' : 'bottom-full left-1/2 mb-2 -translate-x-1/2',
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
