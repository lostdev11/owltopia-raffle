'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CapsuleCollider,
  RigidBody,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Group, MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { RiggedOwl } from '@/components/race/RiggedOwl'
import { useRaceGameStore, type RaceMotionState } from '@/lib/race/store'

const SPAWN = { x: 0, y: 5.5, z: 7 }
const CRUISE_SPEED = 10
const REVERSE_SPEED = 4
const BOOST_SPEED = 16
const TURN_SPEED = 2.45
const CLIMB_SPEED = 6.5
const DIVE_SPEED = -7
const ALTITUDE_FLOOR = 1.4
const STAMINA_BOOST_DRAIN = 24
const STAMINA_REGEN = 14

const CAMERA_HEIGHT = 2.65
const CAMERA_DISTANCE = 7.2
const CAMERA_LOOK_AHEAD = 4.5

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
  const yaw = useRef(0)
  const flightSpeed = useRef(0)
  const facing = useRef(new Vector3(0, 0, -1))
  const desiredCamera = useRef(new Vector3())
  const desiredLook = useRef(new Vector3())
  const { camera } = useThree()

  const resetOwl = useCallback(() => {
    const rigidBody = body.current
    if (!rigidBody) return
    rigidBody.setTranslation(SPAWN, true)
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    yaw.current = 0
    flightSpeed.current = 0
    facing.current.set(0, 0, -1)
    if (visual.current) visual.current.rotation.set(0, 0, 0)
    const state = useRaceGameStore.getState()
    state.resetInput()
    state.setStamina(100)
    state.setGrounded(false)
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

    const controlsEnabled = state.status === 'racing'
    const steer = controlsEnabled
      ? Number(state.input.left) - Number(state.input.right)
      : 0

    const speedRatio = MathUtils.clamp(
      Math.abs(flightSpeed.current) / CRUISE_SPEED,
      0,
      1.25
    )
    const turnAuthority = MathUtils.lerp(0.62, 1.15, speedRatio)
    yaw.current += steer * TURN_SPEED * turnAuthority * delta

    facing.current.set(
      -Math.sin(yaw.current),
      0,
      -Math.cos(yaw.current)
    )

    // Input names are inverted internally to match the placeholder model axis.
    // Player-facing controls remain W forward and S brake/reverse.
    const wantsForward =
      controlsEnabled && state.input.backward && !state.input.forward
    const wantsBackward =
      controlsEnabled && state.input.forward && !state.input.backward
    const boosting =
      wantsForward && state.input.sprint && state.stamina > 0.5
    const climbing = controlsEnabled && state.input.climb
    const diving = controlsEnabled && state.input.dive

    const targetSpeed = wantsForward
      ? boosting
        ? BOOST_SPEED
        : CRUISE_SPEED
      : wantsBackward
        ? -REVERSE_SPEED
        : 0
    const acceleration = boosting
      ? 5.5
      : wantsForward
        ? 3.8
        : wantsBackward
          ? 4.5
          : 1.15

    flightSpeed.current = MathUtils.lerp(
      flightSpeed.current,
      targetSpeed,
      1 - Math.exp(-delta * acceleration)
    )

    const targetX = facing.current.x * flightSpeed.current
    const targetZ = facing.current.z * flightSpeed.current

    let targetY = 0
    if (climbing && !diving) targetY = CLIMB_SPEED
    if (diving && !climbing) targetY = DIVE_SPEED
    if (position.y <= ALTITUDE_FLOOR && targetY < 0) targetY = 0

    const horizontalControl = 1 - Math.exp(-delta * (steer !== 0 ? 5.5 : 2.6))
    const verticalControl = 1 - Math.exp(-delta * (climbing || diving ? 5 : 2))

    rigidBody.setLinvel(
      {
        x: MathUtils.lerp(velocity.x, targetX, horizontalControl),
        y: MathUtils.lerp(velocity.y, targetY, verticalControl),
        z: MathUtils.lerp(velocity.z, targetZ, horizontalControl),
      },
      true
    )

    const targetPitch = climbing ? -0.3 : diving ? 0.34 : 0
    const targetBank = steer * 0.48
    owlVisual.rotation.x = MathUtils.lerp(
      owlVisual.rotation.x,
      targetPitch,
      1 - Math.exp(-delta * 7)
    )
    owlVisual.rotation.y = yaw.current
    owlVisual.rotation.z = MathUtils.lerp(
      owlVisual.rotation.z,
      targetBank,
      1 - Math.exp(-delta * 8)
    )

    const staminaDelta = boosting
      ? -STAMINA_BOOST_DRAIN * delta
      : STAMINA_REGEN * delta
    if (boosting || state.stamina < 100) {
      state.setStamina(state.stamina + staminaDelta)
    }

    const moving = Math.abs(flightSpeed.current) > 0.35
    state.setGrounded(false)
    state.setMotion(
      resolveMotion({ moving, boosting, climbing, diving })
    )

    const dynamicDistance =
      CAMERA_DISTANCE + Math.abs(flightSpeed.current) * 0.12 + (boosting ? 1.2 : 0)
    const dynamicHeight = CAMERA_HEIGHT + (climbing ? 0.35 : diving ? -0.2 : 0)

    desiredCamera.current
      .set(position.x, position.y + dynamicHeight, position.z)
      .addScaledVector(facing.current, -dynamicDistance)
      .addScaledVector(
        new Vector3(facing.current.z, 0, -facing.current.x),
        steer * 0.55
      )
    camera.position.lerp(
      desiredCamera.current,
      1 - Math.exp(-delta * 5)
    )

    desiredLook.current
      .set(position.x, position.y + 0.45, position.z)
      .addScaledVector(facing.current, CAMERA_LOOK_AHEAD + speedRatio)
    camera.lookAt(desiredLook.current)

    if (camera instanceof PerspectiveCamera) {
      const targetFov = boosting ? 65 : moving ? 58 : 55
      camera.fov = MathUtils.lerp(
        camera.fov,
        targetFov,
        1 - Math.exp(-delta * 4)
      )
      camera.updateProjectionMatrix()
    }
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
      linearDamping={0.16}
    >
      <CapsuleCollider args={[0.64, 0.52]} position={[0, 0, 0]} />
      <group ref={visual}>
        <RiggedOwl />
      </group>
    </RigidBody>
  )
}
