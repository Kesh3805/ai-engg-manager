'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, BrainCircuit } from 'lucide-react';
import { ScanBar, type ScanStatus } from '@/components/ui/scan-bar';
import type { RetrievedContext } from '@/lib/pipeline';

/**
 * Cognitive display (plan §11.2): pipeline phases as horizontal scan bars
 * filling in real time. Collapses to a one-line summary once complete.
 */

export interface PhaseState {
  phase: string;
  label: string;
  status: 'start' | 'done';
}

export interface ToolCall {
  name: string;
  result: unknown;
}

export interface TraceMeta {
  source: 'db';
  model: string;
}

function detailFor(phase: string, context: RetrievedContext | null, tools: ToolCall[]): string | undefined {
  if (phase === 'retrieval' && context) {
    const bits: string[] = [];
    if (context.astHits.length) bits.push(`${context.astHits.length} AST nodes`);
    if (context.adrHits?.length) bits.push(`${context.adrHits.length} ADRs`);
    if (context.textHits.length) bits.push(`${context.textHits.length} text hits`);
    return bits.join(' · ') || undefined;
  }
  if (phase === 'tools' && tools.length) {
    return tools.map((t) => t.name).join(', ');
  }
  return undefined;
}

export function CognitiveTrace({
  phases,
  tools,
  context,
  meta,
}: {
  phases: PhaseState[];
  tools: ToolCall[];
  context: RetrievedContext | null;
  meta?: TraceMeta | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const allDone = phases.length > 0 && phases.every((p) => p.status === 'done');
  const running = phases.some((p) => p.status === 'start');

  const bars = useMemo(
    () =>
      phases.map((p) => ({
        ...p,
        scanStatus: (p.status === 'done' ? 'complete' : 'scanning') as ScanStatus,
        detail: detailFor(p.phase, context, tools),
      })),
    [phases, context, tools],
  );

  if (phases.length === 0) return null;

  // Collapsed one-liner after completion (plan §11.2)
  if (allDone && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="glass mb-2 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        style={{ borderRadius: 10 }}
      >
        <BrainCircuit className="h-3.5 w-3.5 text-plasma-400" />
        <span>
          Reasoned across {context?.astHits.length ?? 0} graph nodes
          {context?.adrHits?.length ? `, ${context.adrHits.length} ADRs` : ''} · {phases.length} phases
        </span>
        {meta && <span className="ml-auto font-mono text-[10px] text-arc-300">{meta.model.split('/').pop()}</span>}
        <ChevronRight className="h-3 w-3" />
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="glass mb-2 overflow-hidden p-3"
      style={{ borderRadius: 10 }}
      aria-live="polite"
      aria-label={running ? 'AI pipeline running' : 'AI pipeline complete'}
    >
      <div className="mb-2 flex items-center gap-2">
        <BrainCircuit className={`h-3.5 w-3.5 ${running ? 'animate-pulse-glow text-arc-400' : 'text-plasma-400'}`} />
        <span className="text-panel-label">{running ? 'Cognition in progress' : 'Cognition trace'}</span>
        {meta && <span className="ml-auto font-mono text-[10px] text-arc-300">live · {meta.model.split('/').pop()}</span>}
        {allDone && (
          <button onClick={() => setExpanded(false)} className="text-[10px] text-muted-foreground hover:text-foreground">
            collapse
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {bars.map((bar) => (
          <ScanBar key={bar.phase} label={bar.label} status={bar.scanStatus} progress={bar.scanStatus === 'scanning' ? 62 : 100} detail={bar.detail} />
        ))}
      </div>

      <AnimatePresence>
        {tools.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 border-t border-[var(--glass-border)] pt-2 font-mono text-[10px]">
            {tools.map((t, i) => (
              <div key={i} className="text-signal-green">
                ✓ {t.name} <span className="text-muted-foreground">→ {JSON.stringify(t.result)}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
