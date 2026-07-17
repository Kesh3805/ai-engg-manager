'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Blast shockwave (plan §10.4 phase 1): a ring that expands from the origin
 * node over ~600ms and fades. Remounts (via key) on each simulation.
 */
export function BlastShockwave({ position, maxRadius = 26 }: { position: [number, number, number]; maxRadius?: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);

  useFrame((state) => {
    if (!mesh.current) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = (state.clock.elapsedTime - start.current) / 0.6; // 600ms sweep
    const k = Math.min(1, t);
    const eased = 1 - Math.pow(1 - k, 3);
    mesh.current.scale.setScalar(0.5 + eased * maxRadius);
    (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - eased);
    mesh.current.visible = k < 1;
  });

  return (
    <mesh ref={mesh} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1, 0.06, 8, 64]} />
      <meshBasicMaterial color="#38AAFF" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}
