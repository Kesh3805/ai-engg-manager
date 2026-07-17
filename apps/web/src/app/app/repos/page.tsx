'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, Plus, Loader2, X } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassPanel } from '@/components/ui/glass-panel';
import { use3dEnabled } from '@/components/3d/galaxy-scene';
import { playSound } from '@/lib/sound';

const IndexingScene = dynamic(() => import('@/components/3d/indexing-scene').then((m) => m.IndexingScene), { ssr: false });

/**
 * Repositories (plan §U6a): mini-galaxy cards — each repo is a small rotating
 * planet whose material reflects indexStatus (assembling amber = indexing,
 * arc glow = ready, red = error). The link/index flow is unchanged; an
 * indexing overlay shows the crystal assembly scene while a repo indexes.
 */

interface Repo {
  id: string;
  fullName: string;
  defaultBranch: string;
  indexStatus: string;
  nodes?: number;
  edges?: number;
  lastIndexedCommit?: string;
}

const STATUS_TONE = { ready: 'green', indexing: 'amber', pending: 'neutral', error: 'red' } as const;

function MiniPlanet({ status }: { status: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const emissive = status === 'error' ? '#FF3B30' : status === 'indexing' ? '#FF9500' : status === 'ready' ? '#0D8BFF' : '#2D4A6E';

  useFrame((state, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.5;
    if (mat.current && status === 'indexing') {
      mat.current.emissiveIntensity = 0.4 + 0.35 * Math.sin(state.clock.elapsedTime * 4);
    }
  });

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[4, 4, 4]} intensity={40} color="#38AAFF" />
      <mesh ref={mesh}>
        <sphereGeometry args={[1.15, 24, 24]} />
        <meshStandardMaterial ref={mat} color="#0A1A2F" emissive={emissive} emissiveIntensity={status === 'ready' ? 0.5 : 0.35} roughness={0.35} metalness={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2 + 0.26, 0, 0]}>
        <torusGeometry args={[1.7, 0.03, 8, 60]} />
        <meshBasicMaterial color={emissive} transparent opacity={0.4} />
      </mesh>
    </>
  );
}

export default function ReposPage() {
  const enabled3d = use3dEnabled();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [overlayFor, setOverlayFor] = useState<string | null>(null);

  const refresh = async () => {
    const d = await fetch('/api/v1/repos').then((r) => r.json()).catch(() => ({ repos: [] }));
    setRepos(d.repos ?? []);
    return d.repos ?? [];
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // Poll while any repo is indexing; auto-dismiss the overlay when its repo finishes.
  useEffect(() => {
    if (!repos.some((r) => r.indexStatus === 'indexing')) {
      if (overlayFor && !repos.some((r) => r.fullName === overlayFor && r.indexStatus === 'indexing')) {
        setOverlayFor(null);
      }
      return;
    }
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [repos, overlayFor]);

  const link = async (fullName?: string) => {
    const name = (fullName ?? input).trim();
    if (!name) return;
    playSound('expand');
    setOverlayFor(name);
    await fetch('/api/v1/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubRepoFullName: name }),
    }).catch(() => {});
    setInput('');
    setTimeout(refresh, 500);
  };

  return (
    <div className="h-full overflow-y-auto px-24 pb-24 pt-24">
      <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="mx-auto max-w-5xl space-y-6">
        <motion.div variants={STAGGER_ITEM}>
          <h1 className="font-display flex items-center gap-2 text-display-lg">
            <GitBranch className="h-6 w-6 text-arc-400" /> Repositories
          </h1>
          <p className="text-panel-label mt-1">Linked repos are pulled from GitHub, parsed, and indexed into the AST graph</p>
        </motion.div>

        <motion.div variants={STAGGER_ITEM} className="flex gap-2">
          <div className="glass flex flex-1 items-center gap-2 px-3 transition-shadow focus-within:border-arc-400/60 focus-within:shadow-[var(--glow-panel),var(--glow-arc)]">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && link()}
              placeholder="owner/repository"
              aria-label="Repository full name"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button onClick={() => link()} disabled={!input.trim()}>
            <Plus className="h-4 w-4" /> Link repo
          </Button>
        </motion.div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <motion.div variants={STAGGER_ITEM} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {repos.map((repo) => (
              <motion.div key={repo.id} whileHover={{ y: -3 }} className="glass relative overflow-hidden p-4">
                <div className="mx-auto h-[110px] w-[110px]">
                  {enabled3d ? (
                    <Canvas camera={{ position: [0, 0.6, 4.2], fov: 45 }} gl={{ alpha: true, antialias: true }} dpr={1}>
                      <MiniPlanet status={repo.indexStatus} />
                    </Canvas>
                  ) : (
                    <div
                      className="mx-auto mt-6 h-14 w-14 rounded-full"
                      style={{
                        background: 'radial-gradient(circle at 30% 30%, #38AAFF, #0A1A2F)',
                        boxShadow: repo.indexStatus === 'ready' ? '0 0 24px rgba(13,139,255,0.5)' : 'none',
                      }}
                    />
                  )}
                </div>
                <div className="mt-2 truncate text-center text-sm font-medium" title={repo.fullName}>{repo.fullName}</div>
                <div className="mt-0.5 text-center font-mono text-[10px] text-muted-foreground">
                  {repo.defaultBranch}
                  {repo.nodes ? ` · ${repo.nodes.toLocaleString()} entities` : ''}
                </div>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <Badge tone={STATUS_TONE[repo.indexStatus as keyof typeof STATUS_TONE] ?? 'neutral'}>
                    {repo.indexStatus === 'indexing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {repo.indexStatus}
                  </Badge>
                  {(repo.indexStatus === 'pending' || repo.indexStatus === 'error' || repo.indexStatus === 'ready') && (
                    <Button size="sm" variant="subtle" onClick={() => link(repo.fullName)}>
                      {repo.indexStatus === 'ready' ? 'Re-index' : 'Index'}
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
            {repos.length === 0 && (
              <GlassPanel noHover className="col-span-full p-10 text-center text-sm text-muted-foreground">
                No repositories yet — link one above or install the GitHub App.
              </GlassPanel>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* Indexing overlay (plan §U6a): crystal assembly while parsing */}
      <AnimatePresence>
        {overlayFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] grid place-items-center bg-[#05070A]/80 backdrop-blur-sm"
          >
            <div className="glass glass-heavy relative flex flex-col items-center p-8">
              <button
                onClick={() => setOverlayFor(null)}
                aria-label="Dismiss"
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              {enabled3d ? <IndexingScene size={220} /> : <Loader2 className="h-10 w-10 animate-spin text-arc-400" />}
              <div className="font-display mt-2 text-sm font-semibold">Indexing {overlayFor}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">parsing → graph assembly → embeddings</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
