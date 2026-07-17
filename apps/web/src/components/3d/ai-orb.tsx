'use client';
import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

export type OrbState = 'idle' | 'thinking' | 'responding' | 'error';

function OrbCore({ orbState }: { orbState: OrbState }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<any>(null); // MeshDistortMaterial ref

  const targetColor = useMemo(() => {
    switch (orbState) {
      case 'idle':       return new THREE.Color('#0D8BFF');
      case 'thinking':   return new THREE.Color('#A855F7');
      case 'responding': return new THREE.Color('#22D3EE');
      case 'error':      return new THREE.Color('#FF3B30');
    }
  }, [orbState]);

  useFrame((state, delta) => {
    if (mesh.current) {
      // Rotate slowly
      mesh.current.rotation.y += delta * (orbState === 'thinking' ? 1.5 : 0.2);
      mesh.current.rotation.x += delta * 0.1;

      // Breathing scale for idle/responding
      if (orbState === 'idle' || orbState === 'responding') {
        const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
        mesh.current.scale.setScalar(scale);
      } else {
        mesh.current.scale.setScalar(1);
      }
    }
    if (mat.current) {
      // Lerp color smoothly
      mat.current.color.lerp(targetColor, delta * 4);
      // Adjust distortion based on state
      const targetDistort = orbState === 'thinking' ? 0.6 : 0.2;
      const targetSpeed   = orbState === 'thinking' ? 4.0 : 1.0;
      mat.current.distort = THREE.MathUtils.lerp(mat.current.distort || 0.2, targetDistort, delta * 3);
      mat.current.speed   = THREE.MathUtils.lerp(mat.current.speed || 1.0, targetSpeed, delta * 3);
    }
  });

  return (
    <Sphere ref={mesh} args={[1, 64, 64]}>
      <MeshDistortMaterial
        ref={mat}
        color="#0D8BFF"
        envMapIntensity={1}
        clearcoat={1}
        clearcoatRoughness={0.1}
        metalness={0.1}
        roughness={0.4}
        distort={0.2}
        speed={1}
      />
    </Sphere>
  );
}

function OrbitRings({ orbState }: { orbState: OrbState }) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const speed = orbState === 'thinking' ? 3.0 : 0.5;
    if (ring1.current) {
      ring1.current.rotation.x += delta * speed;
      ring1.current.rotation.y += delta * speed * 0.8;
    }
    if (ring2.current) {
      ring2.current.rotation.x -= delta * speed * 0.7;
      ring2.current.rotation.z += delta * speed;
    }
  });

  const ringColor = orbState === 'error' ? '#FF3B30' : '#22D3EE';

  return (
    <group>
      <mesh ref={ring1}>
        <torusGeometry args={[1.4, 0.015, 16, 100]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.3} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.7, 0.01, 16, 100]} />
        <meshBasicMaterial color="#A855F7" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

export function AiOrb({ state = 'idle', size = 80 }: { state?: OrbState; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="relative">
      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1.5} />
        <directionalLight position={[-10, -10, -10]} intensity={0.5} color="#A855F7" />
        <OrbCore orbState={state} />
        <OrbitRings orbState={state} />
      </Canvas>
    </div>
  );
}
