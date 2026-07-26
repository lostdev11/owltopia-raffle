'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CapsuleCollider,
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from '@react-three/rapier'
import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import { PlaceholderOwl } from '@/components/race/PlaceholderOwl'
import { useRaceGameStore, type RaceMotionState } from '@/lib/race/store'

const SPAWN = { x: 0, y: 1.8, z: 7 }
const WALK_SPEED = 5.2
const SPRINT_SPEED = 9
const JUMP_SPEED = 7.2
const GLIDE_FALL_SPEED = -2.1
const STAMINA_SPRINT_DRAIN = 23
const STAMINA_GLIDE_DRAIN = 18
const STAMINA_REGEN = 16

const CAMERA_OFFSET = new Vector3(0, 3.1, 6.4)
const CAMERA_LOOK_OFFSET = new Vector3(0, 0.65, 0)
const Y_AXIS = new Vector3(0, 1, 0)

function resolveMotion(options: {
  grounded: boolean
  moving: boolean
  sprinting: boolean
  gliding: boolean
  verticalVelocity: number
}): RaceMotionState {
  if (options.gliding) return 'glide'
  if (!options.grounded) return options.verticalVelocity > 0.2 ? 'jump' : 'fall'
  if (options.sprinting) return 'sprint'
  if (options.moving) return 'run'
  return 'idle'
}

export function RaceController() {
  const body = useRef<RapierRigidBody>(null)
  const visual = useRef<Group>(null)
  const groundContacts = useRef(0)
  const facing = useRef(new Vector3(0, 0, -1))
  const cameraForward = useRef(new Vector3())
  const cameraRight = useRef(new Vector3())
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
    const grounded = state.grounded

    if (position.y < -8) {
      resetOwl()
      return
    }

    camera.getWorldDirection(cameraForward.current)
    cameraForward.current.y = 0
    if (cameraForward.current.lengthSq() < 0.001) {
      cameraForward.current.set(0, 0, -1)
    } else {
      cameraForward.current.normalize()
    }
    cameraRight.current
      .crossVectors(cameraForward.current, Y_AXIS)
      .normalize()

    const horizontal =
      Number(state.input.right) - Number(state.input.left)
    const vertical =
      Number(state.input.forward) - Number(state.input.backward)

    moveDirection.current
      .set(0, 0, 0)
      .addScaledVector(cameraForward.current, vertical)
      .addScaledVector(cameraRight.current, horizontal)

    const moving = moveDirection.current.lengthSq() > 0.001
    if (moving) {
      moveDirection.current.normalize()
      facing.current.lerp(moveDirection.current, 1 - Math.exp(-delta * 13)).normalize()
    }

    const sprinting =
      moving && grounded && state.input.sprint && state.stamina > 0.5
    const gliding =
      !grounded && state.input.glide && state.stamina > 0.5
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED
    const control = grounded ? 1 - Math.exp(-delta * 18) : 1 - Math.exp(-delta * 5)
    const targetX = moving ? moveDirection.current.x * speed : 0
    const targetZ = moving ? moveDirection.current.z * speed : 0

    let nextY = velocity.y
    if (state.consumeJump() && grounded) {
      nextY = JUMP_SPEED
      groundContacts.current = 0
      state.setGrounded(false)
    }
    if (gliding && nextY < GLIDE_FALL_SPEED) {
      nextY = MathUtils.lerp(nextY, GLIDE_FALL_SPEED, 1 - Math.exp(-delta * 9))
    }

    rigidBody.setLinvel(
      {
        x: MathUtils.lerp(velocity.x, targetX, control),
        y: nextY,
        z: MathUtils.lerp(velocity.z, targetZ, control),
      },
      true
    )

    if (moving) {
      targetRotation.current.setFromUnitVectors(
        new Vector3(0, 0, -1),
        facing.current
      )
      owlVisual.quaternion.slerp(
        targetRotation.current,
        1 - Math.exp(-delta * 16)
      )
    }

    const drain = sprinting
      ? STAMINA_SPRINT_DRAIN
      : gliding
        ? STAMINA_GLIDE_DRAIN
        : 0
    const staminaDelta =
      drain > 0 ? -drain * delta : grounded ? STAMINA_REGEN * delta : 0
    if (staminaDelta !== 0) state.setStamina(state.stamina + staminaDelta)

    state.setMotion(
      resolveMotion({
        grounded,
        moving,
        sprinting,
        gliding,
        verticalVelocity: nextY,
      })
    )

    desiredCamera.current
      .set(position.x, position.y, position.z)
      .addScaledVector(facing.current, CAMERA_OFFSET.z)
    desiredCamera.current.y += CAMERA_OFFSET.y
    camera.position.lerp(
      desiredCamera.current,
      1 - Math.exp(-delta * 7)
    )
    desiredLook.current
      .set(position.x, position.y, position.z)
      .add(CAMERA_LOOK_OFFSET)
    camera.lookAt(desiredLook.current)
  })

  const handleGroundEnter = () => {
    groundContacts.current += 1
    useRaceGameStore.getState().setGrounded(true)
  }

  const handleGroundExit = () => {
    groundContacts.current = Math.max(0, groundContacts.current - 1)
    if (groundContacts.current === 0) {
      useRaceGameStore.getState().setGrounded(false)
    }
  }

  return (
    <RigidBody
      ref={body}
      position={[SPAWN.x, SPAWN.y, SPAWN.z]}
      colliders={false}
      enabledRotations={[false, false, false]}
      canSleep={false}
      ccd
      friction={0}
      linearDamping={0.25}
    >
      <CapsuleCollider args={[0.48, 0.42]} position={[0, -0.02, 0]} />
      <CuboidCollider
        args={[0.28, 0.08, 0.28]}
        position={[0, -0.96, 0]}
        sensor
        onIntersectionEnter={handleGroundEnter}
        onIntersectionExit={handleGroundExit}
      />
      <group ref={visual}>
        <PlaceholderOwl />
      </group>
    </RigidBody>
  )
}
