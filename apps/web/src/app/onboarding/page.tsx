'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, GitBranch, Plug, Check, ArrowRight, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = ['organization', 'repository', 'integrations', 'complete'] as const;
const GITHUB_APP_INSTALL = 'https://github.com/apps/ai-engg-manager/installations/new';

interface RepoOption {
  id: string;
  fullName: string;
  indexStatus: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const progress = ((step + 1) / STEPS.length) * 100;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    fetch('/api/v1/repos')
      .then((r) => r.json())
      .then((d) => {
        const list: RepoOption[] = (d.repos ?? []).map((r: RepoOption) => ({ id: r.id, fullName: r.fullName, indexStatus: r.indexStatus }));
        setRepos(list);
        const firstReady = list.find((r) => r.indexStatus === 'ready');
        setSelected(new Set(firstReady ? [firstReady.fullName] : list[0] ? [list[0].fullName] : []));
      })
      .catch(() => setRepos([]));
  }, []);

  const indexSelected = async () => {
    setLinking(true);
    await Promise.all(
      [...selected].map((fullName) =>
        fetch('/api/v1/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ githubRepoFullName: fullName }),
        }).catch(() => {}),
      ),
    );
    setLinking(false);
    next();
  };

  const toggle = (fullName: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(fullName) ? n.delete(fullName) : n.add(fullName);
      return n;
    });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface p-8">
      <div className="mb-10 w-full max-w-lg">
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full rounded-full bg-brand-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        </div>
        <div className="mt-2 flex justify-between">
          {STEPS.map((s, i) => (
            <motion.span key={s} className={`text-xs capitalize ${i <= step ? 'text-brand-400' : 'text-muted-foreground'}`} animate={{ opacity: i <= step ? 1 : 0.4 }}>
              {s}
            </motion.span>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }}
          className="w-full max-w-lg"
        >
          {step === 0 && <Step icon={Building2} title="Your workspace" desc="A workspace isolates your repos, graph and conversations.">
            <p className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-muted-foreground">
              A personal workspace is created automatically from your GitHub account when you sign in.
            </p>
            <Button className="mt-4 w-full" onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button>
          </Step>}

          {step === 1 && <Step icon={GitBranch} title="Connect a repository" desc="We pull it from GitHub, parse it, and build the AST graph.">
            {repos === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…</div>
            ) : repos.length === 0 ? (
              <div className="space-y-3">
                <p className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-muted-foreground">
                  No repositories yet. Install the GitHub App on the repos you want indexed, then return here.
                </p>
                <a href={GITHUB_APP_INSTALL} target="_blank" rel="noreferrer" className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface text-sm font-medium transition-colors hover:bg-surface-overlay">
                  Install the GitHub App <ExternalLink className="h-4 w-4" />
                </a>
                <Button variant="ghost" className="w-full" onClick={next}>Skip for now <ArrowRight className="h-4 w-4" /></Button>
              </div>
            ) : (
              <>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {repos.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm hover:bg-surface-overlay">
                      <input type="checkbox" checked={selected.has(r.fullName)} onChange={() => toggle(r.fullName)} className="accent-brand-500" />
                      <span className="flex-1 truncate">{r.fullName}</span>
                      {r.indexStatus === 'ready' && <span className="text-[11px] text-emerald-500">indexed</span>}
                    </label>
                  ))}
                </div>
                <Button className="mt-4 w-full" disabled={linking || selected.size === 0} onClick={indexSelected}>
                  {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Index {selected.size || ''} repositor{selected.size === 1 ? 'y' : 'ies'}
                </Button>
              </>
            )}
          </Step>}

          {step === 2 && <Step icon={Plug} title="Integrations" desc="Optional — Slack, Jira & Linear add full-text context to retrieval.">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['GitHub', !!repos?.length],
                ['Slack', false],
                ['Jira', false],
                ['Linear', false],
              ].map(([p, on]) => (
                <div key={p as string} className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm">
                  {p} <span className={`text-xs ${on ? 'text-emerald-500' : 'text-muted-foreground'}`}>{on ? 'connected' : 'not connected'}</span>
                </div>
              ))}
            </div>
            <Button className="mt-4 w-full" onClick={next}>Finish setup <ArrowRight className="h-4 w-4" /></Button>
          </Step>}

          {step === 3 && (
            <div className="text-center">
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-500">
                <Check className="h-7 w-7" />
              </motion.div>
              <h2 className="mt-5 text-xl font-semibold">You&apos;re all set</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Your codebase is indexed. Time to explore.</p>
              <Button className="mt-6" onClick={() => router.push('/app/dashboard')}>Open dashboard <ArrowRight className="h-4 w-4" /></Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Step({ icon: Icon, title, desc, children }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/15 text-brand-400"><Icon className="h-4 w-4" /></span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">{desc}</p>
      {children}
    </div>
  );
}
