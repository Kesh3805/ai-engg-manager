'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Gauge, GitPullRequest, Loader2, Network, MessagesSquare, History, X } from 'lucide-react';
import { FloatingPanel } from '@/components/floating-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { use3dEnabled, type GalaxyNode, type GalaxyEdge } from '@/components/3d/galaxy-scene';
import { fetchJson, relativeTime } from '@/lib/utils';
import { playSound } from '@/lib/sound';

const GalaxyScene = dynamic(() => import('@/components/3d/galaxy-scene').then((m) => m.GalaxyScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Materializing universe…
    </div>
  ),
});

interface TwinPayload {
  nodes: Array<{ id: string; label: string; kind: GalaxyNode['kind']; severity?: string; status?: string; state?: string }>;
  edges: Array<{ id: string; source: string; target: string; edgeType: string }>;
}

interface RepoRow {
  id: string;
  fullName: string;
  indexStatus: string;
  nodes: number | null;
}

interface DashboardPayload {
  activity?: Array<{ id: string; actor: string; text: string; at: string }>;
  riskyPRs?: Array<{ id: string; number: number; title: string; risk: string; blastRadius: number; url: string }>;
}

interface ScorecardPayload {
  latest?: Array<Record<string, number | string | null>>;
}

/** Command Center (plan §9) — the signature full-3D view. */
export default function CommandCenterPage() {
  const router = useRouter();
  const enabled3d = use3dEnabled();
  const panelBoundsRef = useRef<HTMLDivElement>(null);
  const [twin, setTwin] = useState<TwinPayload | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<TwinPayload>('/api/v1/twin', { nodes: [], edges: [] }).then(setTwin);
    fetchJson<{ repos?: RepoRow[] }>('/api/v1/repos', {}).then((d) =>
      setRepos((d.repos ?? []).filter((r) => !String(r.id).startsWith('gh:'))),
    );
    fetchJson<DashboardPayload>('/api/v1/dashboard', {}).then(setDashboard);
    fetchJson<ScorecardPayload>('/api/v1/scorecard', {}).then(setScorecard);
  }, []);

  const { nodes, edges } = useMemo((): { nodes: GalaxyNode[]; edges: GalaxyEdge[] } => {
    if (!twin) return { nodes: [], edges: [] };
    const repoMeta = new Map(repos.map((r) => [r.id, r]));
    const nodes: GalaxyNode[] = twin.nodes.map((n) => {
      if (n.kind === 'repo') {
        const meta = repoMeta.get(n.id);
        const entities = meta?.nodes ?? 0;
        return {
          id: n.id,
          label: n.label,
          kind: 'repo',
          status: meta?.indexStatus ?? 'ready',
          size: 1.5 + Math.min(3.5, Math.sqrt(entities) / 6),
          moons: Math.min(5, Math.ceil(entities / 120)),
          sublabel: meta ? `${meta.indexStatus} · ${entities} entities` : undefined,
        };
      }
      return { id: n.id, label: n.label, kind: n.kind, severity: n.severity, status: n.status ?? n.state };
    });
    return { nodes, edges: twin.edges };
  }, [twin, repos]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);
  const score = scorecard?.latest?.[0];

  return (
    <div className="relative h-full w-full">
      {/* Scene layer */}
      <div className="absolute inset-0">
        {enabled3d === null || !twin ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading command center…
          </div>
        ) : enabled3d ? (
          <GalaxyScene nodes={nodes} edges={edges} selectedId={selected} onSelect={setSelected} />
        ) : (
          <StaticFallback nodes={nodes} onSelect={setSelected} />
        )}
      </div>

      {/* Floating data panels (plan §9.4) — draggable glass, position persisted */}
      <div ref={panelBoundsRef} className="pointer-events-none absolute inset-0 z-20">
        <FloatingPanel id="cc-live-activity" constraintsRef={panelBoundsRef} className="right-6 top-20 w-72">
          <PanelTitle icon={<Activity className="h-3.5 w-3.5 text-arc-400" />} label="Live Activity" />
          <div className="mt-2 space-y-2">
            {(dashboard?.activity ?? []).slice(0, 5).map((e) => (
              <div key={e.id} className="flex gap-2 text-[11px] leading-snug">
                <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-arc-400" />
                <span className="text-muted-foreground">
                  <span className="text-foreground">{e.actor}</span> {e.text} · {relativeTime(e.at)}
                </span>
              </div>
            ))}
            {(dashboard?.activity ?? []).length === 0 && <Empty label="No activity yet" />}
          </div>
        </FloatingPanel>

        <FloatingPanel id="cc-eng-scores" constraintsRef={panelBoundsRef} className="left-24 top-20 w-60">
          <PanelTitle icon={<Gauge className="h-3.5 w-3.5 text-arc-400" />} label="Engineering Scores" />
          {score ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(
                [
                  ['testHealth', 'Tests'],
                  ['complexity', 'CC'],
                  ['depHealth', 'Deps'],
                  ['security', 'Sec'],
                  ['docHealth', 'Docs'],
                  ['ownership', 'Own'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="rounded-lg bg-surface-raised/70 px-1.5 py-1 text-center">
                  <div className="font-display text-sm font-semibold tabular-nums">{(score[key] as number | null) ?? '—'}</div>
                  <div className="text-[9px] text-muted-foreground">{label}</div>
                </div>
              ))}
              <p className="col-span-3 pt-0.5 text-center text-[8px] uppercase tracking-wide text-muted-foreground/70">
                Heuristic — not certified
              </p>
            </div>
          ) : (
            <Empty label="No scores yet" />
          )}
        </FloatingPanel>

        <FloatingPanel id="cc-pr-risk" constraintsRef={panelBoundsRef} className="bottom-24 right-6 w-80">
          <PanelTitle icon={<GitPullRequest className="h-3.5 w-3.5 text-arc-400" />} label="PR Risk Radar" />
          <div className="mt-2 space-y-2">
            {(dashboard?.riskyPRs ?? []).slice(0, 3).map((pr) => (
              <a key={pr.id} href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[11px] hover:text-arc-300">
                <Badge tone={pr.risk === 'high' ? 'red' : pr.risk === 'medium' ? 'amber' : 'green'}>{pr.risk}</Badge>
                <span className="min-w-0 flex-1 truncate">#{pr.number} {pr.title}</span>
                <span className="font-mono text-muted-foreground">{pr.blastRadius}⊙</span>
              </a>
            ))}
            {(dashboard?.riskyPRs ?? []).length === 0 && <Empty label="No open PR risk" />}
          </div>
        </FloatingPanel>
      </div>

      {/* Selected node detail (plan §9.5) */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="glass glass-heavy absolute right-6 top-1/2 z-30 w-80 -translate-y-1/2 p-4"
          >
            <div className="mb-2 flex items-start justify-between">
              <div>
                <Badge variant={selectedNode.kind === 'incident' ? 'red' : selectedNode.kind === 'user' ? 'green' : 'arc'}>{selectedNode.kind}</Badge>
                <h3 className="font-display mt-1.5 text-base font-semibold">{selectedNode.label}</h3>
                {selectedNode.sublabel && <p className="font-mono text-[11px] text-arc-300">{selectedNode.sublabel}</p>}
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-overlay hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {selectedNode.kind === 'repo' && (
              <div className="mt-3 flex flex-col gap-1.5">
                <Button size="sm" onClick={() => { playSound('click'); router.push('/app/map'); }}>
                  <Network className="h-3.5 w-3.5" /> Open Map
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { playSound('click'); router.push('/app/timeline'); }}>
                  <History className="h-3.5 w-3.5" /> View History
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { playSound('click'); router.push('/app/chat?q=' + encodeURIComponent(`Tell me about the ${selectedNode.label} repository — architecture, risks and recent activity.`)); }}>
                  <MessagesSquare className="h-3.5 w-3.5" /> Chat about this repo
                </Button>
              </div>
            )}
            {selectedNode.kind === 'incident' && (
              <Button size="sm" className="mt-3 w-full" onClick={() => router.push('/app/incidents')}>
                ⚡ Open incident review
              </Button>
            )}
            {selectedNode.kind !== 'repo' && selectedNode.kind !== 'incident' && (
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => router.push('/app/twin')}>
                Inspect in Digital Twin
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PanelTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-panel-label">{label}</span>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-2 text-center text-[11px] text-muted-foreground/70">{label}</p>;
}

/** prefers-reduced-motion / no-WebGL fallback (plan §21). */
function StaticFallback({ nodes, onSelect }: { nodes: GalaxyNode[]; onSelect: (id: string) => void }) {
  return (
    <div className="h-full overflow-y-auto px-24 py-24">
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-3">
        {nodes.slice(0, 60).map((n) => (
          <button key={n.id} onClick={() => onSelect(n.id)} className="glass p-3 text-left transition-colors hover:border-arc-400/50">
            <Badge variant={n.kind === 'incident' ? 'red' : 'arc'}>{n.kind}</Badge>
            <div className="mt-1 truncate text-sm">{n.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
