'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * EKG energy beam (plan §9.3): curved line between nodes with a flowing-dash
 * animation (dashOffset advanced per frame). Edge type → color.
 */

export const EDGE_COLORS: Record<string, string> = {
  IMPORTS: '#0D8BFF',
  CALLS: '#0D8BFF',
  USAGE: '#0D8BFF',
  MODIFIED: '#0D8BFF',
  AUTHORED: '#A855F7',
  REVIEWED: '#A855F7',
  MERGED: '#A855F7',
  TRIGGERED: '#22D3EE',
  RESOLVES: '#22D3EE',
  DOCUMENTED_BY: '#30D158',
  CAUSED: '#FF3B30',
  incident: '#FF3B30',
};

export function EkgEdge({
  from,
  to,
  edgeType = 'CALLS',
  pulsing = false,
  dimmed = false,
}: {
  from: [number, number, number];
  to: [number, number, number];
  edgeType?: string;
  pulsing?: boolean;
  dimmed?: boolean;
}) {
  const matRef = useRef<THREE.LineDashedMaterial>(null);
  const color = EDGE_COLORS[edgeType] ?? '#0D8BFF';

  const line = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    // Arc the midpoint upward for the energy-beam curve
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
    const material = new THREE.LineDashedMaterial({
      color,
      dashSize: 1.2,
      gapSize: 0.8,
      transparent: true,
      opacity: dimmed ? 0.05 : 0.5,
    });
    const l = new THREE.Line(geometry, material);
    l.computeLineDistances();
    return l;
  }, [from, to, color, dimmed]);

  useFrame((state, delta) => {
    const mat = line.material as THREE.LineDashedMaterial & { dashOffset?: number };
    // Flowing light: advance the dash pattern
    mat.dashOffset = (mat.dashOffset ?? 0) - delta * 2.5;
    if (pulsing) {
      mat.opacity = dimmed ? 0.05 : 0.35 + 0.35 * Math.abs(Math.sin(state.clock.elapsedTime * 3));
    }
    void matRef;
  });

  return <primitive object={line} />;
}
