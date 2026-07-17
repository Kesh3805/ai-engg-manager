'use client';

import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import { NodeChip } from '@/components/ui/node-chip';
import type { RetrievedContext } from '@/lib/pipeline';

/**
 * Referenced-nodes sidebar (plan §11.3): AST nodes the latest AI response is
 * grounded in, each chip deep-links to the Architecture Map.
 */
export function ContextNodesPanel({ context }: { context: RetrievedContext | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  const hits = context?.astHits ?? [];
  if (hits.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-40 hidden xl:block">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key="open"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className="glass pointer-events-auto w-64 p-3"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <Network className="h-3.5 w-3.5 text-arc-400" />
              <span className="text-panel-label">Referenced in response</span>
              <button onClick={() => setOpen(false)} aria-label="Collapse referenced nodes" className="ml-auto text-muted-foreground hover:text-foreground">
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col items-start gap-1.5">
              {hits.slice(0, 8).map((h, i) => (
                <NodeChip key={i} name={h.name} nodeType={h.nodeType} onClick={() => router.push('/app/map')} />
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {hits.length} node{hits.length === 1 ? '' : 's'} grounded in the Architecture Map
            </p>
          </motion.div>
        ) : (
          <motion.button
            key="closed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(true)}
            aria-label="Show referenced nodes"
            className="glass pointer-events-auto grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground"
          >
            <PanelRightOpen className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
