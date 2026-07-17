'use client';
import { GlassPanel } from './ui/glass-panel';
import { StatusDot } from './ui/status-dot';
import { Server, Database } from 'lucide-react';

export function StatusRibbon() {
  return (
    <div className="fixed bottom-4 left-4 z-50 pointer-events-none">
      <GlassPanel variant="base" className="flex items-center gap-4 px-4 py-2 rounded-full pointer-events-auto">
        <div className="flex items-center gap-2">
          <StatusDot color="green" size="sm" />
          <span className="font-mono text-xs text-muted-foreground">SYSTEM OPTIMAL</span>
        </div>
        
        <div className="w-px h-3 bg-border" />
        
        <div className="flex items-center gap-2 text-muted-foreground">
          <Server className="w-3.5 h-3.5" />
          <span className="font-mono text-xs">40ms</span>
        </div>

        <div className="w-px h-3 bg-border" />
        
        <div className="flex items-center gap-2 text-muted-foreground">
          <Database className="w-3.5 h-3.5" />
          <span className="font-mono text-xs">CONNECTED</span>
        </div>
      </GlassPanel>
    </div>
  );
}
