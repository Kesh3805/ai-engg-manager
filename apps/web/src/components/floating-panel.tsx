'use client';
import { ReactNode, useEffect, useRef } from 'react';
import { motion, useMotionValue, type MotionValue } from 'framer-motion';
import { X } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/utils';
import { playSound } from '@/lib/sound';

const STORAGE_PREFIX = 'panel-pos:';

interface StoredPosition {
  x: number;
  y: number;
}

function readStoredPosition(id: string): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as StoredPosition).x === 'number' &&
      typeof (parsed as StoredPosition).y === 'number'
    ) {
      return parsed as StoredPosition;
    }
  } catch {
    /* unreadable or disabled storage — fall back to the anchor position */
  }
  return null;
}

interface FloatingPanelProps {
  /** Stable key for persisting this panel's dragged position. */
  id: string;
  children: ReactNode;
  /** Anchor utilities (e.g. "right-6 top-20 w-72"); drag offsets apply on top. */
  className?: string;
  variant?: 'base' | 'heavy' | 'arc' | 'plasma';
  onClose?: () => void;
  /** Container to constrain dragging within. Defaults to the viewport. */
  constraintsRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Generic draggable glass panel (plan §15). Wraps GlassPanel in a drag layer so
 * the panel's entrance variants (which animate `y`) don't fight the drag offset.
 * Position survives reloads via localStorage, clamped back into view on mount so
 * a panel saved on a larger display can't strand itself offscreen.
 */
export function FloatingPanel({
  id,
  children,
  className,
  variant = 'base',
  onClose,
  constraintsRef,
}: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x: MotionValue<number> = useMotionValue(0);
  const y: MotionValue<number> = useMotionValue(0);

  // Restore after mount: reading storage during render would desync hydration.
  useEffect(() => {
    const stored = readStoredPosition(id);
    if (!stored) return;

    const el = ref.current;
    if (!el) return;

    // rect already includes any offset, so subtract it to get the anchor origin.
    const rect = el.getBoundingClientRect();
    const anchorLeft = rect.left - x.get();
    const anchorTop = rect.top - y.get();

    const maxX = window.innerWidth - rect.width - anchorLeft;
    const minX = -anchorLeft;
    const maxY = window.innerHeight - rect.height - anchorTop;
    const minY = -anchorTop;

    x.set(Math.min(Math.max(stored.x, minX), maxX));
    y.set(Math.min(Math.max(stored.y, minY), maxY));
  }, [id, x, y]);

  const persist = () => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ x: x.get(), y: y.get() }));
    } catch {
      /* storage full or disabled — dragging still works for this session */
    }
  };

  return (
    <motion.div
      ref={ref}
      drag
      dragMomentum={false}
      dragConstraints={constraintsRef}
      onDragEnd={persist}
      style={{ x, y }}
      className={cn('pointer-events-auto absolute cursor-grab active:cursor-grabbing', className)}
    >
      <GlassPanel variant={variant} noHover className="relative p-3">
        {onClose && (
          <button
            onClick={() => {
              playSound('click');
              onClose();
            }}
            aria-label="Close panel"
            className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-md text-muted-foreground hover:bg-surface-overlay hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {children}
      </GlassPanel>
    </motion.div>
  );
}
