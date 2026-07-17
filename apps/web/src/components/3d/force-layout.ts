/**
 * Tiny synchronous force layout for the 3D map (plan §10 — stands in for the
 * unauthored Rapier physics: repulsion + edge springs + centering, run for a
 * fixed number of iterations at load; deterministic via id-hash seeding).
 */

export interface LayoutInput {
  nodes: Array<{ id: string; group?: string }>;
  edges: Array<{ source: string; target: string }>;
}

function hash(id: string, salt: string): number {
  let h = 2166136261;
  const s = id + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function forceLayout3d({ nodes, edges }: LayoutInput, iterations = 80): Map<string, [number, number, number]> {
  const n = nodes.length;
  if (n === 0) return new Map();

  const pos = new Float64Array(n * 3);
  const index = new Map<string, number>();
  nodes.forEach((node, i) => {
    index.set(node.id, i);
    // Seeded sphere start; same-file groups start near each other.
    const g = node.group ? hash(node.group, 'g') : hash(node.id, 'g');
    const baseTheta = g * Math.PI * 2;
    pos[i * 3] = Math.cos(baseTheta) * 30 + (hash(node.id, 'x') - 0.5) * 14;
    pos[i * 3 + 1] = (hash(node.id, 'y') - 0.5) * 26;
    pos[i * 3 + 2] = Math.sin(baseTheta) * 30 + (hash(node.id, 'z') - 0.5) * 14;
  });

  const springs: Array<[number, number]> = [];
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined) springs.push([a, b]);
  }

  const REPULSE = 220;
  const SPRING_LEN = 9;
  const SPRING_K = 0.04;
  const CENTER_K = 0.012;

  const disp = new Float64Array(n * 3);

  for (let iter = 0; iter < iterations; iter++) {
    disp.fill(0);
    const cool = 1 - iter / iterations;

    // Pairwise repulsion (O(n²) — bounded: graph API caps at 220 nodes)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i * 3]! - pos[j * 3]!;
        let dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
        let dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) {
          dx = (hash(String(i * n + j), 'jx') - 0.5) * 0.1;
          dy = 0.05;
          dz = (hash(String(i * n + j), 'jz') - 0.5) * 0.1;
          d2 = 0.01;
        }
        const f = REPULSE / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fz = (dz / d) * f;
        disp[i * 3] += fx; disp[i * 3 + 1] += fy; disp[i * 3 + 2] += fz;
        disp[j * 3] -= fx; disp[j * 3 + 1] -= fy; disp[j * 3 + 2] -= fz;
      }
    }

    // Edge springs
    for (const [a, b] of springs) {
      const dx = pos[a * 3]! - pos[b * 3]!;
      const dy = pos[a * 3 + 1]! - pos[b * 3 + 1]!;
      const dz = pos[a * 3 + 2]! - pos[b * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = SPRING_K * (d - SPRING_LEN);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      disp[a * 3] -= fx; disp[a * 3 + 1] -= fy; disp[a * 3 + 2] -= fz;
      disp[b * 3] += fx; disp[b * 3 + 1] += fy; disp[b * 3 + 2] += fz;
    }

    // Integrate with centering pull + cooling clamp
    for (let i = 0; i < n; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const idx = i * 3 + axis;
        let v = disp[idx]! - pos[idx]! * CENTER_K;
        const max = 4 * cool + 0.2;
        if (v > max) v = max;
        if (v < -max) v = -max;
        pos[idx] = pos[idx]! + v;
      }
    }
  }

  const out = new Map<string, [number, number, number]>();
  nodes.forEach((node, i) => out.set(node.id, [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]));
  return out;
}
