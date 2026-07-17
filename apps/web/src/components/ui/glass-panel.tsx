'use client';
import { ReactNode } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PANEL_ENTER, GLASS_HOVER } from '@/lib/motion';
import { useSoundEffect } from '@/lib/sound';

interface GlassPanelProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
  variant?: 'base' | 'heavy' | 'arc' | 'plasma';
  noHover?: boolean;
  className?: string;
}

export function GlassPanel({
  children,
  variant = 'base',
  noHover = false,
  className,
  ...props
}: GlassPanelProps) {
  const soundRef = useSoundEffect('hover', 'click');

  const variantClass = {
    base:   'glass',
    heavy:  'glass glass-heavy',
    arc:    'glass glass-arc',
    plasma: 'glass glass-plasma',
  }[variant];

  return (
    <motion.div
      ref={soundRef as any}
      variants={PANEL_ENTER}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={noHover ? undefined : GLASS_HOVER.whileHover}
      className={cn(variantClass, className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
