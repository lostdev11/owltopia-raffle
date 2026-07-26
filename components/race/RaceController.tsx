'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CapsuleCollider,
  RigidBody,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import { PlaceholderOwl } from '@/components/race/PlaceholderOwl'
import { useRaceGameStore, type RaceMotionState } from '@/lib/race/store'

const SPAWN = { x: 0, y: 5.5, z: 7 }
const CRUISE_SPEED = 8
const REVERSE_SPEED = 3
const BOOST_SPEED = 14
const TURN_SPEED = 1.9
const CLIMB_SPEED = 5.5
const DIVE_SPEED = -5.5
const ALTITUDE_FLOOR = 1.4
const STAMINA_BOOST_DRAIN = 24
const STAMINA_REGEN = 14

const CAMERA_HEIGHT = 2.6
const CAMERA_DISTANCE = 7.5
const CAMERA_LOOK_AHEAD = 4
const FORWARD = new Vector3(0, 0, -1)
const Y_AXIS = new Vector3(0, 1, 0)

function resolveMotion(options: {
  moving: boolean
  boosting: boolean
  climbing: boolean
  diving: boolean
}): RaceMotionState {
  if (options.boosting) return 'boost'
  if (options.climbing) return 'climb'
  if (options.diving) return 'dive'
  if (options.moving) return 'fly'
  return 'hover'
}

export function RaceController() {
  const body = useRef<RapierRigidBody>(null)
  const visual = useRef<Group>(null)
  const facing = useRef(new Vector3(0, 0, -1))
  const moveDirection = useRef(new Vector3())
  const desiredCamera = useRef(new Vector3())
  const desiredLook = useRef(new Vector3())
  const targetRotation = useRef(new Quaternion())
  const { camera } = useThree()

  const resetOwl = useCallback(() => {
    const rigidBody = body.current
    if (!rigidBody) return
    rigidBody.setTranslation(SPAWN, true)
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    facing.current.set(0, 0, -1)
    useRaceGameStore.getState().setStamina(100)
    useRaceGameStore.getState().setGrounded(false)
  }, [])

  useEffect(() => {
    const onReset = () => resetOwl()
    window.addEventListener('owl-race-reset', onReset)
    return () => window.removeEventListener('owl-race-reset', onReset)
  }, [resetOwl])

  useFrame((_, delta) => {
    const rigidBody = body.current
    const owlVisual = visual.current
    if (!rigidBody || !owlVisual) return

    const state = useRaceGameStore.getState()
    const position = rigidBody.translation()
    const velocity = rigidBody.linvel()

    if (position.y < -8) {
      resetOwl()
      return
    }

    const steer = Number(state.input.left) - Number(state.input.right)
    if (steer !== 0) {
      facing.current
        .applyAxisAngle(Y_AXIS, steer * TURN_SPEED * delta)
        .normalize()
    }

    const throttle =
      Number(state.input.forward) - Number(state.input.backward)
    const moving = throttle !== 0
    const boosting =
      throttle > 0 && state.input.sprint && state.stamina > 0.5
    const climbing = state.input.climb
    const diving = state.input.dive

    const speed =
      throttle > 0
        ? boosting
          ? BOOST_SPEED
          : CRUISE_SPEED
        : throttle < 0
          ? REVERSE_SPEED
          : 0

    moveDirection.current
      .copy(facing.current)
      .multiplyScalar(speed * Math.sign(throttle))

    let targetY = 0
    if (climbing && !diving) targetY = CLIMB_SPEED
    if (diving && !climbing) targetY = DIVE_SPEED
    if (position.y <= ALTITUDE_FLOOR && targetY < 0) targetY = 0

    const horizontalControl = 1 - Math.exp(-delta * 7)
    const verticalControl = 1 - Math.exp(-delta * 8)

    rigidBody.setLinvel(
      {
        x: MathUtils.lerp(velocity.x, moveDirection.current.x, horizontalControl),
        y: MathUtils.lerp(velocity.y, targetY, verticalControl),
        z: MathUtils.lerp(velocity.z, moveDirection.current.z, horizontalControl),
      },
      true
    )

    targetRotation.current.setFromUnitVectors(FORWARD, facing.current)
    owlVisual.quaternion.slerp(
      targetRotation.current,
      1 - Math.exp(-delta * 12)
    )

    const staminaDelta = boosting
      ? -STAMINA_BOOST_DRAIN * delta
      : STAMINA_REGEN * delta
    state.setStamina(state.stamina + staminaDelta)
    state.setGrounded(false)
    state.setMotion(
      resolveMotion({ moving, boosting, climbing, diving })
    )

    desiredCamera.current
      .set(position.x, position.y + CAMERA_HEIGHT, position.z)
      .addScaledVector(facing.current, -CAMERA_DISTANCE)
    camera.position.lerp(
      desiredCamera.current,
      1 - Math.exp(-delta * 6)
    )

    desiredLook.current
      .set(position.x, position.y + 0.45, position.z)
      .addScaledVector(facing.current, CAMERA_LOOK_AHEAD)
    camera.lookAt(desiredLook.current)
  })

  return (
    <RigidBody
      ref={body}
      position={[SPAWN.x, SPAWN.y, SPAWN.z]}
      colliders={false}
      enabledRotations={[false, false, false]}
      gravityScale={0}
      canSleep={false}
      ccd
      friction={0}
      linearDamping={0.35}
    >
      <CapsuleCollider args={[0.48, 0.42]} position={[0, -0.02, 0]} />
      <group ref={visual}>
        <PlaceholderOwl />
      </group>
    </RigidBody>
  )
}
