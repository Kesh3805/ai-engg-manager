'use client';

import { useSyncExternalStore } from 'react';

/**
 * Global AI-orb state (plan §5.2/§8): the chat pipeline drives it, the orb
 * dock (and any avatar rings) react. Tiny external store — no context
 * providers needed across the layout boundary.
 */
export type OrbState = 'idle' | 'thinking' | 'responding' | 'error';

interface OrbSnapshot {
  state: OrbState;
  lastQueryAt: number | null;
}

let snapshot: OrbSnapshot = { state: 'idle', lastQueryAt: null };
const listeners = new Set<() => void>();

export function setOrbState(state: OrbState): void {
  snapshot = { state, lastQueryAt: state === 'thinking' ? Date.now() : snapshot.lastQueryAt };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const getServerSnapshot = (): OrbSnapshot => ({ state: 'idle', lastQueryAt: null });

export function useOrbState(): OrbSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
