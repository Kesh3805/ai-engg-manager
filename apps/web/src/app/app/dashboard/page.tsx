'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, GitPullRequest, Activity, Loader2, Flame, GitCommitHorizontal, Gauge, Siren } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/utils';

const RISK_TONE = { high: 'red', medium: 'amber', low: 'green' } as const;
const SEVERITY_TONE = { critical: 'red', high: 'red', medium: 'amber', low: 'green' } as const;

/** Hand-rolled scatter: churn (x) vs complexity (y), top hotspots. */
function HotspotRadar({ hotspots }: { hotspots: Array<{ filePath: string; churnScore: number | null; complexityScore: number | null }> }) {
  const points = hotspots.slice(0, 5).filter((h) => h.churnScore !== null && h.complexityScore !== null);
  if (points.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No hotspots detected yet</div>;
  const maxX = Math.max(...points.map((p) => p.churnScore!), 1);
  const maxY = Math.max(...points.map((p) => p.complexityScore!), 1);
  return (
    <div className="p-3">
      <svg viewBox="0 0 200 110" className="w-full">
        <line x1="20" y1="95" x2="195" y2="95" stroke="currentColor" strokeOpacity="0.2" />
        <line x1="20" y1="5" x2="20" y2="95" stroke="currentColor" strokeOpacity="0.2" />
        <text x="105" y="108" textAnchor="middle" className="fill-current text-[7px] opacity-60">churn (90d commits)</text>
        <text x="8" y="50" textAnchor="middle" transform="rotate(-90 8 50)" className="fill-current text-[7px] opacity-60">complexity</text>
        {points.map((p, i) => (
          <circle
            key={i}
            cx={20 + (p.churnScore! / maxX) * 170}
            cy={95 - (p.complexityScore! / maxY) * 85}
            r="4"
            fill="#f87171"
            fillOpacity="0.8"
          >
            <title>{p.filePath}</title>
          </circle>
        ))}
      </svg>
      <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        {points.map((p, i) => (
          <li key={i} className="truncate">🔥 {p.filePath}</li>
        ))}
      </ul>
    </div>
  );
}

/** Commits/week bars, last 12 weeks. */
function VelocityBars({ weeks }: { weeks: Array<{ week: string; commits: number }> }) {
  if (weeks.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No git history ingested yet</div>;
  const max = Math.max(...weeks.map((w) => w.commits), 1);
  return (
    <div className="flex h-28 items-end gap-1 p-3">
      {weeks.map((w) => (
        <div key={w.week} className="group relative flex-1">
          <div className="rounded-t bg-brand-500/70 transition-colors group-hover:bg-brand-400" style={{ height: `${Math.max(4, (w.commits / max) * 90)}px` }} />
          <div className="absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[9px] text-muted-foreground group-hover:block">
            {w.commits} · wk {w.week.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

const SCORE_KEYS = [
  ['testHealth', 'Tests'],
  ['complexity', 'CC'],
  ['depHealth', 'Deps'],
  ['security', 'Sec'],
  ['docHealth', 'Docs'],
  ['ownership', 'Own'],
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [hotspots, setHotspots] = useState<any[]>([]);
  const [scorecard, setScorecard] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/v1/dashboard')
      .then((r) => r.json())
      .then(setData);
    fetch('/api/v1/hotspots').then((r) => r.json()).then((d) => setHotspots(d.hotspots ?? [])).catch(() => {});
    fetch('/api/v1/scorecard').then((r) => r.json()).then(setScorecard).catch(() => {});
    fetch('/api/v1/incidents').then((r) => r.json()).then((d) => setIncidents((d.incidents ?? []).slice(0, 5))).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dashboard...
      </div>
    );
  }

  const { sprint, metrics, riskyPRs, activity } = data;
  const pct = sprint ? Math.round((sprint.completedPoints / sprint.totalPoints) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="mx-auto max-w-7xl space-y-6 p-6">
        <motion.div variants={STAGGER_ITEM} className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">Engineering Overview</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {sprint ? (
                <>
                  {sprint.name} · <span className="text-foreground">{sprint.daysRemaining} days remaining</span> · {pct}% complete
                </>
              ) : (
                'Live metrics from your indexed codebase and GitHub activity'
              )}
            </p>
          </div>
          <Button onClick={() => router.push('/app/chat?q=' + encodeURIComponent('Summarize the architecture and highlight the highest-complexity, most-depended-on parts of the codebase.'))}>
            <Sparkles className="h-4 w-4" /> AI Summary
          </Button>
        </motion.div>

        {metrics && (
          <motion.div variants={STAGGER_ITEM} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {metrics.map((m: any) => (
              <MetricCard key={m.id} label={m.label} value={m.value} delta={m.delta} unit={m.unit} />
            ))}
          </motion.div>
        )}

        <motion.div variants={STAGGER_ITEM} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface lg:col-span-2">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <GitPullRequest className="h-4 w-4 text-brand-400" />
              <h3 className="text-sm font-semibold">PR Risk Radar</h3>
              <Badge tone="neutral" className="ml-auto">
                {riskyPRs?.length || 0} open
              </Badge>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">PR</th>
                  <th className="px-2 py-2 font-medium">Author</th>
                  <th className="px-2 py-2 font-medium">Files</th>
                  <th className="px-2 py-2 font-medium">Blast</th>
                  <th className="px-4 py-2 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {riskyPRs?.length > 0 ? (
                  riskyPRs.map((pr: any) => (
                    <tr key={pr.id} className="border-t border-border transition-colors hover:bg-surface-raised">
                      <td className="px-4 py-2.5">
                        <a href={pr.url} target="_blank" rel="noreferrer" className="font-medium hover:text-brand-400">
                          #{pr.number}
                        </a>
                        <div className="max-w-[260px] truncate text-xs text-muted-foreground">{pr.title}</div>
                      </td>
                      <td className="px-2 py-2.5 text-muted-foreground">{pr.author}</td>
                      <td className="px-2 py-2.5 tabular-nums">{pr.filesChanged}</td>
                      <td className="px-2 py-2.5 tabular-nums">{pr.blastRadius}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={RISK_TONE[pr.risk as keyof typeof RISK_TONE]}>{pr.risk}</Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No risky PRs detected
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Activity className="h-4 w-4 text-brand-400" />
              <h3 className="text-sm font-semibold">Activity</h3>
            </div>
            <DashboardActivity activity={activity} />
          </div>
        </motion.div>

        {/* EKG row: hotspots · velocity · scorecard preview · incidents (plan 4a-3) */}
        <motion.div variants={STAGGER_ITEM} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Flame className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-semibold">Hotspot Radar</h3>
            </div>
            <HotspotRadar hotspots={hotspots} />
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <GitCommitHorizontal className="h-4 w-4 text-brand-400" />
              <h3 className="text-sm font-semibold">Git Velocity</h3>
            </div>
            <VelocityBars weeks={data.gitVelocity ?? []} />
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Gauge className="h-4 w-4 text-brand-400" />
              <h3 className="text-sm font-semibold">Scorecard</h3>
              <Link href="/app/scorecard" className="ml-auto text-xs text-brand-400 hover:text-brand-300">view →</Link>
            </div>
            {scorecard?.latest?.[0] ? (
              <div className="grid grid-cols-3 gap-2 p-3">
                {SCORE_KEYS.map(([key, label]) => {
                  const v = scorecard.latest[0][key] as number | null;
                  return (
                    <div key={key} className="rounded-lg bg-surface-raised px-2 py-1.5 text-center">
                      <div className="text-sm font-semibold tabular-nums">{v ?? '—'}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  );
                })}
                <p className="col-span-3 text-center text-[9px] text-muted-foreground">Heuristic score — not an industry-certified metric</p>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No scores yet</div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Siren className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-semibold">Recent Incidents</h3>
              <Link href="/app/incidents" className="ml-auto text-xs text-brand-400 hover:text-brand-300">view →</Link>
            </div>
            <div className="space-y-2 p-3">
              {incidents.length > 0 ? (
                incidents.map((i: any) => (
                  <div key={i.id} className="flex items-center gap-2 text-xs">
                    <Badge tone={SEVERITY_TONE[i.severity as keyof typeof SEVERITY_TONE] ?? 'neutral'}>{i.severity ?? '?'}</Badge>
                    <span className="min-w-0 flex-1 truncate">{i.title ?? 'Untitled'}</span>
                    <span className="text-muted-foreground">{i.status}</span>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">No incidents</div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function DashboardActivity({ activity }: { activity: any[] }) {
  return (
    <div className="space-y-3 p-4">
      {activity?.length > 0 ? (
        activity.map((e: any) => (
          <div key={e.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400" />
            <div className="min-w-0">
              <p className="leading-snug">
                <span className="font-medium">{e.actor}</span>{' '}
                <span className="text-muted-foreground">{e.text}</span>
              </p>
              <span className="text-[11px] text-muted-foreground">{relativeTime(e.at)}</span>
            </div>
          </div>
        ))
      ) : (
        <div className="text-center text-sm text-muted-foreground py-4">No recent activity</div>
      )}
    </div>
  );
}
