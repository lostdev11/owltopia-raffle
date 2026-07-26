'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useRaceGameStore } from '@/lib/race/store'

export function PlaceholderOwl() {
  const leftWing = useRef<Group>(null)
  const rightWing = useRef<Group>(null)
  const owl = useRef<Group>(null)
  const motion = useRaceGameStore((state) => state.motion)

  useFrame(({ clock }) => {
    if (!leftWing.current || !rightWing.current || !owl.current) return

    const flapSpeed = motion === 'boost' ? 16 : motion === 'hover' ? 8 : 12
    const flapAmount = motion === 'dive' ? 0.16 : 0.48
    const flap = Math.sin(clock.elapsedTime * flapSpeed) * flapAmount
    leftWing.current.rotation.z = 0.35 + flap
    rightWing.current.rotation.z = -0.35 - flap
    owl.current.position.y = Math.sin(clock.elapsedTime * 5) * 0.035
    owl.current.rotation.x =
      motion === 'climb' ? -0.2 : motion === 'dive' ? 0.22 : 0
  })

  return (
    <group ref={owl} position={[0, -0.18, 0]}>
      <mesh castShadow position={[0, 0.16, 0]}>
        <sphereGeometry args={[0.58, 20, 16]} />
        <meshStandardMaterial color="#70523d" roughness={0.82} />
      </mesh>
      <mesh castShadow position={[0, 0.78, -0.02]}>
        <sphereGeometry args={[0.43, 20, 16]} />
        <meshStandardMaterial color="#8b684c" roughness={0.8} />
      </mesh>

      <group ref={leftWing}>
        <mesh castShadow position={[-0.66, 0.25, 0]}>
          <capsuleGeometry args={[0.22, 0.78, 8, 16]} />
          <meshStandardMaterial color="#4d372c" roughness={0.9} />
        </mesh>
      </group>
      <group ref={rightWing}>
        <mesh castShadow position={[0.66, 0.25, 0]}>
          <capsuleGeometry args={[0.22, 0.78, 8, 16]} />
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
