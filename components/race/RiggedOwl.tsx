'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  Bone,
  Group,
  MathUtils,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useRaceGameStore, type RaceMotionState } from '@/lib/race/store'

const MODEL_URL = '/models/owltopia-owl-rigged.glb'
const MODEL_BASE_Y = -0.9

const X_AXIS = new Vector3(1, 0, 0)
const Z_AXIS = new Vector3(0, 0, 1)

const BONE_NAMES = [
  'Bone_015',
  'Bone_018',
  'Bone_019',
  'Bone_021',
  'Bone_022',
  'Bone_007',
  'Bone_011',
  'Bone_014',
] as const

type AnimatedBoneName = (typeof BONE_NAMES)[number]

type Rig = {
  scene: Group
  bones: Partial<Record<AnimatedBoneName, Bone>>
  rest: Partial<Record<AnimatedBoneName, Quaternion>>
}

function getFlightMotion(motion: RaceMotionState) {
  switch (motion) {
    case 'boost':
      return { speed: 15, amplitude: 0.62, tuck: -0.08 }
    case 'climb':
      return { speed: 11, amplitude: 0.54, tuck: 0.12 }
    case 'dive':
      return { speed: 4.5, amplitude: 0.12, tuck: -0.38 }
    case 'fly':
      return { speed: 9, amplitude: 0.44, tuck: 0 }
    default:
      return { speed: 5.5, amplitude: 0.24, tuck: 0.05 }
  }
}

export function RiggedOwl() {
  const { scene } = useGLTF(MODEL_URL)
  const root = useRef<Group>(null)
  const targetQuaternion = useRef(new Quaternion())
  const deltaQuaternion = useRef(new Quaternion())
  const motion = useRaceGameStore((state) => state.motion)

  const rig = useMemo<Rig>(() => {
    const clonedScene = clone(scene) as Group
    const bones: Rig['bones'] = {}
    const rest: Rig['rest'] = {}

    clonedScene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = true
        object.frustumCulled = false
      }

      if (
        object instanceof Bone &&
        BONE_NAMES.includes(object.name as AnimatedBoneName)
      ) {
        const name = object.name as AnimatedBoneName
        bones[name] = object
        rest[name] = object.quaternion.clone()
      }
    })

    return { scene: clonedScene, bones, rest }
  }, [scene])

  useFrame(({ clock }, delta) => {
    const model = root.current
    if (!model) return

    const flight = getFlightMotion(motion)
    const wave = Math.sin(clock.elapsedTime * flight.speed)
    const flap = wave * flight.amplitude + flight.tuck
    const blend = 1 - Math.exp(-delta * 15)

    const animateBone = (
      name: AnimatedBoneName,
      axis: Vector3,
      angle: number,
      smoothing = blend
    ) => {
      const bone = rig.bones[name]
      const rest = rig.rest[name]
      if (!bone || !rest) return

      deltaQuaternion.current.setFromAxisAngle(axis, angle)
      targetQuaternion.current.copy(rest).multiply(deltaQuaternion.current)
      bone.quaternion.slerp(targetQuaternion.current, smoothing)
    }

    // Shoulder and elbow chains become the owl's primary flight rig.
    animateBone('Bone_019', Z_AXIS, flap)
    animateBone('Bone_022', Z_AXIS, -flap)
    animateBone('Bone_018', Z_AXIS, flap * 0.34)
    animateBone('Bone_021', Z_AXIS, -flap * 0.34)

    const airborne = motion !== 'hover'
    const legTuck = airborne ? -0.28 : 0
    animateBone('Bone_007', X_AXIS, legTuck, 1 - Math.exp(-delta * 5))
    animateBone('Bone_011', X_AXIS, legTuck, 1 - Math.exp(-delta * 5))

    const tailPitch =
      motion === 'climb' ? 0.16 : motion === 'dive' ? -0.2 : 0
    animateBone('Bone_014', X_AXIS, tailPitch, 1 - Math.exp(-delta * 6))

    const headCounterPitch =
      motion === 'climb' ? 0.08 : motion === 'dive' ? -0.08 : 0
    animateBone('Bone_015', X_AXIS, headCounterPitch)

    const bobAmount = motion === 'boost' ? 0.015 : motion === 'hover' ? 0.045 : 0.025
    model.position.y =
      MODEL_BASE_Y + Math.sin(clock.elapsedTime * flight.speed * 0.5) * bobAmount
  })

  return (
    <group
      ref={root}
      position={[0, MODEL_BASE_Y, 0]}
      rotation={[0, Math.PI, 0]}
      scale={1.05}
    >
      <primitive object={rig.scene} />
    </group>
  )
}

useGLTF.preload(MODEL_URL)
