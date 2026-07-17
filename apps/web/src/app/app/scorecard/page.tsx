'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, Gauge, Zap, Network, Sparkles } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { ScoreGauge } from '@/components/scorecard/score-gauge';
import { GlassPanel } from '@/components/ui/glass-panel';
import { Badge } from '@/components/ui/badge';

/**
 * Engineering Scorecard (plan §15): 3×2 holographic gauges, 30-day
 * sparklines (same algorithm version only), persistent heuristic disclaimer,
 * and a derived recommendations panel with View-in-Map / Ask-AI actions.
 */

interface ScoreRow {
  repoId: string | null;
  repoFullName: string | null;
  scoredAt: string;
  testHealth: number | null;
  testHealthSource: string | null;
  docHealth: number | null;
  depHealth: number | null;
  security: number | null;
  complexity: number | null;
  ownership: number | null;
}

interface ScorecardData {
  algorithmVersion: number;
  disclaimer: string;
  latest: ScoreRow[];
  history: ScoreRow[];
}

const SCORE_DEFS = [
  {
    key: 'testHealth' as const,
    label: 'Test Health',
    how: 'overall_pct from the most recent coverage report pushed by CI. Null (not zero) when no report has ever been pushed.',
    source: 'coverage_reports',
  },
  {
    key: 'complexity' as const,
    label: 'Complexity',
    how: '% of functions with cyclomatic complexity ≤ 10 (McCabe 1976), from the parsed AST.',
    source: 'ast_nodes.complexity',
  },
  {
    key: 'depHealth' as const,
    label: 'Dependencies',
    how: 'Inverse of critical + high CVE count for package.json dependencies, queried against OSV.dev.',
    source: 'package.json @ HEAD → OSV.dev',
  },
  {
    key: 'security' as const,
    label: 'Security',
    how: 'Weighted inverse of gitleaks/semgrep finding severity from the latest AI security synthesis.',
    source: 'pr_ai_reviews.security_json',
  },
  {
    key: 'docHealth' as const,
    label: 'Doc Health',
    how: '% of public-API AST nodes (classes, interfaces, functions) with a DOCUMENTED_BY edge in the knowledge graph.',
    source: 'adrs, ekg_edges',
  },
  {
    key: 'ownership' as const,
    label: 'Ownership',
    how: '% of files where a single author accounts for more than 50% of commits.',
    source: 'git_commits, ekg_edges',
  },
];

function Sparkline({ points }: { points: Array<number | null> }) {
  const valid = points.filter((p): p is number => p !== null);
  if (valid.length < 2) return <span className="text-[10px] text-muted-foreground/60">not enough history</span>;
  const w = 140;
  const h = 26;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => (p === null ? null : `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full text-arc-300">
      <path d={d} fill="none" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.5" />
    </svg>
  );
}

interface Recommendation {
  severity: 'red' | 'amber' | 'green';
  text: string;
  askAi: string;
}

function deriveRecommendations(row: ScoreRow, hotspots: Array<{ filePath: string }>): Recommendation[] {
  const out: Recommendation[] = [];
  const sev = (v: number) => (v < 50 ? 'red' : 'amber') as 'red' | 'amber';
  if (row.testHealth === null)
    out.push({ severity: 'amber', text: 'No coverage reports pushed — test health is unmeasured.', askAi: 'How do I wire coverage reporting into CI for this project?' });
  else if (row.testHealth < 70)
    out.push({ severity: sev(row.testHealth), text: `Coverage at ${row.testHealth}% — untested surface is growing.`, askAi: 'Which parts of the codebase are least covered by tests and most depended on?' });
  if (row.complexity !== null && row.complexity < 75)
    out.push({ severity: sev(row.complexity), text: `${100 - row.complexity}% of functions exceed CC 10.`, askAi: 'List the most complex functions and suggest refactors.' });
  if (row.depHealth !== null && row.depHealth < 80)
    out.push({ severity: sev(row.depHealth), text: 'Known critical/high CVEs in dependencies.', askAi: 'Which dependencies have known CVEs and what are the safe upgrade paths?' });
  if (row.security !== null && row.security < 80)
    out.push({ severity: sev(row.security), text: 'Open security findings from the last AI review.', askAi: 'Summarize the open security findings and how to fix them.' });
  if (row.docHealth !== null && row.docHealth < 40)
    out.push({ severity: 'amber', text: 'Most public APIs lack linked documentation.', askAi: 'Which public APIs are undocumented?' });
  for (const h of hotspots.slice(0, 2))
    out.push({ severity: 'red', text: `Hotspot: ${h.filePath} — high churn × complexity.`, askAi: `Why is ${h.filePath} a maintenance hotspot and how should we tame it?` });
  if (out.length === 0) out.push({ severity: 'green', text: 'All signals healthy. Keep shipping.', askAi: 'Give me a health summary of the engineering organization.' });
  return out;
}

export default function ScorecardPage() {
  const router = useRouter();
  const [data, setData] = useState<ScorecardData | null>(null);
  const [hotspots, setHotspots] = useState<Array<{ filePath: string }>>([]);
  const [repoId, setRepoId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/scorecard').then((r) => r.json()).then(setData).catch(() => setData({ algorithmVersion: 1, disclaimer: '', latest: [], history: [] }));
    fetch('/api/v1/hotspots').then((r) => r.json()).then((d) => setHotspots(d.hotspots ?? [])).catch(() => {});
  }, []);

  const repos = useMemo(() => (data?.latest ?? []).filter((r) => r.repoId), [data]);
  const current = useMemo(() => repos.find((r) => r.repoId === (repoId ?? repos[0]?.repoId)) ?? null, [repos, repoId]);
  const history = useMemo(() => (data?.history ?? []).filter((h) => h.repoId === current?.repoId), [data, current]);
  const recommendations = useMemo(() => (current ? deriveRecommendations(current, hotspots) : []), [current, hotspots]);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calibrating gauges…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-24 pb-24 pt-24">
      <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="mx-auto max-w-6xl">
        <motion.div variants={STAGGER_ITEM} className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display flex items-center gap-2 text-display-lg">
              <Gauge className="h-6 w-6 text-arc-400" /> Engineering Scorecard
            </h1>
            <p className="text-panel-label mt-1">
              Algorithm v{data.algorithmVersion} · Heuristic score — not an industry-certified metric
            </p>
          </div>
          {repos.length > 1 && (
            <select
              value={current?.repoId ?? ''}
              onChange={(e) => setRepoId(e.target.value)}
              className="glass px-3 py-1.5 text-sm outline-none"
            >
              {repos.map((r) => (
                <option key={r.repoId} value={r.repoId!}>{r.repoFullName ?? r.repoId}</option>
              ))}
            </select>
          )}
        </motion.div>

        {current ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Gauges 3×2 */}
            <motion.div variants={STAGGER_ITEM} className="lg:col-span-2">
              <GlassPanel noHover className="grid grid-cols-1 gap-x-4 gap-y-8 p-6 sm:grid-cols-2 xl:grid-cols-3">
                {SCORE_DEFS.map((def) => (
                  <div key={def.key} className="flex flex-col items-center">
                    <ScoreGauge
                      value={current[def.key]}
                      label={def.label}
                      how={def.how}
                      source={def.source}
                      sublabel={def.key === 'testHealth' ? current.testHealthSource : undefined}
                    />
                    <div className="mt-2 w-36">
                      <Sparkline points={history.map((h) => h[def.key])} />
                    </div>
                  </div>
                ))}
              </GlassPanel>
            </motion.div>

            {/* Recommendations (plan §15.2) */}
            <motion.div variants={STAGGER_ITEM}>
              <GlassPanel noHover className="max-h-[70vh] overflow-y-auto p-4">
                <div className="mb-3 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-signal-amber" />
                  <span className="text-panel-label">Recommendations</span>
                </div>
                <div className="space-y-2.5">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="rounded-xl border border-[var(--glass-border)] bg-surface-raised/50 p-3">
                      <div className="flex items-start gap-2">
                        <Badge tone={rec.severity}>{rec.severity === 'red' ? 'high' : rec.severity === 'amber' ? 'medium' : 'ok'}</Badge>
                        <p className="min-w-0 flex-1 text-xs leading-relaxed">{rec.text}</p>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => router.push('/app/map')}
                          className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Network className="h-3 w-3" /> View in Map
                        </button>
                        <button
                          onClick={() => router.push('/app/chat?q=' + encodeURIComponent(rec.askAi))}
                          className="flex items-center gap-1 rounded-md border border-arc-400/40 bg-arc-500/10 px-2 py-1 text-[10px] text-arc-300 transition-colors hover:bg-arc-500/20"
                        >
                          <Sparkles className="h-3 w-3" /> Ask AI
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            </motion.div>
          </div>
        ) : (
          <motion.div variants={STAGGER_ITEM}>
            <GlassPanel noHover className="p-12 text-center text-sm text-muted-foreground">
              No scores computed yet — the scorecard worker runs nightly once repos and git history are ingested.
            </GlassPanel>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
