'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, ScrollText, Search, Sparkles } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdrRow {
  id: string;
  number: number | null;
  title: string | null;
  status: string | null;
  content: string | null;
  decidedAt: string | null;
  authors: string[] | null;
  repoFullName: string | null;
  similarity?: number;
}

// Plan §16 badge semantics: accepted=green, deprecated=amber,
// proposed=arc pulse, superseded=muted + strikethrough title.
const STATUS_TONE: Record<string, 'green' | 'amber' | 'brand' | 'neutral'> = {
  accepted: 'green',
  proposed: 'brand',
  deprecated: 'amber',
  superseded: 'neutral',
};

export default function AdrsPage() {
  const router = useRouter();
  const [adrs, setAdrs] = useState<AdrRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'semantic'>('list');
  const [selected, setSelected] = useState<AdrRow | null>(null);
  const [searching, setSearching] = useState(false);

  const load = (q?: string) => {
    setSearching(true);
    fetch(`/api/v1/adrs${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => r.json())
      .then((d) => {
        setAdrs(d.adrs ?? []);
        setMode(d.mode ?? 'list');
      })
      .catch(() => setAdrs([]))
      .finally(() => setSearching(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (!adrs) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading ADRs...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-4 p-6">
        <motion.div variants={STAGGER_ITEM} className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <ScrollText className="h-5 w-5 text-brand-400" /> Architecture Decision Records
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ingested from docs/adr, docs/decisions and rfcs on every merge to the default branch.
            </p>
          </div>
        </motion.div>

        <motion.form
          variants={STAGGER_ITEM}
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load(query || undefined);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Semantic search — e.g. 'why did we choose Kafka over SQS?'"
              className="glass w-full py-2 pl-9 pr-3 text-sm outline-none focus:border-arc-400/70"
            />
          </div>
          <Button type="submit" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
        </motion.form>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <motion.div variants={STAGGER_ITEM} className="space-y-2 lg:col-span-2">
            {adrs.length > 0 ? (
              adrs.map((adr) => (
                <button
                  key={adr.id}
                  onClick={() => setSelected(adr)}
                  className={cn(
                    'glass w-full px-4 py-3 text-left transition-all hover:border-arc-400/50',
                    selected?.id === adr.id && 'border-arc-400 shadow-[0_0_16px_rgba(13,139,255,0.15)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">ADR-{adr.number ?? '?'}</span>
                    <Badge tone={STATUS_TONE[adr.status ?? ''] ?? 'neutral'}>{adr.status ?? 'unknown'}</Badge>
                    {mode === 'semantic' && adr.similarity !== undefined && (
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                        {(adr.similarity * 100).toFixed(0)}% match
                      </span>
                    )}
                  </div>
                  <div className={`mt-1 truncate text-sm font-medium ${adr.status === 'superseded' ? 'line-through text-muted-foreground' : ''}`}>{adr.title ?? 'Untitled'}</div>
                  <div className="text-xs text-muted-foreground">{adr.repoFullName}</div>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
                No ADRs ingested yet
              </div>
            )}
          </motion.div>

          <motion.div variants={STAGGER_ITEM} className="lg:col-span-3">
            {selected ? (
              <div className="glass">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">
                    ADR-{selected.number ?? '?'} · {selected.title}
                  </h3>
                  <Button
                    className="ml-auto"
                    onClick={() =>
                      router.push(
                        '/app/chat?q=' +
                          encodeURIComponent(`Explain ADR-${selected.number ?? ''} "${selected.title ?? ''}" and how it affects the current architecture.`),
                      )
                    }
                  >
                    <Sparkles className="h-4 w-4" /> Ask AI
                  </Button>
                </div>
                <div className="prose prose-sm prose-invert max-w-none p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content ?? ''}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Select an ADR to read it
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
