'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Loader2, Siren, Share2 } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { GlassPanel } from '@/components/ui/glass-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { relativeTime, cn } from '@/lib/utils';
import { use3dEnabled } from '@/components/3d/galaxy-scene';
import type { ReplayService } from '@/components/incidents/replay-scene';
import { playSound } from '@/lib/sound';

const ReplayScene = dynamic(() => import('@/components/incidents/replay-scene').then((m) => m.ReplayScene), { ssr: false });

/**
 * Incidents (plan §14): glass list on the left; selecting an incident plays
 * its temporal replay on the right with the AI RCA panel alongside. Sharing
 * to the live channel remains a human-only action.
 */

interface IncidentRow {
  id: string;
  source: string | null;
  title: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
  status: string | null;
  triggeredAt: string | null;
  resolvedAt: string | null;
  analysisId: string | null;
  hypothesis: string | null;
  confidencePct: number | null;
  remediation: string | null;
  sharedAt: string | null;
  evidence: Array<{ type: string; description: string }> | null;
}

const SEVERITY_TONE = { critical: 'red', high: 'red', medium: 'amber', low: 'green' } as const;

/** Build the replay cast from the incident's evidence graph. */
function servicesFrom(incident: IncidentRow): ReplayService[] {
  const evidence = incident.evidence ?? [];
  const deployment = evidence.find((e) => e.type === 'deployment');
  const primary = evidence.find((e) => e.type === 'ast_node' || e.type === 'pr' || e.type === 'commit');
  const downstream = evidence.filter((e) => e !== deployment && e !== primary).slice(0, 5);
  return [
    { id: 'dep', label: deployment?.description.slice(0, 30) ?? 'deployment', kind: 'deployment' },
    { id: 'svc', label: primary?.description.slice(0, 30) ?? incident.title?.slice(0, 30) ?? 'service', kind: 'service' },
    ...downstream.map((e, i) => ({ id: `d${i}`, label: e.description.slice(0, 26) || e.type, kind: 'downstream' as const })),
    ...(downstream.length === 0 ? [{ id: 'd0', label: 'downstream consumers', kind: 'downstream' as const }] : []),
  ];
}

export default function IncidentsPage() {
  const enabled3d = use3dEnabled();
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = () =>
    fetch('/api/v1/incidents')
      .then((r) => r.json())
      .then((d) => setIncidents(d.incidents ?? []))
      .catch(() => setIncidents([]));

  useEffect(() => {
    load();
  }, []);

  const selected = useMemo(() => incidents?.find((i) => i.id === selectedId) ?? null, [incidents, selectedId]);
  const services = useMemo(() => (selected ? servicesFrom(selected) : []), [selected]);

  const share = async (id: string) => {
    setSharing(true);
    try {
      await fetch(`/api/v1/incidents/${id}/share`, { method: 'POST' });
      playSound('success');
      await load();
    } finally {
      setSharing(false);
    }
  };

  if (!incidents) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading incidents…
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden px-24 pb-8 pt-24">
      <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="mx-auto flex h-full max-w-7xl flex-col">
        <motion.div variants={STAGGER_ITEM} className="mb-4">
          <h1 className="font-display flex items-center gap-2 text-display-lg">
            <Siren className="h-6 w-6 text-signal-red" /> Incidents
          </h1>
          <p className="text-panel-label mt-0.5">Temporal replay + AI RCA · live-channel sharing always requires a human</p>
        </motion.div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-5">
          {/* List */}
          <motion.div variants={STAGGER_ITEM} className="min-h-0 overflow-y-auto lg:col-span-2">
            <div className="space-y-2">
              {incidents.length > 0 ? (
                incidents.map((incident) => (
                  <button
                    key={incident.id}
                    onClick={() => {
                      playSound('nodeSelect');
                      setSelectedId(incident.id);
                    }}
                    className={cn(
                      'glass w-full p-3 text-left transition-all hover:border-arc-400/50',
                      selectedId === incident.id && 'border-signal-red/60 shadow-[0_0_18px_rgba(255,59,48,0.15)]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[incident.severity ?? 'low']}>{incident.severity ?? '?'}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{incident.title ?? 'Untitled incident'}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{incident.source}</span>·<span>{incident.status}</span>·
                      <span>{incident.triggeredAt ? relativeTime(incident.triggeredAt) : 'unknown'}</span>
                      {incident.analysisId && <span className="ml-auto font-mono text-arc-300">RCA {incident.confidencePct ?? '?'}%</span>}
                    </div>
                  </button>
                ))
              ) : (
                <GlassPanel noHover className="p-10 text-center text-sm text-muted-foreground">
                  No incidents recorded — webhook ingress at <code className="font-mono text-arc-300">/webhooks/pagerduty</code>.
                </GlassPanel>
              )}
            </div>
          </motion.div>

          {/* Replay + RCA */}
          <motion.div variants={STAGGER_ITEM} className="flex min-h-0 flex-col gap-3 lg:col-span-3">
            {selected ? (
              <>
                <GlassPanel noHover className="relative min-h-[280px] flex-1 overflow-hidden">
                  {enabled3d ? (
                    <ReplayScene key={selected.id} services={services} />
                  ) : (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                      Replay requires WebGL — the RCA narrative is below.
                    </div>
                  )}
                </GlassPanel>

                <GlassPanel noHover className="max-h-[38%] overflow-y-auto p-4">
                  {selected.analysisId ? (
                    <>
                      <div className="mb-2 rounded-lg border border-signal-amber/30 bg-signal-amber/10 px-3 py-1.5 text-[11px] text-signal-amber">
                        ⚠️ AI-generated hypothesis — unverified. Confidence: {selected.confidencePct ?? '?'}%.
                      </div>
                      <p className="text-sm leading-relaxed">{selected.hypothesis}</p>
                      {selected.evidence && selected.evidence.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          {selected.evidence.map((e, i) => (
                            <li key={i}>
                              <span className="font-mono uppercase text-arc-300">{e.type}</span> — {e.description}
                            </li>
                          ))}
                        </ul>
                      )}
                      {selected.remediation && (
                        <p className="mt-2 text-xs">
                          <span className="font-semibold">Remediation:</span> <span className="text-muted-foreground">{selected.remediation}</span>
                        </p>
                      )}
                      <div className="mt-3">
                        {selected.sharedAt ? (
                          <span className="text-[11px] text-muted-foreground">Shared to incident channel {relativeTime(selected.sharedAt)}</span>
                        ) : (
                          <Button size="sm" disabled={sharing} onClick={() => share(selected.id)}>
                            {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                            Share to incident channel
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">No AI analysis yet for this incident.</p>
                  )}
                </GlassPanel>
              </>
            ) : (
              <GlassPanel noHover className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Select an incident to replay its timeline
              </GlassPanel>
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
