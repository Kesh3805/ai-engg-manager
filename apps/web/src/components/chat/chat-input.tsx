'use client';

import { useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

/** Glass chat input with arc glow on focus (plan §11.4 / U4c). */
export function ChatInput({
  value,
  onChange,
  onSend,
  isLoading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  isLoading: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) onSend();
    }
  };

  return (
    <div className="glass glass-heavy relative flex items-end gap-2 rounded-2xl p-3 transition-shadow duration-200 focus-within:border-arc-400/70 focus-within:shadow-[var(--glow-panel),var(--glow-arc)]">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your codebase, sprint, or architecture…"
        rows={1}
        aria-label="Message the AI engineering manager"
        className="max-h-[160px] min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => value.trim() && !isLoading && onSend()}
        disabled={isLoading || !value.trim()}
        aria-label="Send message"
        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-arc-400 text-white shadow-[0_0_14px_rgba(13,139,255,0.45)] transition-colors hover:bg-arc-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {isLoading ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
        ) : (
          <ArrowUp className="h-4 w-4" />
        )}
      </motion.button>
    </div>
  );
}
