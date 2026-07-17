'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Indexing scene (plan §5.4): abstract facets assembling into a crystalline
 * graph. Procedural R3F (the plan's Spline scene is an unauthored
 * placeholder) — facets orbit in and lock into an icosahedral lattice, then
 * the loop repeats while indexing continues.
 */

function Crystal() {
  const group = useRef<THREE.Group>(null);
  const facets = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(2.2, 1);
    const positions = geo.getAttribute('position');
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < positions.count; i += 3) {
      points.push(new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)));
    }
    geo.dispose();
    return points.map((p, i) => ({
      target: p,
      start: p.clone().normalize().multiplyScalar(7 + (i % 5)),
      phase: (i / points.length) * Math.PI * 2,
    }));
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) group.current.rotation.y = t * 0.25;
    group.current?.children.forEach((child, i) => {
      const facet = facets[i];
      if (!facet) return;
      // Each facet "locks in" on a staggered 6s cycle
      const cycle = (t * 0.16 + facet.phase / (Math.PI * 2)) % 1;
      const k = Math.min(1, cycle * 2.2);
      const eased = 1 - Math.pow(1 - k, 3);
      child.position.lerpVectors(facet.start, facet.target, eased);
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.15 + eased * 0.75; // facet lights up as it lands
    });
  });

  return (
    <group ref={group}>
      {facets.map((f, i) => (
        <mesh key={i} position={f.start}>
          <tetrahedronGeometry args={[0.28]} />
          <meshStandardMaterial color="#0B1524" emissive={i % 3 === 0 ? '#A855F7' : '#0D8BFF'} emissiveIntensity={0.2} roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export function IndexingScene({ size = 220 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} aria-label="Indexing in progress" role="img">
      <Canvas camera={{ position: [0, 0, 9], fov: 50 }} gl={{ alpha: true, antialias: true }} dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}>
        <ambientLight intensity={0.3} />
        <pointLight position={[6, 6, 6]} intensity={120} color="#38AAFF" />
        <Crystal />
      </Canvas>
    </div>
  );
}
