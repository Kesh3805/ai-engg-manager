'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Network } from 'lucide-react';
import { playSound } from '@/lib/sound';

/**
 * Assistant message (plan §11.4): markdown over the ambient background,
 * streaming cursor, and an action row (copy · open-in-map) that fades in
 * after the stream ends.
 */
export function StreamingMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      playSound('success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="prose-chat max-w-none"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) return <code {...props}>{children}</code>;
            return (
              <pre className="my-2 overflow-x-auto">
                <code className="font-mono">{children}</code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>

      <AnimatePresence>
        {isStreaming && (
          <motion.span
            className="ml-0.5 inline-block h-4 w-0.5 bg-arc-400 align-middle shadow-[0_0_6px_rgba(13,139,255,0.8)]"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isStreaming && content && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mt-2 flex items-center gap-1.5"
          >
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-signal-green" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => router.push('/app/map')}
              className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Network className="h-3 w-3" /> Open in Map
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
