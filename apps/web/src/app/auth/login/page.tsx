'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Github, Loader2 } from 'lucide-react';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/motion';
import { signIn } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGithub = async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn.social({ provider: 'github', callbackURL: '/app/dashboard' });
    } catch (e) {
      setError('GitHub sign-in unavailable. Continuing in demo mode.');
      setLoading(false);
      setTimeout(() => router.push('/onboarding'), 900);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-raised px-6">
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -right-40 -top-40 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.55 0.24 270 / 0.15), transparent)' }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.65 0.2 200 / 0.12), transparent)' }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
      </div>

      <motion.div
        className="relative w-full max-w-sm space-y-8"
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={STAGGER_ITEM} className="text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-lg text-white">◆</div>
          <h1 className="text-2xl font-semibold">AI Engineering Manager</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your codebase, finally understood.</p>
        </motion.div>

        <motion.div variants={STAGGER_ITEM}>
          <button
            onClick={handleGithub}
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-surface transition-all duration-200 hover:-translate-y-px hover:bg-surface-overlay hover:shadow-md disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Github className="h-5 w-5" />}
            <span className="text-sm font-medium">Continue with GitHub</span>
          </button>
          {error ? (
            <p className="mt-3 text-center text-xs text-amber-500">{error}</p>
          ) : (
            <button
              onClick={() => router.push('/onboarding')}
              className="mt-3 block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              or continue in demo mode →
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
