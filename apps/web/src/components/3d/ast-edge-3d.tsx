'use client';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * AST edge (plan §10.3). Curved dashed flow for CALLS/USAGE, straight faint
 * line for CONTAINS, plasma curve for IMPORTS, green for IMPLEMENTS/INHERITS.
 * Blast state: active edges at full brightness, everything else near-invisible.
 */

const EDGE_STYLE: Record<string, { color: string; curved: boolean; opacity: number; dashed: boolean }> = {
  CALLS: { color: '#0D8BFF', curved: true, opacity: 0.5, dashed: true },
  USAGE: { color: '#0D8BFF', curved: true, opacity: 0.45, dashed: true },
  CONTAINS: { color: '#2D4A6E', curved: false, opacity: 0.3, dashed: false },
  IMPORTS: { color: '#A855F7', curved: true, opacity: 0.4, dashed: true },
  IMPLEMENTS: { color: '#30D158', curved: false, opacity: 0.5, dashed: false },
  INHERITS: { color: '#30D158', curved: false, opacity: 0.5, dashed: false },
};

export function AstEdge3D({
  from,
  to,
  edgeType,
  blastActive = false,
  blastMode = false,
}: {
  from: [number, number, number];
  to: [number, number, number];
  edgeType: string;
  /** This edge is inside the active blast radius. */
  blastActive?: boolean;
  /** A blast is active somewhere in the scene. */
  blastMode?: boolean;
}) {
  const style = EDGE_STYLE[edgeType] ?? EDGE_STYLE.CALLS!;
  const color = blastActive ? '#0D8BFF' : style.color;
  const opacity = blastMode ? (blastActive ? 0.95 : 0.05) : style.opacity;

  const line = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    let points: THREE.Vector3[];
    if (style.curved) {
      const mid = start.clone().add(end).multiplyScalar(0.5);
      mid.y += start.distanceTo(end) * 0.12;
      points = new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(24);
    } else {
      points = [start, end];
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = style.dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity, linewidth: blastActive ? 3 : 1 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const l = new THREE.Line(geometry, material);
    if (style.dashed) l.computeLineDistances();
    return l;
  }, [from, to, color, opacity, style.curved, style.dashed, blastActive]);

  useFrame((_, delta) => {
    if (style.dashed) {
      const mat = line.material as THREE.LineDashedMaterial & { dashOffset?: number };
      mat.dashOffset = (mat.dashOffset ?? 0) - delta * (blastActive ? 4 : 1.6);
    }
  });

  return <primitive object={line} />;
}
