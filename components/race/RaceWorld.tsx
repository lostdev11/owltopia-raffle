'use client'

import { Environment, Float, Stars } from '@react-three/drei'
import {
  CuboidCollider,
  Physics,
  RigidBody,
} from '@react-three/rapier'
import { RaceController } from '@/components/race/RaceController'
import { useRaceGameStore } from '@/lib/race/store'

const CHECKPOINTS: Array<{
  position: [number, number, number]
  label: string
}> = [
  { position: [0, 5.5, 0], label: '1' },
  { position: [-2.5, 6.2, -8], label: '2' },
  { position: [2.8, 4.6, -16], label: '3' },
  { position: [-2.2, 7.2, -25], label: '4' },
  { position: [0, 5.2, -34], label: 'FINISH' },
]

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

function CheckpointGate({
  index,
  position,
  label,
}: {
  index: number
  position: [number, number, number]
  label: string
}) {
  const status = useRaceGameStore((state) => state.status)
  const currentCheckpoint = useRaceGameStore(
    (state) => state.currentCheckpoint
  )
  const crossCheckpoint = useRaceGameStore(
    (state) => state.crossCheckpoint
  )

  const cleared = currentCheckpoint > index
  const active = status === 'racing' && currentCheckpoint === index
  const color = cleared ? '#24553b' : active ? '#8cff65' : '#64748b'
  const emissive = active ? '#22c55e' : cleared ? '#123b28' : '#111827'

  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CuboidCollider
        args={[2.15, 2.15, 0.3]}
        sensor
        onIntersectionEnter={() => crossCheckpoint(index)}
      />
      <Float speed={active ? 2.2 : 1} rotationIntensity={0} floatIntensity={0.12}>
        <mesh castShadow>
          <torusGeometry args={[2.15, 0.2, 12, 48]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={active ? 2.5 : 0.45}
            roughness={0.35}
            metalness={0.25}
          />
        </mesh>
        <mesh position={[0, 2.75, 0]}>
          <planeGeometry args={[label === 'FINISH' ? 2.8 : 0.9, 0.75]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
        {active ? (
          <pointLight color="#65ff8b" intensity={8} distance={9} />
        ) : null}
      </Float>
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

      {CHECKPOINTS.map((checkpoint, index) => (
        <CheckpointGate
          key={checkpoint.label}
          index={index}
          position={checkpoint.position}
          label={checkpoint.label}
        />
      ))}

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
