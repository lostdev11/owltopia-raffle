'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useRaceGameStore } from '@/lib/race/store'

export function PlaceholderOwl() {
  const wings = useRef<Group>(null)
  const motion = useRaceGameStore((state) => state.motion)

  useFrame(({ clock }) => {
    if (!wings.current) return
    const active = motion === 'glide' || motion === 'jump'
    const flap = active ? Math.sin(clock.elapsedTime * 10) * 0.18 : 0
    wings.current.rotation.z = flap
  })

  const bodyBounce =
    motion === 'run' ? 0.02 : motion === 'sprint' ? 0.04 : 0

  return (
    <group position={[0, -0.18 + bodyBounce, 0]}>
      <mesh castShadow position={[0, 0.16, 0]}>
        <sphereGeometry args={[0.58, 20, 16]} />
        <meshStandardMaterial color="#70523d" roughness={0.82} />
      </mesh>
      <mesh castShadow position={[0, 0.78, -0.02]}>
        <sphereGeometry args={[0.43, 20, 16]} />
        <meshStandardMaterial color="#8b684c" roughness={0.8} />
      </mesh>

      <group ref={wings}>
        <mesh castShadow position={[-0.62, 0.24, 0]} rotation={[0, 0, 0.28]}>
          <capsuleGeometry args={[0.22, 0.7, 8, 16]} />
          <meshStandardMaterial color="#4d372c" roughness={0.9} />
        </mesh>
        <mesh castShadow position={[0.62, 0.24, 0]} rotation={[0, 0, -0.28]}>
          <capsuleGeometry args={[0.22, 0.7, 8, 16]} />
          <meshStandardMaterial color="#4d372c" roughness={0.9} />
        </mesh>
      </group>

      <mesh castShadow position={[-0.17, 0.86, -0.37]}>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#f2f4dd" />
      </mesh>
      <mesh castShadow position={[0.17, 0.86, -0.37]}>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#f2f4dd" />
      </mesh>
      <mesh position={[-0.17, 0.87, -0.48]}>
        <sphereGeometry args={[0.055, 12, 8]} />
        <meshStandardMaterial color="#10100f" />
      </mesh>
      <mesh position={[0.17, 0.87, -0.48]}>
        <sphereGeometry args={[0.055, 12, 8]} />
        <meshStandardMaterial color="#10100f" />
      </mesh>
      <mesh castShadow position={[0, 0.72, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.1, 0.28, 4]} />
        <meshStandardMaterial color="#f2a93b" roughness={0.7} />
      </mesh>

      <mesh castShadow position={[-0.22, -0.4, -0.03]}>
        <capsuleGeometry args={[0.045, 0.24, 6, 10]} />
        <meshStandardMaterial color="#dd9a38" />
      </mesh>
      <mesh castShadow position={[0.22, -0.4, -0.03]}>
        <capsuleGeometry args={[0.045, 0.24, 6, 10]} />
        <meshStandardMaterial color="#dd9a38" />
      </mesh>
    </group>
  )
}
