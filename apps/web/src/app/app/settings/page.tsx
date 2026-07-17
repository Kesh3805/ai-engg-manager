'use client';

import { useEffect, useState } from 'react';
import { Volume2, VolumeX, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { getSoundEnabled, setSoundEnabled, playSound } from '@/lib/sound';

/** Settings — interface sound + motion preferences (nav-rail target). */
export default function SettingsPage() {
  const [sound, setSound] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setSound(getSoundEnabled());
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playSound('success');
  };

  return (
    <div className="flex h-full items-center justify-center px-24">
      <GlassPanel noHover className="w-full max-w-lg p-6">
        <h1 className="font-display flex items-center gap-2 text-lg font-semibold">
          <SettingsIcon className="h-4 w-4 text-arc-400" /> Settings
        </h1>

        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-raised/60 px-4 py-3">
            <div>
              <div className="text-sm font-medium">Interface sounds</div>
              <div className="text-xs text-muted-foreground">Hover ticks, clicks, AI chimes — all under 0.3 volume.</div>
            </div>
            <button
              onClick={toggleSound}
              aria-pressed={sound}
              className={`grid h-9 w-9 place-items-center rounded-xl border transition-all ${
                sound ? 'border-arc-400/50 bg-arc-500/15 text-arc-300 shadow-[0_0_12px_rgba(13,139,255,0.25)]' : 'border-border text-muted-foreground'
              }`}
            >
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-raised/60 px-4 py-3">
            <div>
              <div className="text-sm font-medium">Motion</div>
              <div className="text-xs text-muted-foreground">
                3D scenes and animations follow your OS <code className="font-mono text-arc-300">prefers-reduced-motion</code> setting.
              </div>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{reduced ? 'REDUCED' : 'FULL'}</span>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-arc-400/20 bg-arc-500/5 px-4 py-3 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-arc-400" />
            Scores shown across the OS are heuristic — not industry-certified metrics.
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
