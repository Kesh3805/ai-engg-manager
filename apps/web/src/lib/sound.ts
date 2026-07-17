'use client';
import { useEffect, useRef } from 'react';
import { Howl, Howler } from 'howler';

// Singleton sound pool — lazy-initialized on first user interaction
let pool: Record<string, Howl> | null = null;
let enabled = true;

function initPool() {
  if (pool) return;
  pool = {
    hover:       new Howl({ src: ['/sounds/hover.wav'],       volume: 0.08, preload: true }),
    click:       new Howl({ src: ['/sounds/click.wav'],       volume: 0.18, preload: true }),
    nodeSelect:  new Howl({ src: ['/sounds/node-select.wav'], volume: 0.20, preload: true }),
    aiChime:     new Howl({ src: ['/sounds/ai-chime.wav'],    volume: 0.28, preload: true }),
    expand:      new Howl({ src: ['/sounds/expand.wav'],      volume: 0.14, preload: true }),
    impact:      new Howl({ src: ['/sounds/impact.wav'],      volume: 0.32, preload: true }),
    success:     new Howl({ src: ['/sounds/success.wav'],     volume: 0.22, preload: true }),
    error:       new Howl({ src: ['/sounds/error.wav'],       volume: 0.18, preload: true }),
    notification:new Howl({ src: ['/sounds/notification.wav'],volume: 0.22, preload: true }),
  };
}

export type SoundName = 'hover' | 'click' | 'nodeSelect' | 'aiChime' | 'expand' | 'impact' | 'success' | 'error' | 'notification';

export function playSound(name: SoundName) {
  if (!enabled) return;
  if (typeof window === 'undefined') return;
  initPool();
  pool?.[name]?.play();
}

export function setSoundEnabled(v: boolean) {
  enabled = v;
  if (!v) Howler.mute(true);
  else Howler.mute(false);
}

export function getSoundEnabled() { return enabled; }

export function useSoundEffect(hover: SoundName = 'hover', click: SoundName = 'click') {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnter = () => playSound(hover);
    const onClick  = () => playSound(click);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('click', onClick);
    return () => { el.removeEventListener('mouseenter', onEnter); el.removeEventListener('click', onClick); };
  }, [hover, click]);
  return ref;
}
