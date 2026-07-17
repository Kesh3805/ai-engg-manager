'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Search, Bell } from 'lucide-react';
import { GlassPanel } from './ui/glass-panel';
import { cn } from '@/lib/utils';
import { useSoundEffect } from '@/lib/sound';

const NAV_ITEMS = [
  { id: 'app',     label: 'Command Center', href: '/app' },
  { id: 'chat',    label: 'AI Chat',        href: '/app/chat' },
  { id: 'map',     label: 'Architecture Map', href: '/app/map' },
  { id: 'twin',    label: 'Digital Twin',   href: '/app/twin' },
  { id: 'repos',   label: 'Repositories',   href: '/app/repos' },
];

export function CommandBar() {
  const pathname = usePathname();
  const searchSound = useSoundEffect('hover', 'nodeSelect');

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-4 pointer-events-none">
      <GlassPanel variant="heavy" className="flex items-center h-12 px-2 rounded-full pointer-events-auto border-rim-bright/40">
        {/* Brand */}
        <Link href="/app" className="flex items-center gap-2 px-3 pl-4 border-r border-border/50 mr-2 group">
          <span className="grid h-6 w-6 place-items-center rounded bg-arc-500 text-white shadow-[0_0_10px_rgba(13,139,255,0.4)] group-hover:bg-arc-400 transition-colors">◆</span>
          <span className="font-display font-bold text-sm tracking-wide">AI ENG OS</span>
        </Link>

        {/* Links */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'relative px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-arc-400/10'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="command-bar-active"
                    className="absolute inset-0 bg-arc-400/15 border border-arc-400/30 rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2 pr-1">
          <button
            ref={searchSound as any}
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-surface-raised rounded-full border border-border hover:border-arc-400/50 hover:text-foreground transition-all"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="font-mono text-xs">⌘K</span>
          </button>
          
          <button className="grid place-items-center w-8 h-8 rounded-full hover:bg-surface-raised text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="w-4 h-4" />
          </button>

          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-arc-400 to-plasma-500 p-[2px] ml-1">
            <div className="w-full h-full rounded-full bg-surface border border-transparent overflow-hidden">
              <img src="https://github.com/shadcn.png" alt="Avatar" className="w-full h-full object-cover opacity-80" />
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
