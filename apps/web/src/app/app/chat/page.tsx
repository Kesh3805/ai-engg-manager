'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { relativeTime } from '@/lib/utils';
import { StreamingMessage } from '@/components/chat/streaming-message';
import { ChatInput } from '@/components/chat/chat-input';
import { CognitiveTrace, type PhaseState, type ToolCall, type TraceMeta } from '@/components/chat/cognitive-trace';
import { ContextNodesPanel } from '@/components/chat/context-nodes-panel';
import { AiOrb } from '@/components/3d/ai-orb';
import { setOrbState, useOrbState } from '@/lib/orb-state';
import { playSound } from '@/lib/sound';
import type { PipelineEvent, RetrievedContext } from '@/lib/pipeline';

/**
 * Spatial chat (plan §11): centered 720px thread floating on the ambient
 * layer, inline orb beside responses, cognitive scan-bar trace, referenced
 * nodes in a collapsible right panel, glass input pinned at the bottom.
 */

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  phases: PhaseState[];
  tools: ToolCall[];
  context: RetrievedContext | null;
  meta: TraceMeta | null;
  streaming: boolean;
}

interface ConversationStub {
  id: string;
  title: string | null;
  updatedAt: string;
}

const DEFAULT_SUGGESTIONS = ['Summarize the architecture and the most-depended-on parts of the codebase.'];

function ChatInner() {
  const params = useSearchParams();
  const orb = useOrbState();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationStub[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);
  const convIdRef = useRef<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Release the orb when leaving the page mid-stream.
  useEffect(() => () => setOrbState('idle'), []);

  const loadConversations = useCallback(() => {
    fetch('/api/v1/conversations')
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
    fetch('/api/v1/suggestions')
      .then((r) => r.json())
      .then((d) => d.suggestions?.length && setSuggestions(d.suggestions))
      .catch(() => {});
  }, [loadConversations]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg: Msg = { id: `u_${Date.now()}`, role: 'user', content: text, phases: [], tools: [], context: null, meta: null, streaming: false };
      const asstId = `a_${Date.now()}`;
      const asstMsg: Msg = { id: asstId, role: 'assistant', content: '', phases: [], tools: [], context: null, meta: null, streaming: true };
      setMessages((m) => [...m, userMsg, asstMsg]);
      setInput('');
      setLoading(true);
      setOrbState('thinking');
      playSound('expand');

      const update = (fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)));
      let sawText = false;
      let sawError = false;

      try {
        const res = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, conversationId: convIdRef.current }),
        });
        if (!res.body) throw new Error('no stream');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let createdConv = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.replace(/^data: /, '').trim();
            if (!line || line === '[DONE]') continue;
            const event = JSON.parse(line) as PipelineEvent | { type: 'conversation'; conversationId: string };
            if (event.type === 'conversation') {
              convIdRef.current = event.conversationId;
              setConversationId(event.conversationId);
              createdConv = true;
              continue;
            }
            if (event.type === 'text' && !sawText) {
              sawText = true;
              setOrbState('responding');
            }
            if (event.type === 'error') sawError = true;
            applyEvent(update, event);
          }
        }
        if (createdConv) loadConversations();
        setOrbState(sawError ? 'error' : 'idle');
        playSound(sawError ? 'error' : 'aiChime');
      } catch {
        update((m) => ({ ...m, content: m.content || '⚠ The pipeline failed to respond.', streaming: false }));
        setOrbState('error');
        playSound('error');
      } finally {
        update((m) => ({ ...m, streaming: false }));
        setLoading(false);
      }
    },
    [loading, loadConversations],
  );

  const newConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    convIdRef.current = null;
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setConversationId(id);
    convIdRef.current = id;
    const res = await fetch(`/api/v1/conversations/${id}`).then((r) => r.json()).catch(() => ({ messages: [] }));
    const loaded: Msg[] = (res.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      phases: [],
      tools: [],
      context: null,
      meta: null,
      streaming: false,
    }));
    setMessages(loaded);
  }, []);

  // Seed from ?q= (command center "Chat about this repo", dashboard, ADRs…)
  useEffect(() => {
    const q = params.get('q');
    if (q && !seededRef.current) {
      seededRef.current = true;
      send(q);
    }
  }, [params, send]);

  const empty = messages.length === 0;
  const latestContext = [...messages].reverse().find((m) => m.role === 'assistant' && m.context)?.context ?? null;

  return (
    <div className="relative h-full w-full">
      {/* Conversation history — floating glass panel, collapsible */}
      <div className="fixed left-20 top-24 z-40 hidden lg:block">
        <AnimatePresence mode="wait">
          {historyOpen ? (
            <motion.aside
              key="open"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="glass w-60 p-2.5"
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={newConversation}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-border)] px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-arc-400/50"
                >
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
                <button onClick={() => setHistoryOpen(false)} aria-label="Collapse history" className="text-muted-foreground hover:text-foreground">
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[50vh] space-y-1 overflow-y-auto">
                {conversations.length === 0 ? (
                  <p className="px-1 py-3 text-[11px] text-muted-foreground">Sign in with GitHub to save conversations.</p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openConversation(c.id)}
                      className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-overlay ${conversationId === c.id ? 'bg-arc-500/10' : ''}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-medium">{c.title ?? 'Untitled'}</span>
                      </div>
                      <div className="pl-4.5 text-[10px] text-muted-foreground">{relativeTime(c.updatedAt)}</div>
                    </button>
                  ))
                )}
              </div>
            </motion.aside>
          ) : (
            <motion.button
              key="closed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setHistoryOpen(true)}
              aria-label="Show conversation history"
              className="glass grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <ContextNodesPanel context={latestContext} />

      {/* Thread */}
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-40 pt-24">
        <div className="mx-auto w-full max-w-[720px]">
          {empty ? (
            <div className="flex flex-col items-center justify-center pt-16 text-center">
              <AiOrb state={orb.state} size={96} />
              <h2 className="font-display mt-6 text-display-lg">Ask your engineering manager</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Grounded in your AST graph, knowledge graph, ADRs and full-text index across Slack, Jira and Linear.
              </p>
              <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((p) => (
                  <motion.button
                    key={p}
                    whileHover={{ y: -2, scale: 1.01 }}
                    onClick={() => send(p)}
                    className="glass p-3 text-left text-sm text-muted-foreground transition-colors hover:border-arc-400/50 hover:text-foreground"
                  >
                    {p}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6" aria-live="polite">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="glass max-w-[80%] rounded-2xl rounded-br-md border-arc-400/25 bg-surface-raised/80 px-4 py-2.5 text-sm">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <div className="mt-0.5 flex-shrink-0">
                      <AiOrb state={m.streaming ? orb.state : 'idle'} size={36} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CognitiveTrace phases={m.phases} tools={m.tools} context={m.context} meta={m.meta} />
                      {m.content ? <StreamingMessage content={m.content} isStreaming={m.streaming} /> : m.streaming && <ThinkingDots />}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input — bottom-fixed glass */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 px-4">
        <div className="pointer-events-auto mx-auto w-full max-w-[720px]">
          <ChatInput value={input} onChange={setInput} onSend={() => send(input)} isLoading={loading} />
        </div>
      </div>
    </div>
  );
}

function applyEvent(update: (fn: (m: Msg) => Msg) => void, event: PipelineEvent) {
  switch (event.type) {
    case 'phase':
      update((m) => {
        const phases = [...m.phases];
        const idx = phases.findIndex((p) => p.phase === event.phase);
        if (idx === -1) phases.push({ phase: event.phase, label: event.label, status: event.status });
        else phases[idx] = { phase: event.phase, label: event.label, status: event.status };
        return { ...m, phases };
      });
      break;
    case 'tool':
      update((m) => ({ ...m, tools: [...m.tools, { name: event.name, result: event.result }] }));
      break;
    case 'context':
      update((m) => ({ ...m, context: event.context }));
      break;
    case 'meta':
      update((m) => ({ ...m, meta: { source: event.source, model: event.model } }));
      break;
    case 'text':
      update((m) => ({ ...m, content: m.content + event.chunk }));
      break;
    case 'error':
      update((m) => ({ ...m, content: m.content + `\n\n⚠ ${event.message}`, streaming: false }));
      break;
    case 'done':
      update((m) => ({ ...m, streaming: false }));
      break;
  }
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-arc-400"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatInner />
    </Suspense>
  );
}
