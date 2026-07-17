'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { playSound } from '@/lib/sound';

/**
 * Canvas time scrubber (plan §13.1): draggable playhead over a one-year
 * track with commit tick marks; hover shows the nearest commit message.
 * Play auto-advances (~1 month/second).
 */

export interface CommitTick {
  atMs: number;
  message: string;
}

export function TimeScrubber({
  startMs,
  endMs,
  valueMs,
  ticks,
  onChange,
}: {
  startMs: number;
  endMs: number;
  valueMs: number;
  ticks: CommitTick[];
  onChange: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; tick: CommitTick } | null>(null);
  const [playing, setPlaying] = useState(false);
  const dragging = useRef(false);

  const span = Math.max(1, endMs - startMs);

  // Auto-advance: 1 month per second (plan §13.2)
  useEffect(() => {
    if (!playing) return;
    const MONTH = 30 * 24 * 3600 * 1000;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = valueRef.current + MONTH * dt;
      if (next >= endMs) {
        onChange(endMs);
        setPlaying(false);
        return;
      }
      onChange(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, endMs, onChange]);

  const valueRef = useRef(valueMs);
  valueRef.current = valueMs;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const trackY = h / 2;

    // Track
    ctx.strokeStyle = 'rgba(45,74,110,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, trackY);
    ctx.lineTo(w - 8, trackY);
    ctx.stroke();

    // Elapsed portion
    const px = 8 + ((valueMs - startMs) / span) * (w - 16);
    ctx.strokeStyle = '#0D8BFF';
    ctx.shadowColor = 'rgba(13,139,255,0.8)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(8, trackY);
    ctx.lineTo(px, trackY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Commit ticks
    for (const tick of ticks) {
      const tx = 8 + ((tick.atMs - startMs) / span) * (w - 16);
      ctx.strokeStyle = tick.atMs <= valueMs ? 'rgba(126,200,255,0.9)' : 'rgba(126,200,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, trackY - 5);
      ctx.lineTo(tx, trackY + 5);
      ctx.stroke();
    }

    // Playhead
    ctx.fillStyle = '#38AAFF';
    ctx.shadowColor = 'rgba(13,139,255,0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(px, trackY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#05070A';
    ctx.beginPath();
    ctx.arc(px, trackY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [valueMs, startMs, span, ticks]);

  useEffect(() => {
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  const msFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / (rect.width - 16)));
    return startMs + frac * span;
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => {
          playSound('click');
          setPlaying((p) => !p);
        }}
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-arc-400/40 bg-arc-500/10 text-arc-300 transition-colors hover:bg-arc-500/20"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <div className="relative min-w-0 flex-1">
        <canvas
          ref={canvasRef}
          className="h-10 w-full cursor-pointer touch-none"
          role="slider"
          aria-label="Timeline position"
          aria-valuemin={startMs}
          aria-valuemax={endMs}
          aria-valuenow={valueMs}
          tabIndex={0}
          onKeyDown={(e) => {
            const DAY = 24 * 3600 * 1000;
            if (e.key === 'ArrowRight') onChange(Math.min(endMs, valueMs + 7 * DAY));
            if (e.key === 'ArrowLeft') onChange(Math.max(startMs, valueMs - 7 * DAY));
          }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onChange(msFromEvent(e));
          }}
          onPointerMove={(e) => {
            if (dragging.current) onChange(msFromEvent(e));
            // Hover tooltip: nearest tick within 6px
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const nearest = ticks
              .map((t) => ({ t, tx: 8 + ((t.atMs - startMs) / span) * (rect.width - 16) }))
              .filter(({ tx }) => Math.abs(tx - x) < 6)
              .sort((a, b) => Math.abs(a.tx - x) - Math.abs(b.tx - x))[0];
            setHover(nearest ? { x: nearest.tx, tick: nearest.t } : null);
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => {
            dragging.current = false;
            setHover(null);
          }}
        />
        {hover && (
          <div className="glass pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap px-2 py-1 text-[10px]" style={{ left: hover.x }}>
            {new Date(hover.tick.atMs).toLocaleDateString()} · {hover.tick.message.slice(0, 48)}
          </div>
        )}
      </div>

      <span className="w-24 flex-shrink-0 text-right font-mono text-xs text-arc-300">{new Date(valueMs).toLocaleDateString()}</span>
    </div>
  );
}
