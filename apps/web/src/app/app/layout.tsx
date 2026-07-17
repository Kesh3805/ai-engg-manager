import { ThemeProvider } from '@/components/theme-provider';
import { CommandBar } from '@/components/command-bar';
import { NavRail } from '@/components/nav-rail';
import { StatusRibbon } from '@/components/status-ribbon';
import { AiOrbDock } from '@/components/ai-orb-dock';
import { AmbientBackground } from '@/components/3d/ambient-background';
import { CommandPalette } from '@/components/command-palette';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="dark" forcedTheme="dark">
      {/* 
        Full-canvas layout. 
        No overflow-hidden on main container so 3D canvases can fill the screen.
      */}
      <div className="relative h-screen w-screen overflow-hidden bg-void text-foreground">
        {/* Layer 0: Ambient 3D background — always present */}
        <AmbientBackground />

        {/* Layer 1: 3D content / scene / Page content */}
        <main className="absolute inset-0 z-10">
          {children}
        </main>

        {/* Layer 2: Floating glass UI chrome */}
        <CommandBar />
        <NavRail />
        <AiOrbDock />
        <StatusRibbon />
        
        {/* Global modals */}
        <CommandPalette />
      </div>
    </ThemeProvider>
  );
}
