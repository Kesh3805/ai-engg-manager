'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AiOrb, type OrbState } from './3d/ai-orb';
import { GlassPanel } from './ui/glass-panel';
import { motion, AnimatePresence } from 'framer-motion';

export function AiOrbDock() {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  // The chat page owns the bottom edge (input bar) — the dock yields to it.
  if (pathname.startsWith('/app/chat')) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2">
      {/* The Orb itself */}
      <div 
        className="pointer-events-auto cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={() => setOrbState('thinking')}
        onMouseLeave={() => setOrbState('idle')}
      >
        <AiOrb state={orbState} size={70} />
      </div>

      {/* Status Strip */}
      <GlassPanel variant="heavy" className="px-4 py-1.5 rounded-full pointer-events-auto flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${orbState === 'idle' ? 'bg-arc-400' : orbState === 'thinking' ? 'bg-plasma-400' : orbState === 'responding' ? 'bg-cyan-400' : 'bg-signal-red'}`} />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            {orbState}
          </span>
        </div>
        <div className="w-px h-3 bg-border" />
        <span className="text-xs font-mono text-muted-foreground">
          Last query: 2m ago
        </span>
      </GlassPanel>

      {/* Expanded Chat (Mock for now) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: -100, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="absolute bottom-full mb-4 w-[600px] pointer-events-auto origin-bottom"
          >
            <GlassPanel variant="heavy" className="h-[400px] p-4 flex flex-col">
              <div className="flex-1 overflow-y-auto prose-chat">
                <p className="text-muted-foreground">F.R.I.D.A.Y. online. How can I assist?</p>
              </div>
              <div className="mt-4">
                <input 
                  type="text" 
                  className="w-full bg-surface-raised border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-arc-400 focus:ring-1 focus:ring-arc-400"
                  placeholder="Ask the graph..."
                />
              </div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
