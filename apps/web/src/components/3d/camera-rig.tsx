'use client';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

/**
 * Cinematic camera controller (plan §9.5 / §12). Damped fly-to in plain
 * useFrame math — the plan's Theatre.js sequences were never authored, and a
 * critically-damped lerp gives the same 800ms glide with zero bundle cost.
 *
 * Set `focus` to a world position to fly toward it (camera keeps a distance
 * offset); set to null to release control back to the user's OrbitControls.
 */
export function CameraRig({
  focus,
  controlsRef,
  distance = 14,
}: {
  focus: [number, number, number] | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  distance?: number;
}) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!focus) return;
    targetLook.current.set(...focus);

    // Approach point: offset back along the camera→focus direction.
    const dir = camera.position.clone().sub(targetLook.current).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0, 0.3, 1).normalize();
    targetPos.current.copy(targetLook.current).addScaledVector(dir, distance);

    const t = Math.min(1, delta * 3.2); // ~800ms glide
    camera.position.lerp(targetPos.current, t);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.lerp(targetLook.current, t);
      controls.update();
    } else {
      camera.lookAt(targetLook.current);
    }
  });

  return null;
}
