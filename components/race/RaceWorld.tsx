'use client'

import { Environment, Stars } from '@react-three/drei'
import {
  CuboidCollider,
  Physics,
  RigidBody,
} from '@react-three/rapier'
import { RaceController } from '@/components/race/RaceController'

function CourseBlock({
  position,
  size,
  color,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  rotation?: [number, number, number]
}) {
  return (
    <RigidBody type="fixed" colliders={false} position={position} rotation={rotation}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.88} />
      </mesh>
    </RigidBody>
  )
}

function GrayBoxCourse() {
  return (
    <>
      <CourseBlock
        position={[0, -0.5, -12]}
        size={[18, 1, 42]}
        color="#294a32"
      />
      <CourseBlock
        position={[-6.5, 0.9, -7]}
        size={[1.1, 2.8, 8]}
        color="#5e4938"
      />
      <CourseBlock
        position={[6.5, 0.65, -13]}
        size={[1.2, 2.3, 9]}
        color="#5e4938"
      />
      <CourseBlock
        position={[-3.5, 0.35, -18]}
        size={[5, 0.7, 3]}
        color="#526b50"
      />
      <CourseBlock
        position={[3.7, 0.75, -23]}
        size={[4, 1.5, 3]}
        color="#526b50"
      />
      <CourseBlock
        position={[0, 1.05, -29]}
        size={[8, 0.6, 5]}
        color="#47704c"
        rotation={[-0.18, 0, 0]}
      />
      <CourseBlock
        position={[0, 0.1, -34]}
        size={[12, 0.2, 0.5]}
        color="#58d481"
      />

      {Array.from({ length: 16 }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1
        const z = 5 - Math.floor(index / 2) * 5
        return (
          <group key={`${side}-${z}`} position={[side * 8, 0, z]}>
            <mesh castShadow position={[0, 1.25, 0]}>
              <cylinderGeometry args={[0.34, 0.48, 2.5, 8]} />
              <meshStandardMaterial color="#594331" roughness={0.9} />
            </mesh>
            <mesh castShadow position={[0, 3.1, 0]}>
              <coneGeometry args={[1.8, 3.8, 9]} />
              <meshStandardMaterial color="#1f5b34" roughness={0.9} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

export function RaceWorld() {
  return (
    <>
      <color attach="background" args={['#07120d']} />
      <fog attach="fog" args={['#07120d', 22, 72]} />
      <ambientLight intensity={0.75} />
      <directionalLight
        castShadow
        position={[10, 18, 8]}
        intensity={2.4}
        color="#d8ffe1"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Stars radius={90} depth={35} count={900} factor={2.4} fade speed={0.2} />
      <Physics gravity={[0, -18, 0]} timeStep="vary">
        <GrayBoxCourse />
        <RaceController />
      </Physics>
      <Environment preset="forest" environmentIntensity={0.35} />
    </>
  )
}
