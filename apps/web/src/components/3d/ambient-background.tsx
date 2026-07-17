'use client';
import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* Vertex shader — particles drift with perlin-like noise */
const VERT = /* glsl */ `
  uniform float uTime;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec3  aOffset;
  varying float   vAlpha;

  void main() {
    vec3 pos = position + aOffset;
    pos.x += sin(uTime * aSpeed + pos.z * 0.4) * 1.2;
    pos.y += cos(uTime * aSpeed * 0.7 + pos.x * 0.3) * 0.9;
    pos.z += sin(uTime * aSpeed * 0.5 + pos.y * 0.5) * 0.6;

    vAlpha = 0.3 + 0.5 * abs(sin(uTime * aSpeed * 0.3 + pos.x));

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

/* Fragment shader — soft round glow dot */
const FRAG = /* glsl */ `
  uniform vec3  uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = (1.0 - d * 2.0) * vAlpha;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function ParticleField({ count = 2400, color = '#0D8BFF' }: { count?: number; color?: string }) {
  const mat = useRef<THREE.ShaderMaterial>(null);

  const [positions, speeds, sizes, offsets] = useMemo(() => {
    const pos  = new Float32Array(count * 3);
    const spd  = new Float32Array(count);
    const sz   = new Float32Array(count);
    const off  = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 100;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120 - 30;
      spd[i] = 0.08 + Math.random() * 0.18;
      sz[i]  = 0.6 + Math.random() * 1.4;
      off[i * 3]     = (Math.random() - 0.5) * 4;
      off[i * 3 + 1] = (Math.random() - 0.5) * 4;
      off[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    return [pos, spd, sz, off];
  }, [count]);

  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uTime.value = clock.elapsedTime;
  });

  const col = new THREE.Color(color);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSpeed"   args={[speeds,    1]} />
        <bufferAttribute attach="attributes-aSize"    args={[sizes,     1]} />
        <bufferAttribute attach="attributes-aOffset"  args={[offsets,   3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTime: { value: 0 }, uColor: { value: col } }}
      />
    </points>
  );
}

/* Neural network mesh — animated nodes + connecting lines */
function NeuralMesh({ nodeCount = 55 }: { nodeCount?: number }) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const nodeRef = useRef<THREE.Points>(null);

  const { nodePos, linePos } = useMemo(() => {
    const nodePos: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const r = 30 + Math.random() * 50;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      nodePos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi) * 0.4);
    }
    const linePos: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dx = nodePos[i*3] - nodePos[j*3], dy = nodePos[i*3+1] - nodePos[j*3+1], dz = nodePos[i*3+2] - nodePos[j*3+2];
        if (Math.sqrt(dx*dx+dy*dy+dz*dz) < 28) {
          linePos.push(nodePos[i*3], nodePos[i*3+1], nodePos[i*3+2]);
          linePos.push(nodePos[j*3], nodePos[j*3+1], nodePos[j*3+2]);
        }
      }
    }
    return { nodePos: new Float32Array(nodePos), linePos: new Float32Array(linePos) };
  }, [nodeCount]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.12;
    if (lineRef.current) lineRef.current.rotation.y = t;
    if (nodeRef.current) nodeRef.current.rotation.y = t;
  });

  return (
    <group>
      <lineSegments ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#0D8BFF" transparent opacity={0.10} />
      </lineSegments>
      <points ref={nodeRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePos, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#22D3EE" size={1.2} transparent opacity={0.6} sizeAttenuation />
      </points>
    </group>
  );
}

/* Rendered at z=0 opacity-30 behind all other content */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" style={{ opacity: 0.35 }}>
      <Canvas
        camera={{ position: [0, 0, 80], fov: 65 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
        dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
      >
        <fog attach="fog" args={['#05070A', 100, 220]} />
        <ParticleField count={2000} color="#0D8BFF" />
        <ParticleField count={600}  color="#A855F7" />
        <ParticleField count={300}  color="#22D3EE" />
        <NeuralMesh nodeCount={50} />
      </Canvas>
    </div>
  );
}
