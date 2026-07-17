'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Map as MapIcon, Database, Terminal, FileText, ArrowRight } from 'lucide-react';
import { GlassPanel } from './ui/glass-panel';
import { motion, AnimatePresence } from 'framer-motion';
import { useSoundEffect, playSound } from '@/lib/sound';
import { cn } from '@/lib/utils';

interface Result {
  id: string;
  icon: any;
  label: string;
  description: string;
  href: string;
}

/** Real, static navigation targets — every href resolves to a live route. */
const NAV_COMMANDS: Result[] = [
  { id: 'nav-chat', icon: Terminal, label: 'Search Codebase', description: 'Ask the AI about any repository', href: '/app/chat' },
  { id: 'nav-map', icon: MapIcon, label: 'Architecture Map', description: 'View the global graph', href: '/app/map' },
  { id: 'nav-repos', icon: Database, label: 'Repositories', description: 'Browse indexed repositories', href: '/app/repos' },
  { id: 'nav-adrs', icon: FileText, label: 'ADRs', description: 'Architecture decision records', href: '/app/adrs' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [repos, setRepos] = useState<Result[]>([]);
  const router = useRouter();

  const hoverSound = useSoundEffect('hover', 'click');

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) playSound('expand');
          return !o;
        });
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Load real repositories the first time the palette opens.
  useEffect(() => {
    if (!open || repos.length) return;
    let cancelled = false;
    fetch('/api/v1/repos')
      .then((r) => (r.ok ? r.json() : { repos: [] }))
      .then((data: { repos?: Array<{ id: string; fullName: string; indexStatus: string }> }) => {
        if (cancelled) return;
        setRepos(
          (data.repos ?? []).map((r) => ({
            id: `repo-${r.id}`,
            icon: Database,
            label: r.fullName,
            description: `Repository · ${r.indexStatus}`,
            href: '/app/repos',
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, repos.length]);

  const q = query.trim();
  const needle = q.toLowerCase();
  const results: Result[] = q
    ? [
        ...NAV_COMMANDS.filter((r) => r.label.toLowerCase().includes(needle)),
        ...repos.filter((r) => r.label.toLowerCase().includes(needle)),
        {
          id: 'ask-ai',
          icon: Terminal,
          label: `Ask AI: “${q}”`,
          description: 'Send this question to the assistant',
          href: `/app/chat?q=${encodeURIComponent(q)}`,
        },
      ]
    : NAV_COMMANDS;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      playSound('hover');
      setActiveIndex(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      playSound('hover');
      setActiveIndex(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      playSound('click');
      setOpen(false);
      router.push(results[activeIndex].href);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-void/60 backdrop-blur-sm"
          />

          {/* Palette */}
          <GlassPanel
            variant="heavy"
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border-arc-400/30"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-4">
              <Search className="w-5 h-5 text-arc-400" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/50"
                placeholder="Search commands, repos, or files..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="flex gap-2">
                <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border bg-surface-raised px-2 font-mono text-xs text-muted-foreground">ESC</kbd>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground font-mono">
                  No results found for "{query}"
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {results.map((result, i) => (
                    <button
                      key={result.id}
                      ref={hoverSound as any}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        playSound('click');
                        setOpen(false);
                        router.push(result.href);
                      }}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                        activeIndex === i 
                          ? "bg-arc-500/15 text-foreground" 
                          : "text-muted-foreground hover:bg-surface-raised"
                      )}
                    >
                      <div className={cn(
                        "grid place-items-center w-8 h-8 rounded-lg",
                        activeIndex === i ? "bg-arc-500 text-white shadow-[0_0_12px_rgba(13,139,255,0.4)]" : "bg-surface-raised"
                      )}>
                        <result.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 flex flex-col">
                        <span className="font-medium text-sm">{result.label}</span>
                        <span className="text-xs opacity-70">{result.description}</span>
                      </div>
                      {activeIndex === i && (
                        <ArrowRight className="w-4 h-4 text-arc-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </GlassPanel>
        </div>
      )}
    </AnimatePresence>
  );
}
