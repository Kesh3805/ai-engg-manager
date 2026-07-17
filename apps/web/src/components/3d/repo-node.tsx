'use client';
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { playSound } from '@/lib/sound';

/**
 * Repository planet (plan §9.2): sphere sized by entity count, emissive by
 * index status, tilted atmosphere ring, orbiting module moons, hover label.
 */

export interface RepoNodeData {
  id: string;
  label: string;
  status?: 'ready' | 'indexing' | 'error' | string;
  /** 1.5–5 world units (plan) */
  size?: number;
  moons?: number;
  sublabel?: string;
}

const STATUS_EMISSIVE: Record<string, { color: string; intensity: number }> = {
  ready: { color: '#0D8BFF', intensity: 0.4 },
  indexing: { color: '#FF9500', intensity: 0.6 },
  error: { color: '#FF3B30', intensity: 0.8 },
};

export function RepoNode({
  node,
  position,
  dimmed = false,
  selected = false,
  onSelect,
}: {
  node: RepoNodeData;
  position: [number, number, number];
  dimmed?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const moonsRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const size = Math.min(5, Math.max(1.5, node.size ?? 2.2));
  const emissive = STATUS_EMISSIVE[node.status ?? 'ready'] ?? STATUS_EMISSIVE.ready!;
  const moonCount = Math.min(5, node.moons ?? 0);

  useFrame((state, delta) => {
    if (group.current) {
      const target = hovered || selected ? 1.15 : 1;
      group.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, delta * 8));
    }
    if (moonsRef.current) {
      moonsRef.current.rotation.y += delta * (hovered ? 1.6 : 0.4); // moons speed up on hover
    }
    if (matRef.current) {
      const pulse = node.status === 'indexing' ? 0.35 + 0.35 * Math.sin(state.clock.elapsedTime * 4) : emissive.intensity;
      matRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        matRef.current.emissiveIntensity,
        (hovered || selected ? pulse + 0.3 : pulse) * (dimmed ? 0.25 : 1),
        Math.min(1, delta * 6),
      );
      matRef.current.opacity = THREE.MathUtils.lerp(matRef.current.opacity, dimmed ? 0.2 : 1, Math.min(1, delta * 6));
    }
  });

  return (
    <group position={position}>
      <group ref={group}>
        {/* Planet core */}
        <mesh
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            playSound('hover');
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = 'auto';
          }}
          onClick={(e) => {
            e.stopPropagation();
            playSound('nodeSelect');
            onSelect?.(node.id);
          }}
        >
          <sphereGeometry args={[size, 32, 32]} />
          <meshStandardMaterial
            ref={matRef}
            color="#0A1A2F"
            emissive={emissive.color}
            emissiveIntensity={emissive.intensity}
            roughness={0.35}
            metalness={0.55}
            transparent
          />
        </mesh>

        {/* Atmosphere ring, tilted 15° */}
        <mesh rotation={[Math.PI / 2 + THREE.MathUtils.degToRad(15), 0, 0]}>
          <torusGeometry args={[size * 1.45, 0.035, 8, 80]} />
          <meshBasicMaterial color={emissive.color} transparent opacity={dimmed ? 0.08 : 0.35} />
        </mesh>

        {/* Module moons */}
        {moonCount > 0 && (
          <group ref={moonsRef}>
            {Array.from({ length: moonCount }).map((_, i) => {
              const angle = (i / moonCount) * Math.PI * 2;
              const orbit = size * 1.9 + i * 0.35;
              return (
                <mesh key={i} position={[Math.cos(angle) * orbit, Math.sin(angle * 2) * 0.4, Math.sin(angle) * orbit]}>
                  <sphereGeometry args={[0.3 + (i % 3) * 0.12, 12, 12]} />
                  <meshStandardMaterial color="#38AAFF" emissive="#38AAFF" emissiveIntensity={0.25} transparent opacity={dimmed ? 0.15 : 0.9} />
                </mesh>
              );
            })}
          </group>
        )}
      </group>

      {/* Hover label */}
      {(hovered || selected) && !dimmed && (
        <Html distanceFactor={40} position={[0, size + 2.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="glass whitespace-nowrap px-3 py-1.5 text-center" style={{ borderRadius: 10 }}>
            <div className="font-display text-[12px] font-semibold text-white">{node.label}</div>
            {node.sublabel && <div className="font-mono text-[9px] text-[#7EC8FF]">{node.sublabel}</div>}
          </div>
        </Html>
      )}
    </group>
  );
}
