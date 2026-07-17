# AI Engineering OS — Full UI Implementation Plan

> **Vision:** Not a dashboard. A spatial engineering intelligence — F.R.I.D.A.Y. meets Minority Report meets Apple Vision Pro. Every pixel communicates that you are piloting a living system, not reading a spreadsheet.

---

## 1. Technology Stack — Decisions Made

| Layer | Technology | Rationale |
|---|---|---|
| **3D Scenes** | `@splinetool/react-spline` | Hero scenes, AI orb, loading states — no Three.js authoring overhead |
| **Interactive 3D Graph** | `@react-three/fiber` + `@react-three/drei` | Repository universe, architecture graph — custom, data-driven |
| **Physics** | `@react-three/rapier` | Node collision avoidance in graph, explosion ripple in blast-radius |
| **Cinematic Camera** | `@theatre/core` + `@theatre/r3f` | Programmatic camera sequences: fly-to-node, timeline walk, incident replay |
| **UI Animation** | `framer-motion` (already installed) | Panel transitions, stagger reveals, spring physics |
| **Micro-interactions** | `motion` (Motion One) | CSS-level hover glows, progress fills, scroll reveals |
| **Shaders** | `glsl` inline via `@react-three/fiber` | Energy beams between nodes, particle fields, glow halos |
| **Sound** | `howler.js` | Spatial audio pool: hover tick, click, AI reply chime, explosion |
| **Post-processing** | `@react-three/postprocessing` | Bloom, chromatic aberration on edges, vignette on focus |
| **Fonts** | `next/font/google` — Space Grotesk + JetBrains Mono | Space Grotesk for headings, JetBrains Mono for code/data |
| **Icons** | `lucide-react` (already installed) | Consistent, sharp, minimal |
| **Charts** | `recharts` (lightweight, React-native) | Sparklines, velocity bars — only where 3D would be overkill |

**Removed from consideration:**
- `@antv/g6` — replaced by R3F (already decided in backend plan)
- `Theatre.js` Studio — prod bundle only uses `@theatre/core`, not the Studio IDE

---

## 2. Design Language

### 2.1 Color Tokens (replaces current `globals.css`)

```css
:root {
  /* Base — near-black with blue-violet undertone */
  --void:       #05070A;    /* absolute background */
  --deep:       #080C14;    /* canvas behind 3D scenes */
  --surface:    #0D1117;    /* floating panels */
  --surface-2:  #111827;    /* elevated cards */
  --surface-3:  #1A2235;    /* hover states */
  --rim:        #1E2D45;    /* panel borders */
  --rim-bright: #2D4A6E;    /* active/focused borders */

  /* Accent — Electric Blue / Cyan / Violet spectrum */
  --arc-50:     #E8F4FF;
  --arc-100:    #BAE0FF;
  --arc-200:    #7EC8FF;
  --arc-300:    #38AAFF;
  --arc-400:    #0D8BFF;    /* primary interactive */
  --arc-500:    #0066CC;
  --arc-glow:   rgba(13, 139, 255, 0.35);

  --plasma-400: #A855F7;    /* secondary accent — violet */
  --plasma-glow: rgba(168, 85, 247, 0.3);

  --cyan-400:   #22D3EE;    /* tertiary — data flows */
  --cyan-glow:  rgba(34, 211, 238, 0.25);

  /* Status */
  --signal-red:   #FF3B30;
  --signal-amber: #FF9500;
  --signal-green: #30D158;

  /* Text */
  --text-primary:   rgba(255,255,255,0.95);
  --text-secondary: rgba(255,255,255,0.60);
  --text-tertiary:  rgba(255,255,255,0.35);
  --text-mono:      #38AAFF;  /* data readouts */

  /* Glass */
  --glass-bg:     rgba(13, 17, 23, 0.72);
  --glass-border: rgba(45, 74, 110, 0.60);
  --glass-blur:   20px;
  --glass-blur-heavy: 40px;

  /* Glow shadows */
  --glow-arc:    0 0 20px rgba(13, 139, 255, 0.4), 0 0 60px rgba(13, 139, 255, 0.15);
  --glow-plasma: 0 0 20px rgba(168, 85, 247, 0.4), 0 0 60px rgba(168, 85, 247, 0.15);
  --glow-panel:  0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset;

  /* Motion */
  --spring-snappy:  cubic-bezier(0.34, 1.56, 0.64, 1);
  --spring-smooth:  cubic-bezier(0.22, 1, 0.36, 1);
  --spring-heavy:   cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast:   150ms;
  --dur-med:    300ms;
  --dur-slow:   600ms;
  --dur-cinematic: 1200ms;

  /* Radius */
  --r-sm: 8px;
  --r-md: 14px;
  --r-lg: 20px;
  --r-xl: 28px;
}
```

### 2.2 Typography

```css
/* globals.css additions */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

.font-display  { font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.02em; }
.font-mono     { font-family: 'JetBrains Mono', monospace; }
.font-ui       { font-family: 'Geist', sans-serif; }  /* existing, for body copy */

/* Scale */
.text-display-2xl { font-size: 4.5rem; line-height: 1.05; font-weight: 700; }
.text-display-xl  { font-size: 3rem;   line-height: 1.1;  font-weight: 700; }
.text-display-lg  { font-size: 2rem;   line-height: 1.15; font-weight: 600; }
.text-panel-title { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary); }
.text-data        { font-family: 'JetBrains Mono'; font-size: 0.8rem; color: var(--text-mono); }
```

### 2.3 Glass Panel Primitive (base class used everywhere)

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--r-lg);
  box-shadow: var(--glow-panel);
}
.glass-heavy {
  backdrop-filter: blur(var(--glass-blur-heavy));
  -webkit-backdrop-filter: blur(var(--glass-blur-heavy));
}
.glass-glow-arc   { box-shadow: var(--glow-panel), var(--glow-arc); }
.glass-glow-plasma { box-shadow: var(--glow-panel), var(--glow-plasma); }
```

---

## 3. New npm Dependencies

```json
{
  "@splinetool/react-spline": "^2.2.6",
  "@react-three/fiber": "^8.16.0",
  "@react-three/drei": "^9.99.0",
  "@react-three/postprocessing": "^2.16.0",
  "@react-three/rapier": "^1.5.0",
  "@theatre/core": "^0.7.2",
  "@theatre/r3f": "^0.7.2",
  "howler": "^2.2.4",
  "@types/howler": "^2.2.11",
  "three": "^0.163.0",
  "@types/three": "^0.163.0",
  "recharts": "^2.12.0",
  "leva": "^0.9.35"
}
```

---

## 4. Application Shell — Spatial Layout

### 4.1 Complete Layout Redesign

**Current:** Traditional sidebar + main area  
**New:** Full-canvas 3D workspace with floating glass panels

```
┌─────────────────────────────────────────────────────┐
│  ████████████████ 3D CANVAS (full viewport) ████████│
│  ██                                              ████│
│  ██   [Glass Command Bar — top, floating]        ████│
│  ██                                              ████│
│  ██         [3D Scene / Content Area]            ████│
│  ██                                              ████│
│  ██   [Glass Nav Rail — left, icon-only]         ████│
│  ██   [Floating Panel — right, contextual]       ████│
│  ██   [AI Orb — bottom center]                   ████│
│  ██   [Status Ribbon — bottom]                   ████│
└─────────────────────────────────────────────────────┘
```

**File:** `apps/web/src/app/app/layout.tsx` **[REPLACE]**

```tsx
// Full-canvas layout — no overflow-hidden on main, 3D canvas is the base layer
export default function AppLayout({ children }) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#05070A]">
      {/* Layer 0: Ambient 3D background — always present */}
      <AmbientBackground />

      {/* Layer 1: 3D content / scene */}
      <div className="absolute inset-0 z-10">{children}</div>

      {/* Layer 2: Floating glass UI chrome */}
      <CommandBar />          {/* top floating bar */}
      <NavRail />             {/* left icon rail */}
      <AiOrbDock />          {/* bottom center */}
      <StatusRibbon />        {/* bottom left */}
      <CommandPalette />      {/* global ⌘K */}
    </div>
  );
}
```

---

## 5. Spline Scenes — Specifications

### 5.1 Ambient Background Scene
**File:** `apps/web/src/components/3d/ambient-background.tsx` **[NEW]**  
**Spline URL:** `https://prod.spline.design/[ambient-bg-scene]/scene.splinecode`

Scene contains:
- **Particle field** — 2000 tiny dots at varying depths (z: -20 to -200), slow drift velocity
- **Neural network mesh** — 60 nodes connected by glowing edges, slowly morphing
- **Color palette** — `#0D8BFF` nodes, `#A855F7` secondary nodes, `#22D3EE` tertiary
- **Fog** — heavy depth fog, near=0, far=50 — reinforces depth
- **Responsive** — scene adjusts field of view to viewport width

Implementation:
```tsx
import Spline from '@splinetool/react-spline';

export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-40">
      <Spline
        scene="https://prod.spline.design/[ambient]/scene.splinecode"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
```

### 5.2 AI Orb Scene
**File:** `apps/web/src/components/3d/ai-orb.tsx` **[NEW]**  
**Spline URL:** `https://prod.spline.design/[orb-scene]/scene.splinecode`

Scene contains:
- **Core sphere** — iridescent, diameter 120px rendered, subsurface scattering material
- **Breathing animation** — scale 1.0→1.08→1.0, period 3s, ease in-out sine
- **Thinking state** — expose Spline `onMouseDown` event triggers: `idle`, `thinking`, `responding`, `error`
- **Idle** — slow blue pulse, particle orbit ring
- **Thinking** — rapid particle swirl, amber tint
- **Responding** — cyan shimmer, subtle ring expansion
- **Error** — red flash, ring contracts

Orb states driven by pipeline phase events:
```tsx
// OrbState: 'idle' | 'thinking' | 'responding' | 'error'
// Controlled via Spline's application.setVariable('state', orbState)
```

### 5.3 Repository Galaxy Scene (Landing / Command Center)
**File:** `apps/web/src/components/3d/galaxy-scene.tsx` **[NEW]**  
**Built with:** React Three Fiber (data-driven, not static Spline)

See §9 for full specification.

### 5.4 Loading / Indexing Scene
**File:** `apps/web/src/components/3d/indexing-scene.tsx` **[NEW]**  
**Spline URL:** `https://prod.spline.design/[indexing-scene]/scene.splinecode`

Scene shows:
- Floating abstract shapes assembling into a crystalline graph structure
- Progress is communicated by how "assembled" the structure looks
- Each new file parsed causes a new facet to light up
- Fully procedural — no text, pure visual progress metaphor

---

## 6. Navigation — Floating Command Bar

**File:** `apps/web/src/components/command-bar.tsx` **[NEW — replaces top-nav.tsx]**

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ AI ENG OS   [Command Center] [Chat] [Map] [Twin] [More ↓]   │
│                                          [⌘K Search]  [Avatar] │
└─────────────────────────────────────────────────────────────────┘
```

Specs:
- Position: `fixed top-4 left-1/2 -translate-x-1/2 z-50`
- Width: `min(860px, calc(100vw - 40px))`
- Style: `glass glass-heavy` with `border-rim-bright/40` border
- Height: 48px
- Active route: arc-glow underline indicator animated with `layoutId`
- On hover: individual nav items get `background: rgba(13,139,255,0.08)` with border-radius 8px
- Right: `⌘K` pill button + user avatar (ring animated with orb state color)

---

## 7. Navigation — Left Icon Rail

**File:** `apps/web/src/components/nav-rail.tsx` **[NEW — replaces sidebar.tsx]**

```
┌───┐
│ ◆ │  ← Brand mark
├───┤
│ ⊞ │  ← Command Center
│ ⬡ │  ← Galaxy (Repos)
│ 💬 │  ← AI Chat
│ 🗺 │  ← Architecture Map
│ 🌐 │  ← Digital Twin
│ ⏱ │  ← Timeline
│ 📊 │  ← Scorecard
│ ⚡ │  ← Incidents
│ 📄 │  ← ADRs
├───┤
│ ⚙ │  ← Settings
│ 👤 │  ← Profile
└───┘
```

Specs:
- Position: `fixed left-4 top-1/2 -translate-y-1/2 z-50`
- Width: 48px, icon-only always (no expand)
- Style: `glass` with vertical layout, `gap-1`
- Active: `background: var(--arc-glow)` + `border: 1px solid var(--arc-400)`
- Hover: scale 1.15, `box-shadow: var(--glow-arc)` — spring animation 200ms
- Tooltip: appears to the right on hover, `glass` style, arrow pointing left

---

## 8. AI Orb Dock

**File:** `apps/web/src/components/ai-orb-dock.tsx` **[NEW]**

```
             [AI Orb — 80px, floating]
  ┌──────────────────────────────────────────┐
  │  ◉ Ready · Last query: 2m ago · 4 repos  │
  └──────────────────────────────────────────┘
```

Specs:
- Position: `fixed bottom-6 left-1/2 -translate-x-1/2 z-50`
- Orb: Spline scene embedded (§5.2), pointer-events enabled
- Click orb → expands chat panel from bottom (sheet animation, 60vh)
- Status strip below orb: `glass` 28px tall, shows AI state + last query time
- On `thinking` state: status text animates with typewriter effect
- On `responding` state: cyan border pulse on orb

---

## 9. Command Center (Default Route: `/app`)

**File:** `apps/web/src/app/app/page.tsx` **[NEW — replaces dashboard redirect]**  
**File:** `apps/web/src/components/3d/command-center.tsx` **[NEW]**

### 9.1 Scene Description

This is the signature view. Full 3D workspace. No tables.

**Built with React Three Fiber:**

```tsx
<Canvas camera={{ position: [0, 0, 50], fov: 60 }}>
  <fog attach="fog" args={['#05070A', 60, 160]} />
  <ambientLight intensity={0.1} />
  <RepoGalaxy repos={repos} />         {/* see §9.2 */}
  <PeopleOrbs users={users} />         {/* floating user avatars */}
  <DeploymentBeams deployments={deployments} />
  <IncidentFlares incidents={incidents} />
  <EkgEdgeLines edges={ekgEdges} />    {/* energy beams */}
  <ParticleField count={3000} />
  <Bloom luminanceThreshold={0.4} intensity={1.2} />
  <ChromaticAberration offset={[0.0005, 0.0005]} />
  <OrbitControls enablePan={false} enableZoom={true} minDistance={20} maxDistance={120} autoRotate autoRotateSpeed={0.15} />
</Canvas>
```

### 9.2 Repository Galaxy

**Each repository is a planet:**

```tsx
// RepoNode: sphere geometry, diameter proportional to LOC count (min 1.5, max 5 units)
// Material: MeshStandardMaterial with emissive color based on index status
//   - 'ready': emissiveColor = arc-400, emissiveIntensity = 0.4
//   - 'indexing': emissiveColor = amber, pulsing emissiveIntensity animation
//   - 'error': emissiveColor = signal-red, emissiveIntensity = 0.8

// Atmosphere ring: TorusGeometry around each planet, tilted 15°
// Orbit path: EllipseCurve rendered as Line, opacity 0.15

// Module moons: smaller spheres (0.3-0.6 units) orbiting the repo planet
//   - One moon per major service/package within the repo
//   - Connected to planet by thin Line (opacity 0.3)

// File stars: particle field (Points geometry) within orbit radius of each planet
//   - Density proportional to file count
//   - Color: arc-200 (#7EC8FF), size: 0.02 units
```

### 9.3 EKG Energy Beams

```tsx
// Dependencies between repos rendered as animated Lines
// Uses QuadraticBezierLine from @react-three/drei
// Animation: dashOffset uniform animated in a custom shader → flowing light

// Edge types → colors:
//   IMPORTS/CALLS → arc-400 (#0D8BFF)
//   AUTHORED → plasma-400 (#A855F7)
//   TRIGGERED → cyan-400 (#22D3EE)
//   incident edges → signal-red, pulsing

// Thickness: based on edge frequency (thin = 1 call/day, thick = 100+/day)
```

### 9.4 Floating Data Panels (HTML over 3D)

Three glass panels float in the scene using `<Html>` from `@react-three/drei`. They are CSS-positioned but depth-sorted with the 3D scene:

```tsx
// Panel 1 — top-right: Live Activity feed (last 5 events)
// Panel 2 — top-left: Engineering Scores (compact 6-score ring)
// Panel 3 — bottom-right: PR Risk Radar (top 3 risky PRs)
```

Each panel is draggable via `useDrag` from `@use-gesture/react`. Position stored in localStorage.

### 9.5 Node Interaction

```tsx
// Hover a repo planet:
//   - Scale 1.0 → 1.15 (spring, 200ms)
//   - Glow intensity increases
//   - Floating label appears: repo name, index status, last commit
//   - Orbiting moons speed up

// Click a repo planet:
//   - Theatre.js camera animation: smooth fly-to, 800ms
//   - Scene dims (other nodes fade to 0.2 opacity)
//   - Right panel slides in: repo detail glass panel
//   - Available actions: "Open Map", "View History", "Chat about this repo"

// Click incident flare (red):
//   - Camera flies to affected node
//   - Incident detail panel slides in from right
//   - Affected EKG edges light up in red
```

---

## 10. Architecture Map — 3D Upgrade

**File:** `apps/web/src/app/app/map/page.tsx` **[REPLACE]**

### 10.1 Migration: React Flow → React Three Fiber

The 2D React Flow graph is replaced with a 3D force-directed graph using R3F + Rapier physics.

```tsx
<Canvas camera={{ position: [0, 0, 100], fov: 50 }}>
  <Physics gravity={[0, 0, 0]}>
    {astNodes.map(node => (
      <AstNode3D key={node.id} node={node} />
    ))}
    {astEdges.map(edge => (
      <AstEdge3D key={edge.id} edge={edge} />
    ))}
  </Physics>
  <OrbitControls />
  <Bloom luminanceThreshold={0.3} intensity={0.8} />
</Canvas>
```

### 10.2 Node Visual Encoding

```tsx
// nodeType → 3D shape + color:
//   file      → Hexagonal prism, #0D8BFF, height = LOC / 200 (capped at 4)
//   class     → Octahedron, #A855F7
//   function  → Sphere, #22D3EE, radius = complexity / 8 (capped at 1.5)
//   interface → Ring geometry, #30D158
//   method    → Cylinder, #38AAFF
//   enum      → Tetrahedron, #FF9500

// Complexity heatmap:
//   CC ≤ 5  → emissive intensity 0.1 (cool)
//   CC 6-10 → emissive intensity 0.4 (warm)
//   CC > 10 → emissive intensity 0.9 (hot, red tint)

// Hotspot files → animated pulse ring around the node
```

### 10.3 Edge Rendering

```tsx
// CALLS, USAGE → QuadraticBezierLine, arc-400, animated dash flow
// CONTAINS → straight Line, rim-bright, opacity 0.3
// IMPORTS → CubicBezierLine, plasma-400, thin
// IMPLEMENTS, INHERITS → Line, signal-green, opacity 0.5

// All edges in blast radius: arc-400, strokeWidth 3, full brightness
// All edges NOT in blast radius: opacity 0.05 (near-invisible)
```

### 10.4 Blast Radius — Explosion Effect

```tsx
// User clicks "Simulate Impact" on a node:
// Phase 1 (0-300ms): shockwave ring expands from origin node (Ring geometry, arc-glow)
// Phase 2 (300-800ms): affected nodes light up one by one, staggered by graph depth
//   - Each node: scale spike 1.0 → 1.4 → 1.0, emissive flash
//   - Energy beam between origin and affected node: animated for 600ms
// Phase 3 (800ms+): impact panel slides in (right side, glass)
//   - affectedNodeCount, affectedTestCount, affectedDeploymentCount
//   - Color-coded severity: green/amber/red based on downstream criticality
// Dismiss: all nodes return to normal with spring animation
```

---

## 11. AI Chat — Spatial Experience

**File:** `apps/web/src/app/app/chat/page.tsx` **[REPLACE]**

### 11.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ [Ambient background persists — chat floats on top]        │
│                                                           │
│        [Conversation thread — centered, 720px wide]       │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ USER: "What would break if I delete InvoiceService?"│   │
│ └─────────────────────────────────────────────────────┘   │
│                                                           │
│    [AI ORB — small, 40px, inline left of response]        │
│    ┌──────────────────────────────────────────────────┐   │
│    │ ████ Searching AST graph                         │   │
│    │ ██   Running blast radius analysis               │   │
│    │ ████████ Synthesizing...                        │   │
│    └──────────────────────────────────────────────────┘   │
│                                                           │
│        [Graph nodes referenced → glow in map sidebar]     │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐   │
│ │  [Input — glass, rounded-2xl, bottom-fixed]         │   │
│ └─────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 11.2 Pipeline Trace — Cognitive Display

Replace the current linear phase list with an animated "AI thinking" visualization:

```tsx
// File: apps/web/src/components/chat/cognitive-trace.tsx [REPLACE pipeline-trace.tsx]

// Each phase rendered as a horizontal scan bar:
//
//  ◉ AST Graph     ████████████████░░░░  87%  → "InvoiceService: 23 nodes found"
//  ○ Vector Memory ████░░░░░░░░░░░░░░░░  21%  → "3 past conversations matched"
//  ○ Blast Radius  ░░░░░░░░░░░░░░░░░░░░   0%  → pending...
//
// Bars fill in real-time using CSS width transitions (motion one)
// Phase transitions: Framer Motion layout animations
// Colors: arc-400 for active, plasma-400 for complete, rim for pending
// After completion: collapses to single-line summary with expand toggle
```

### 11.3 Context Nodes Sidebar (right panel, collapsible)

```tsx
// When AI response references AST nodes, show them:
// ┌─────────────────────────────────────────┐
// │  Referenced in this response             │
// │  ○ InvoiceService.ts         [→ Map]    │
// │  ○ PaymentGateway.process()  [→ Map]    │
// │  ○ EmailQueue.send()         [→ Map]    │
// │                                         │
// │  3 nodes highlighted in Architecture Map│
// └─────────────────────────────────────────┘
// Clicking [→ Map] opens the map page with that node focused
// The map page, if open in another tab/panel, receives a postMessage event
```

### 11.4 Message Bubbles

```tsx
// User message:
//   Right-aligned, glass-surface-2 background, arc-400/20 border
//   No avatar

// Assistant message:
//   Left-aligned, no background (transparent on ambient)
//   Small inline orb (Spline, 36px) left of content
//   Content: markdown rendered with syntax highlighting (Shiki)
//   Streaming: text appears character by character with cursor blink
//   After stream ends: subtle fade-in of action row (copy, share, open-in-map)
```

---

## 12. Digital Twin

**File:** `apps/web/src/app/app/twin/page.tsx` **[NEW]**

Same R3F galaxy as Command Center, but scoped to one org's cross-domain graph:

```tsx
// Node types → visual encoding:
//   repo        → blue planet (same as Command Center)
//   user        → glowing avatar sphere (photo texture if available, initials otherwise)
//   deployment  → amber diamond shape, pulsing if recent
//   incident    → red flare, size proportional to severity
//   pr          → small purple orbiter near its repo
//   adr         → teal document icon plane

// Edges → energy beams (same system as §9.3)
// Max 500 nodes enforced on API side
// Search: camera flies to matching node with Theatre.js animation
// Click: detail glass panel slides in from right
```

---

## 13. Architecture Timeline

**File:** `apps/web/src/app/app/timeline/page.tsx` **[NEW]**

### 13.1 Time Scrubber

```tsx
// Top-center floating control:
// ┌────────────────────────────────────────────────────────────┐
// │  ◀  [Jan 2024] ─────●──────────────────── [Jul 2026]  ▶   │
// │       2024 Q1   2024 Q3   2025 Q1   2025 Q3   Today        │
// └────────────────────────────────────────────────────────────┘
// Custom range slider (no shadcn — custom canvas-based for precision)
// Commit markers on the track (small tick marks at commit dates)
// Hovering a tick shows commit message tooltip (glass)
```

### 13.2 Scene Morphing

```tsx
// As user scrubs time, the 3D architecture graph morphs:
// - Nodes that didn't exist yet fade in (scale 0 → 1, spring)
// - Nodes deleted at that point fade out (scale 1 → 0, 300ms)
// - Edges appear/disappear with the same transitions
// - Node size changes (LOC growth) animated with spring
// - Camera doesn't move (user controls it separately)

// "Play" button: auto-advances time 1 month/second, animates morphing
// "Incident Replay" mode: advance only through incident timeline
//   - Red flares appear at incident points
//   - Click flare → freeze time, show incident detail panel
```

---

## 14. Incidents — Temporal Replay

**File:** `apps/web/src/app/app/incidents/page.tsx` **[NEW]**

### 14.1 Layout

Left: incident list (glass table)  
Right: incident detail (3D replay)

### 14.2 Incident Replay Scene

```tsx
// When user clicks an incident:
// 1. Right panel becomes a Theatre.js controlled scene
// 2. Camera starts at wide view showing all affected services
// 3. Timeline plays automatically:
//    T-10min: normal state — all nodes green
//    T+0:00:  deployment node flashes amber, beam to affected service appears
//    T+2:00:  affected service turns red, error count badge appears
//    T+4:00:  downstream services yellow → red cascade
//    T+6:00:  incident triggered — red flare explosion
//    T+8:00:  rollback animation — services return to green one by one
//
// User can pause, rewind, advance frame-by-frame
// AI RCA panel slides in alongside with evidence list

// Node states:
//   normal     → green glow, calm
//   degraded   → amber glow, pulse
//   failing    → red glow, rapid pulse, error badge
//   recovering → green glow fading in
```

---

## 15. Engineering Scorecard

**File:** `apps/web/src/app/app/scorecard/page.tsx` **[NEW]**

### 15.1 Layout: Holographic Gauges

```tsx
// Full-screen glass panel — no sidebar content obscuring
// 6 large circular gauges in a 3x2 grid:

// Each gauge:
//   - Custom SVG arc (not a chart library)
//   - Diameter: 200px
//   - Background arc: rim-bright/30
//   - Filled arc: color gradient (signal-red → signal-amber → signal-green) based on value
//   - Center: score number (Space Grotesk, 2.5rem, text-primary)
//   - Below center: metric name (text-panel-title)
//   - On mount: arc fills from 0 to score value, 1200ms, spring easing
//   - Hover: glow intensifies, shows "How calculated?" tooltip

// Below gauges: 30-day trend sparklines (recharts LineChart, minimal, no axes)
// "Heuristic score" disclaimer: persistent, styled as text-tertiary small caps
```

### 15.2 Recommendations Panel

```tsx
// Right side: glass panel, scrollable
// Each recommendation:
//   ┌──────────────────────────────────────────────────┐
//   │ ⚡ High    12 untested functions in payments/    │
//   │            [View in Map]  [Ask AI]               │
//   └──────────────────────────────────────────────────┘
// Severity badge: red/amber/green
// "Ask AI" → opens chat pre-seeded with context
```

---

## 16. ADRs

**File:** `apps/web/src/app/app/adrs/page.tsx` **[NEW]**

```tsx
// Layout:
//   Left: ADR list with status badges (proposed/accepted/deprecated/superseded)
//         Semantic search bar (pgvector cosine) — glass, top of list
//   Right: ADR detail panel — full markdown render + metadata

// ADR status badges:
//   accepted    → signal-green glass badge
//   deprecated  → signal-amber glass badge
//   superseded  → text-tertiary, strikethrough title
//   proposed    → arc-400 glass badge with pulse animation

// "Ask AI" button → opens chat with: "This ADR says: [content]. What's the current
//   implementation status and what has changed since this was written?"
```

---

## 17. Component Library — Complete File List

Every component follows: `glass` base + arc/plasma glow variant + spring animation on mount.

### 17.1 Primitive Components

| File | Description |
|---|---|
| `components/ui/glass-panel.tsx` **[NEW]** | Base floating panel with drag, resize, close |
| `components/ui/badge.tsx` **[REPLACE]** | Glow variants: arc, plasma, green, red, amber |
| `components/ui/button.tsx` **[REPLACE]** | Primary (arc glow fill), ghost (glass), danger (red glow) |
| `components/ui/data-readout.tsx` **[NEW]** | JetBrains Mono stat display with optional live pulse |
| `components/ui/status-dot.tsx` **[NEW]** | Animated pulsing dot: green/amber/red with glow |
| `components/ui/arc-gauge.tsx` **[NEW]** | Holographic SVG circular gauge |
| `components/ui/scan-bar.tsx` **[NEW]** | AI pipeline phase progress bar |
| `components/ui/node-chip.tsx` **[NEW]** | Clickable AST node reference chip with glow |
| `components/ui/skeleton.tsx` **[REPLACE]** | Animated shimmer with `var(--rim)` base |
| `components/ui/tooltip.tsx` **[NEW]** | Glass tooltip, arrow, spring scale-in |

### 17.2 3D Components

| File | Description |
|---|---|
| `components/3d/ambient-background.tsx` **[NEW]** | Spline ambient particle field |
| `components/3d/ai-orb.tsx` **[NEW]** | Spline orb with state management |
| `components/3d/galaxy-scene.tsx` **[NEW]** | R3F repo galaxy (Command Center + Twin) |
| `components/3d/repo-node.tsx` **[NEW]** | Individual planet mesh |
| `components/3d/ekg-edge.tsx` **[NEW]** | Animated energy beam between EKG nodes |
| `components/3d/particle-field.tsx` **[NEW]** | Shader-based point cloud |
| `components/3d/ast-node-3d.tsx` **[NEW]** | 3D AST node mesh (map view) |
| `components/3d/ast-edge-3d.tsx` **[NEW]** | Animated 3D edge (map view) |
| `components/3d/blast-shockwave.tsx` **[NEW]** | Ring expansion animation |
| `components/3d/incident-flare.tsx` **[NEW]** | Red flare mesh for incidents |
| `components/3d/indexing-scene.tsx` **[NEW]** | Spline assembly animation |
| `components/3d/camera-rig.tsx` **[NEW]** | Theatre.js camera controller |

### 17.3 Layout / Navigation

| File | Description |
|---|---|
| `components/command-bar.tsx` **[NEW]** | Floating top navigation |
| `components/nav-rail.tsx` **[NEW]** | Left icon rail |
| `components/ai-orb-dock.tsx` **[NEW]** | Bottom orb dock |
| `components/status-ribbon.tsx` **[NEW]** | Bottom-left live status |
| `components/command-palette.tsx` **[REPLACE]** | Glass fullscreen, grouped results |
| `components/floating-panel.tsx` **[NEW]** | Generic draggable glass panel primitive |

### 17.4 Feature Components

| File | Description |
|---|---|
| `components/chat/cognitive-trace.tsx` **[NEW]** | AI pipeline scan bars |
| `components/chat/streaming-message.tsx` **[REPLACE]** | Char-by-char stream + shiki highlight |
| `components/chat/chat-input.tsx` **[REPLACE]** | Glass input, arc glow on focus |
| `components/chat/context-nodes-panel.tsx` **[NEW]** | Referenced AST nodes sidebar |
| `components/map/node-detail-panel.tsx` **[REPLACE]** | Glass slide-in, 3D compatible |
| `components/incidents/replay-scene.tsx` **[NEW]** | Incident temporal replay |
| `components/scorecard/score-gauge.tsx` **[NEW]** | Single gauge component |
| `components/timeline/time-scrubber.tsx` **[NEW]** | Custom canvas range slider |

---

## 18. Sound System

**File:** `apps/web/src/lib/sound.ts` **[NEW]**

```typescript
// Sound pool managed by Howler.js
// All sounds: subtle, <0.5s duration, volume 0-0.3
// User can disable via settings (stored in localStorage)

export const SoundPool = {
  hover:       new Howl({ src: ['/sounds/hover.mp3'],     volume: 0.08, preload: true }),
  click:       new Howl({ src: ['/sounds/click.mp3'],     volume: 0.15, preload: true }),
  nodeSelect:  new Howl({ src: ['/sounds/node-select.mp3'],volume: 0.18, preload: true }),
  aiReply:     new Howl({ src: ['/sounds/ai-chime.mp3'],  volume: 0.25, preload: true }),
  graphExpand: new Howl({ src: ['/sounds/expand.mp3'],    volume: 0.12, preload: true }),
  explosion:   new Howl({ src: ['/sounds/impact.mp3'],    volume: 0.30, preload: true }),
  success:     new Howl({ src: ['/sounds/success.mp3'],   volume: 0.20, preload: true }),
  error:       new Howl({ src: ['/sounds/error.mp3'],     volume: 0.15, preload: true }),
  notification:new Howl({ src: ['/sounds/notify.mp3'],    volume: 0.20, preload: true }),
} as const;

// Usage: SoundPool.hover.play()
// All sounds in /public/sounds/ directory
// Sources: freesound.org (CC0 license) or self-generated with Tone.js
```

Sound files spec (all CC0, max 500KB total):
- `hover.mp3`: 80ms, soft sine wave tick, 440Hz → 480Hz
- `click.mp3`: 120ms, snappy mechanical click, noise burst
- `node-select.mp3`: 200ms, rising tone, sci-fi "lock-on"
- `ai-chime.mp3`: 400ms, soft bell + reverb, D major chord
- `expand.mp3`: 300ms, whoosh with harmonic
- `impact.mp3`: 500ms, low thud + high shimmer
- `success.mp3`: 350ms, ascending 3-note arpeggio
- `error.ms`: 200ms, descending 2-note, minor
- `notify.mp3`: 250ms, glass ping

---

## 19. Animation System

**File:** `apps/web/src/lib/motion.ts` **[REPLACE]**

```typescript
// Shared Framer Motion variants

export const PANEL_ENTER = {
  initial: { opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  exit:    { opacity: 0, y: -8, scale: 0.98, filter: 'blur(2px)' },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

export const PANEL_SLIDE_RIGHT = {
  initial: { opacity: 0, x: 40, filter: 'blur(6px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit:    { opacity: 0, x: 24, filter: 'blur(3px)' },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

export const STAGGER_CONTAINER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

export const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const GLASS_HOVER = {
  whileHover: { scale: 1.02, transition: { duration: 0.15, ease: [0.34, 1.56, 0.64, 1] } },
  whileTap:   { scale: 0.98 },
};

export const GLOW_PULSE = {
  animate: { opacity: [0.5, 1, 0.5] },
  transition: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' },
};

export const ORB_BREATHE = {
  animate: { scale: [1, 1.06, 1] },
  transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
};
```

---

## 20. Performance Constraints

| Concern | Constraint | Mitigation |
|---|---|---|
| R3F scene on low-end GPU | <60fps on integrated graphics | `DPR={Math.min(window.devicePixelRatio, 1.5)}` cap on Canvas; LOD system for nodes >200 |
| Spline bundle size | ~800KB per scene | `next/dynamic` lazy load + `loading={null}` fallback |
| `@react-three/fiber` + `drei` bundle | ~600KB gzipped | Dynamic import, only loaded on routes that use 3D |
| 500 EKG nodes in canvas | Frame drop | Instanced meshes (`InstancedMesh`) for node types; merge geometries at build time |
| Bloom + PostProcessing | GPU cost | Disabled automatically if `window.navigator.hardwareConcurrency < 4` (heuristic for low-end) |
| Sound on mobile | iOS autoplay policy | All sounds gated behind first user interaction; Howler handles unlock automatically |

---

## 21. Accessibility

- All 3D scenes have a `prefers-reduced-motion` escape: Canvas hides, static SVG fallback renders
- Glass panels maintain WCAG AA contrast for text (white on `#0D1117` = 13.8:1)
- All interactive elements reachable by keyboard; focus ring uses `arc-400` glow
- Screen reader: `aria-live` region announces AI response completion

---

## 22. Execution Order — UI Phases

### UI Phase 0 — Design Foundation (BLOCKING: ships before any other UI)

```
U0a. apps/web/src/app/globals.css                  [REPLACE] full new design tokens
U0b. apps/web/src/lib/motion.ts                    [REPLACE] all animation variants
U0c. apps/web/src/lib/sound.ts                     [NEW]     Howler sound pool
U0d. public/sounds/                                [NEW]     all 9 sound files (CC0)
U0e. apps/web/src/components/ui/glass-panel.tsx    [NEW]     base glass primitive
U0f. apps/web/src/components/ui/badge.tsx          [REPLACE] glow variants
U0g. apps/web/src/components/ui/button.tsx         [REPLACE] new visual language
U0h. apps/web/src/components/ui/arc-gauge.tsx      [NEW]     SVG gauge
U0i. apps/web/src/components/ui/scan-bar.tsx       [NEW]     phase bar
U0j. apps/web/src/components/ui/data-readout.tsx   [NEW]     mono stat display
U0k. apps/web/src/components/ui/status-dot.tsx     [NEW]     pulse dot
     Gate: visual audit — all primitives rendered in isolation, match design spec
```

### UI Phase 1 — Navigation Shell

```
U1a. apps/web/src/components/3d/ambient-background.tsx   [NEW] Spline ambient
U1b. apps/web/src/components/3d/ai-orb.tsx               [NEW] Spline orb
U1c. apps/web/src/components/command-bar.tsx             [NEW] floating top nav
U1d. apps/web/src/components/nav-rail.tsx                [NEW] left icon rail
U1e. apps/web/src/components/ai-orb-dock.tsx             [NEW] bottom dock
U1f. apps/web/src/components/status-ribbon.tsx           [NEW] bottom-left status
U1g. apps/web/src/components/command-palette.tsx         [REPLACE] glass fullscreen
U1h. apps/web/src/app/app/layout.tsx                     [REPLACE] full-canvas shell
     Gate: shell loads, ambient renders, nav functional, no layout regressions on existing routes
```

### UI Phase 2 — Command Center + Galaxy

```
U2a. apps/web/src/components/3d/particle-field.tsx       [NEW] shader particles
U2b. apps/web/src/components/3d/repo-node.tsx            [NEW] planet mesh
U2c. apps/web/src/components/3d/ekg-edge.tsx             [NEW] energy beam
U2d. apps/web/src/components/3d/incident-flare.tsx       [NEW] red flare
U2e. apps/web/src/components/3d/galaxy-scene.tsx         [NEW] full galaxy
U2f. apps/web/src/components/3d/camera-rig.tsx           [NEW] Theatre.js rig
U2g. apps/web/src/app/app/page.tsx                       [NEW] command center
     Gate: galaxy renders with real repo data, click-to-focus works, perf >30fps on test machine
```

### UI Phase 3 — Architecture Map (3D upgrade)

```
U3a. apps/web/src/components/3d/ast-node-3d.tsx          [NEW] typed mesh per node type
U3b. apps/web/src/components/3d/ast-edge-3d.tsx          [NEW] animated edge
U3c. apps/web/src/components/3d/blast-shockwave.tsx      [NEW] ring expansion
U3d. apps/web/src/components/map/node-detail-panel.tsx   [REPLACE] 3D-compatible panel
U3e. apps/web/src/app/app/map/page.tsx                   [REPLACE] R3F scene
     Gate: map loads AST data, blast radius animation plays, node detail shows correct data
```

### UI Phase 4 — Chat Upgrade

```
U4a. apps/web/src/components/chat/cognitive-trace.tsx    [NEW] pipeline scan bars
U4b. apps/web/src/components/chat/streaming-message.tsx  [REPLACE] char-stream + shiki
U4c. apps/web/src/components/chat/chat-input.tsx         [REPLACE] glass arc-glow input
U4d. apps/web/src/components/chat/context-nodes-panel.tsx [NEW] referenced nodes
U4e. apps/web/src/app/app/chat/page.tsx                  [REPLACE] spatial layout
     Gate: full conversation with pipeline trace renders correctly, context nodes appear when referenced
```

### UI Phase 5 — New Pages

```
U5a. apps/web/src/components/3d/indexing-scene.tsx       [NEW] Spline assembly
U5b. apps/web/src/app/app/twin/page.tsx                  [NEW] Digital Twin (same galaxy, EKG data)
U5c. apps/web/src/app/app/timeline/page.tsx              [NEW] morphing graph + scrubber
U5d. apps/web/src/components/timeline/time-scrubber.tsx  [NEW] canvas range slider
U5e. apps/web/src/app/app/scorecard/page.tsx             [NEW] holographic gauges
U5f. apps/web/src/components/scorecard/score-gauge.tsx   [NEW] single gauge SVG
U5g. apps/web/src/app/app/adrs/page.tsx                  [NEW] ADR list + semantic search
U5h. apps/web/src/app/app/incidents/page.tsx             [NEW] list + replay scene
U5i. apps/web/src/components/incidents/replay-scene.tsx  [NEW] Theatre.js incident replay
     Gate: each page loads, renders with real or seeded data, animations play
```

### UI Phase 6 — Repos Page (3D upgrade)

```
U6a. apps/web/src/app/app/repos/page.tsx                 [REPLACE]
     - Repository cards replaced with mini-galaxy cards
     - Each card: small R3F Canvas (100px), rotating repo sphere
     - "Index" → triggers Spline indexing scene in overlay
     - indexStatus → visual: assembling (indexing), glowing (ready), red (error)
     Gate: existing repo indexing flow works with new UI, status updates reflect in real time
```

### UI Phase 7 — Polish & Accessibility

```
U7a. All pages: prefers-reduced-motion fallbacks
U7b. All interactive elements: keyboard navigation + arc-glow focus rings
U7c. Screen reader aria-live regions for AI responses
U7d. Performance: InstancedMesh for node types >50, DPR cap
U7e. Sound: verify all 9 sounds play correctly, iOS unlock works
U7f. Low-end GPU: auto-disable Bloom, reduce particle count, fallback to 2D React Flow
     Gate: Lighthouse accessibility score ≥ 85, FPS test on reference low-end machine
```

---

## 23. Out of Scope for UI Plan

| Feature | Reason |
|---|---|
| Theatre.js Studio (editor UI) | Production build only — dev authoring happens offline, sequences committed |
| Spline Studio authoring in-app | Spline scenes authored externally, URLs embedded |
| Mobile layout | Engineering OS is desktop-first; mobile is a read-only view (scorecards, incident alerts) |
| Light mode | Dark only — the visual language requires deep blacks for glow effects |
| WebXR / VR | Phase 6+, not MVP |
