'use client';
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { playSound } from '@/lib/sound';

/**
 * AST node mesh (plan §10.2): shape + color by nodeType, emissive heatmap by
 * cyclomatic complexity, blast-flash on impact simulation, hover label.
 */

export interface AstNode3DData {
  id: string;
  name: string;
  nodeType: string;
  filePath: string;
  complexity?: number | null;
}

const TYPE_STYLE: Record<string, { color: string }> = {
  file: { color: '#0D8BFF' },
  class: { color: '#A855F7' },
  function: { color: '#22D3EE' },
  interface: { color: '#30D158' },
  method: { color: '#38AAFF' },
  enum: { color: '#FF9500' },
};

function heat(complexity: number | null | undefined): { intensity: number; tint: string | null } {
  const cc = complexity ?? 0;
  if (cc > 10) return { intensity: 0.9, tint: '#FF3B30' };
  if (cc > 5) return { intensity: 0.4, tint: null };
  return { intensity: 0.15, tint: null };
}

function Geometry({ nodeType, complexity }: { nodeType: string; complexity?: number | null }) {
  const fnRadius = Math.min(1.5, 0.55 + (complexity ?? 4) / 8);
  switch (nodeType) {
    case 'file':
      return <cylinderGeometry args={[1.1, 1.1, 1.4, 6]} />; // hex prism
    case 'class':
      return <octahedronGeometry args={[1.05]} />;
    case 'function':
      return <sphereGeometry args={[fnRadius, 20, 20]} />;
    case 'interface':
      return <torusGeometry args={[0.85, 0.28, 12, 32]} />;
    case 'method':
      return <cylinderGeometry args={[0.55, 0.55, 1.2, 16]} />;
    case 'enum':
      return <tetrahedronGeometry args={[1.0]} />;
    default:
      return <sphereGeometry args={[0.7, 16, 16]} />;
  }
}

export function AstNode3D({
  node,
  position,
  dimmed = false,
  highlighted = false,
  isOrigin = false,
  isHotspot = false,
  flashDelayMs = 0,
  onSelect,
}: {
  node: AstNode3DData;
  position: [number, number, number];
  dimmed?: boolean;
  highlighted?: boolean;
  isOrigin?: boolean;
  isHotspot?: boolean;
  /** Stagger for the blast wave: flash starts after this delay (plan §10.4). */
  flashDelayMs?: number;
  onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const flashStart = useRef<number | null>(null);

  const style = TYPE_STYLE[node.nodeType] ?? TYPE_STYLE.function!;
  const { intensity, tint } = heat(node.complexity);
  const color = tint ?? style.color;

  // Re-arm the flash whenever this node (re)enters a blast set.
  const flashKey = useMemo(() => (highlighted ? `${node.id}-${flashDelayMs}-${Date.now()}` : null), [highlighted, flashDelayMs, node.id]);

  useFrame((state, delta) => {
    if (!group.current || !mat.current) return;

    let scale = hovered || isOrigin ? 1.25 : 1;
    let emissive = hovered || isOrigin ? intensity + 0.4 : intensity;

    if (flashKey) {
      if (flashStart.current === null) flashStart.current = state.clock.elapsedTime + flashDelayMs / 1000;
      const t = state.clock.elapsedTime - flashStart.current;
      if (t > 0 && t < 0.6) {
        // scale spike 1.0 → 1.4 → 1.0 with emissive flash
        const k = Math.sin((t / 0.6) * Math.PI);
        scale = 1 + 0.4 * k;
        emissive = intensity + 1.2 * k;
      } else if (t >= 0.6) {
        emissive = intensity + 0.35; // stays lit while in blast set
      }
    } else {
      flashStart.current = null;
    }

    group.current.scale.lerp(new THREE.Vector3(scale, scale, scale), Math.min(1, delta * 10));
    mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, emissive * (dimmed ? 0.15 : 1), Math.min(1, delta * 8));
    mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, dimmed ? 0.12 : 1, Math.min(1, delta * 8));

    if (ring.current) {
      ring.current.rotation.z += delta * 1.5;
      const pulse = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 3);
      ring.current.scale.setScalar(pulse);
    }
  });

  return (
    <group position={position}>
      <group ref={group}>
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
          <Geometry nodeType={node.nodeType} complexity={node.complexity} />
          <meshStandardMaterial ref={mat} color="#0B1524" emissive={color} emissiveIntensity={intensity} roughness={0.4} metalness={0.5} transparent />
        </mesh>

        {/* Hotspot pulse ring (plan §10.2) */}
        {isHotspot && (
          <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.8, 0.04, 8, 40]} />
            <meshBasicMaterial color="#FF3B30" transparent opacity={0.5} />
          </mesh>
        )}
      </group>

      {(hovered || isOrigin) && !dimmed && (
        <Html distanceFactor={30} position={[0, 2.1, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="glass whitespace-nowrap px-2.5 py-1" style={{ borderRadius: 8 }}>
            <span className="font-mono text-[10px] text-arc-200">{node.nodeType}</span>{' '}
            <span className="text-[11px] font-medium text-white">{node.name}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
