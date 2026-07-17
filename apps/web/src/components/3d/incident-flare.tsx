'use client';
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { playSound } from '@/lib/sound';

/** Incident flare (plan §9.5): pulsing red mesh + halo, size by severity. */

const SEVERITY_SIZE: Record<string, number> = { critical: 1.6, high: 1.3, medium: 1.0, low: 0.75 };

export function IncidentFlare({
  id,
  label,
  severity = 'high',
  position,
  onSelect,
}: {
  id: string;
  label: string;
  severity?: string;
  position: [number, number, number];
  onSelect?: (id: string) => void;
}) {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const size = SEVERITY_SIZE[severity] ?? 1;

  useFrame((state) => {
    const pulse = 1 + 0.25 * Math.sin(state.clock.elapsedTime * 5);
    core.current?.scale.setScalar(pulse);
    if (halo.current) {
      const haloPulse = 1.6 + 0.6 * Math.sin(state.clock.elapsedTime * 5 + 1);
      halo.current.scale.setScalar(haloPulse);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.25 - 0.1 * Math.sin(state.clock.elapsedTime * 5 + 1);
    }
  });

  return (
    <group position={position}>
      <mesh
        ref={core}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          playSound('hover');
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          playSound('impact');
          onSelect?.(id);
        }}
      >
        <sphereGeometry args={[size * 0.55, 16, 16]} />
        <meshStandardMaterial color="#FF3B30" emissive="#FF3B30" emissiveIntensity={1.2} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[size * 0.55, 16, 16]} />
        <meshBasicMaterial color="#FF3B30" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {hovered && (
        <Html distanceFactor={40} position={[0, size + 1.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="glass whitespace-nowrap px-2.5 py-1 text-[11px] text-white" style={{ borderRadius: 8 }}>
            ⚡ {label}
          </div>
        </Html>
      )}
    </group>
  );
}
