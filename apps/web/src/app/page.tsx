'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, GitBranch, Network, Sparkles, Boxes } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';

const FEATURES = [
  { icon: Network, title: 'Architecture Map', body: 'Live AST dependency graph with one-click blast-radius analysis across 60+ languages.' },
  { icon: Sparkles, title: 'Token Burner Pipeline', body: '5-phase Mastra workflow: parallel retrieval → reasoning → tools → synthesis → memory.' },
  { icon: GitBranch, title: 'Codebase Archaeologist', body: 'Tree-sitter ingestion with deterministic identity and incremental, rename-aware updates.' },
  { icon: Boxes, title: 'Org-aware Context', body: 'Slack, Jira, Linear and Git unified behind RBAC and semantic recall.' },
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <motion.div
          className="absolute -top-40 -right-40 h-[28rem] w-[28rem] rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.55 0.24 270 / 0.18), transparent 70%)' }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.65 0.2 200 / 0.14), transparent 70%)' }}
          animate={{ scale: [1, 1.18, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
      </div>

      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-white">◆</span>
          AI Engineering Manager
        </span>
        <Link href="/auth/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Sign in
        </Link>
      </nav>

      <motion.section
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-3xl px-6 pb-16 pt-20 text-center"
      >
        <motion.div variants={STAGGER_ITEM}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Running in demo mode · no infra required
          </span>
        </motion.div>
        <motion.h1 variants={STAGGER_ITEM} className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight">
          Your codebase,
          <br />
          finally understood.
        </motion.h1>
        <motion.p variants={STAGGER_ITEM} className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground">
          A personal AI Engineering Manager that maps your architecture, computes change blast radius, and
          synthesises answers from code, tickets and conversations.
        </motion.p>
        <motion.div variants={STAGGER_ITEM} className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/app/dashboard"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-6 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-px hover:bg-brand-600"
          >
            Enter the app <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/app/map"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border-strong px-6 text-sm font-medium transition-colors hover:bg-surface-overlay"
          >
            <Network className="h-4 w-4" /> View the map
          </Link>
        </motion.div>
      </motion.section>

      <motion.section
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
        className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-6 pb-24 sm:grid-cols-2"
      >
        {FEATURES.map((f) => (
          <motion.div
            key={f.title}
            variants={STAGGER_ITEM}
            whileHover={{ y: -3 }}
            className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur"
          >
            <f.icon className="h-5 w-5 text-brand-400" />
            <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
          </motion.div>
        ))}
      </motion.section>
    </main>
  );
}
