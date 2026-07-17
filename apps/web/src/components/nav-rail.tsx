'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessagesSquare, Network, GitBranch, Database, Clock, Activity, AlertTriangle, FileText, Settings, User } from 'lucide-react';
import { GlassPanel } from './ui/glass-panel';
import { cn } from '@/lib/utils';

const RAIL_ITEMS = [
  { id: 'app',       icon: LayoutDashboard, href: '/app',            label: 'Command Center' },
  { id: 'chat',      icon: MessagesSquare,  href: '/app/chat',       label: 'AI Chat' },
  { id: 'map',       icon: Network,         href: '/app/map',        label: 'Architecture Map' },
  { id: 'twin',      icon: Database,        href: '/app/twin',       label: 'Digital Twin' },
  { id: 'repos',     icon: GitBranch,       href: '/app/repos',      label: 'Repositories' },
  { id: 'timeline',  icon: Clock,           href: '/app/timeline',   label: 'Timeline' },
  { id: 'scorecard', icon: Activity,        href: '/app/scorecard',  label: 'Scorecard' },
  { id: 'incidents', icon: AlertTriangle,   href: '/app/incidents',  label: 'Incidents' },
  { id: 'adrs',      icon: FileText,        href: '/app/adrs',       label: 'ADRs' },
];

const BOTTOM_ITEMS = [
  { id: 'settings',  icon: Settings,        href: '/app/settings',   label: 'Settings' },
  { id: 'profile',   icon: User,            href: '/app/profile',    label: 'Profile' },
];

export function NavRail() {
  const pathname = usePathname();

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
      <GlassPanel variant="heavy" className="flex flex-col items-center py-3 w-14 rounded-2xl pointer-events-auto">
        <div className="flex flex-col gap-2 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-arc-500/20 text-arc-400 mb-2">
            ◆
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-1">
          {RAIL_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'group relative grid place-items-center w-10 h-10 rounded-xl transition-all',
                  isActive
                    ? 'bg-arc-500/15 text-arc-400 border border-arc-400/30 shadow-[0_0_15px_rgba(13,139,255,0.25)]'
                    : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground hover:scale-110'
                )}
                title={item.label}
              >
                <item.icon className="w-5 h-5" />
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
          {BOTTOM_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="group relative grid place-items-center w-10 h-10 rounded-xl text-muted-foreground hover:bg-surface-raised hover:text-foreground transition-all"
              title={item.label}
            >
              <item.icon className="w-5 h-5" />
            </Link>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
