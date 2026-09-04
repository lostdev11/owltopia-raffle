'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  PACK_VAULT_SLOT_COUNT,
  SELECTOR_ANGLE,
  anglePerPack,
  angularDistance,
  buildVaultPacks,
  nearestIndex,
  shortestDelta,
  shortestIndexDelta,
  snapRotation,
  wrapIndex,
} from '@/lib/packs/vault-wheel'

const SLOP_PX = 10
const RING_RATIO = 0.4
const MAX_COAST_SLOTS = 3
const SNAP_STIFFNESS = 260
const SNAP_DAMPING = 26
const VELOCITY_IDLE = 48
const HORIZ_DEG_PER_PX = 0.4
const COAST_LOOKAHEAD_S = 0.14
const SLOT_IMPULSE = 140

type AnimMode = 'idle' | 'drag' | 'snap'

function pointerPolar(clientX: number, clientY: number, rect: DOMRect) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  return {
    dist: Math.hypot(dx, dy),
    angle: Math.atan2(dx, -dy) * (180 / Math.PI),
    radius: Math.min(rect.width, rect.height) / 2,
  }
}

function unwrapDelta(from: number, to: number) {
  let d = to - from
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export function usePackWheel(opts: {
  packCount?: number
  locked: boolean
  reducedMotion: boolean
}) {
  const packCount = opts.packCount ?? PACK_VAULT_SLOT_COUNT
  const packs = buildVaultPacks(packCount)
  const locked = opts.locked
  const reducedMotion = opts.reducedMotion

  const wheelRef = useRef<HTMLDivElement | null>(null)
  const surfaceNodeRef = useRef<HTMLDivElement | null>(null)
  const rotationRef = useRef(snapRotation(0, packCount))
  const velocityRef = useRef(0)
  const modeRef = useRef<AnimMode>('idle')
  const snapTargetRef = useRef(snapRotation(0, packCount))
  const rafRef = useRef(0)
  const lastTsRef = useRef(0)
  const selectedIndexRef = useRef(0)
  const targetIndexRef = useRef(0)
  const flashTimerRef = useRef(0)
  const lockedRef = useRef(locked)
  const reducedRef = useRef(reducedMotion)
  const packCountRef = useRef(packCount)
  const wasLockedRef = useRef(false)

  const pendingRef = useRef(false)
  const capturedRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const lastAngleRef = useRef(0)
  const lastXRef = useRef(0)
  const lastYRef = useRef(0)
  const lastMoveTsRef = useRef(0)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const dragMovedRef = useRef(false)
  const useAngularRef = useRef(false)

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [selectorLit, setSelectorLit] = useState(false)
  const [idTick, setIdTick] = useState(0)

  useEffect(() => {
    lockedRef.current = locked
    reducedRef.current = reducedMotion
    packCountRef.current = packCount
  }, [locked, reducedMotion, packCount])

  const applyWheel = useCallback(() => {
    const el = wheelRef.current
    if (!el) return
    const rot = rotationRef.current
    const n = packCountRef.current
    const step = anglePerPack(n)
    el.style.transform = `rotate(${rot}deg)`
    el.style.setProperty('--wheel-rotation', `${rot}deg`)

    const slots = el.querySelectorAll<HTMLElement>('[data-vault-slot]')
    const span = step * 1.5
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      if (!slot) continue
      const index = Number(slot.dataset.vaultSlot)
      const world = rot + index * step
      const dist = angularDistance(world, SELECTOR_ANGLE)
      const p = span <= 0 ? 1 : Math.max(0, Math.min(1, 1 - dist / span))
      slot.style.setProperty('--p', String(p))
    }
  }, [])

  const flashSelector = useCallback(() => {
    setSelectorLit(true)
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setSelectorLit(false), 260)
  }, [])

  const commitIndex = useCallback(
    (index: number) => {
      const n = packCountRef.current
      const idx = wrapIndex(index, n)
      if (selectedIndexRef.current !== idx) {
        selectedIndexRef.current = idx
        setSelectedIndex(idx)
        flashSelector()
        setIdTick((t) => t + 1)
        // onSelectionTick: haptic/audio hook point — do not call navigator.vibrate here.
      }
      targetIndexRef.current = idx
    },
    [flashSelector]
  )

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  const startRaf = useCallback(() => {
    if (rafRef.current) return
    lastTsRef.current = 0

    const step = (now: number) => {
      const last = lastTsRef.current || now
      const dt = Math.min(0.032, (now - last) / 1000)
      lastTsRef.current = now

      if (modeRef.current === 'snap') {
        const target = snapTargetRef.current
        if (reducedRef.current) {
          rotationRef.current = target
          velocityRef.current = 0
          modeRef.current = 'idle'
        } else {
          const disp = rotationRef.current - target
          const acc = -SNAP_STIFFNESS * disp - SNAP_DAMPING * velocityRef.current
          velocityRef.current += acc * dt
          rotationRef.current += velocityRef.current * dt
          if (Math.abs(disp) < 0.06 && Math.abs(velocityRef.current) < 4) {
            rotationRef.current = target
            velocityRef.current = 0
            modeRef.current = 'idle'
          }
        }
      }

      applyWheel()

      if (modeRef.current === 'drag') {
        commitIndex(nearestIndex(rotationRef.current, packCountRef.current))
      }

      if (modeRef.current !== 'idle') {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = 0
      }
    }

    rafRef.current = requestAnimationFrame(step)
  }, [applyWheel, commitIndex])

  const rotateToIndex = useCallback(
    (index: number) => {
      const n = packCountRef.current
      if (n <= 0) return
      const idx = wrapIndex(index, n)
      commitIndex(idx)
      const current = rotationRef.current
      const target = current + shortestDelta(current, snapRotation(idx, n))
      snapTargetRef.current = target
      modeRef.current = 'snap'
      if (reducedRef.current) {
        velocityRef.current = 0
        rotationRef.current = target
        applyWheel()
        modeRef.current = 'idle'
        stopRaf()
        return
      }
      startRaf()
    },
    [applyWheel, commitIndex, startRaf, stopRaf]
  )

  const endGesture = useCallback(
    (surface: HTMLDivElement | null) => {
      const pid = pointerIdRef.current
      const wasCaptured = capturedRef.current
      capturedRef.current = false
      pendingRef.current = false
      pointerIdRef.current = null
      if (pid != null && surface) {
        try {
          if (surface.hasPointerCapture(pid)) {
            surface.releasePointerCapture(pid)
          }
        } catch {
          // already released
        }
      }
      if (surface) surface.style.touchAction = 'pan-y'
      setIsDragging(false)

      if (!wasCaptured) return

      if (lockedRef.current) {
        rotateToIndex(targetIndexRef.current)
        return
      }

      const n = packCountRef.current
      const releaseIdx = nearestIndex(rotationRef.current, n)
      let extra = 0
      if (!reducedRef.current && Math.abs(velocityRef.current) > VELOCITY_IDLE) {
        const projected = rotationRef.current + velocityRef.current * COAST_LOOKAHEAD_S
        const projectedIdx = nearestIndex(projected, n)
        extra = shortestIndexDelta(releaseIdx, projectedIdx, n)
        const fromImpulse = Math.round(velocityRef.current / -SLOT_IMPULSE)
        if (Math.abs(fromImpulse) > Math.abs(extra)) extra = fromImpulse
        extra = Math.max(-MAX_COAST_SLOTS, Math.min(MAX_COAST_SLOTS, extra))
      }
      rotateToIndex(releaseIdx + extra)
    },
    [rotateToIndex]
  )

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (lockedRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pendingRef.current = true
    capturedRef.current = false
    dragMovedRef.current = false
    pointerIdRef.current = e.pointerId
    surfaceNodeRef.current = e.currentTarget
    startXRef.current = e.clientX
    startYRef.current = e.clientY
    lastXRef.current = e.clientX
    lastYRef.current = e.clientY
    lastMoveTsRef.current = e.timeStamp
    velocityRef.current = 0

    const rect = e.currentTarget.getBoundingClientRect()
    const polar = pointerPolar(e.clientX, e.clientY, rect)
    lastAngleRef.current = polar.angle
    useAngularRef.current = polar.dist > polar.radius * RING_RATIO
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return
      if (!pendingRef.current && !capturedRef.current) return
      if (lockedRef.current) return

      const dxFromStart = e.clientX - startXRef.current
      const dyFromStart = e.clientY - startYRef.current
      const distFromStart = Math.hypot(dxFromStart, dyFromStart)

      if (!capturedRef.current) {
        if (distFromStart < SLOP_PX) return
        if (Math.abs(dyFromStart) > Math.abs(dxFromStart) * 1.2 && Math.abs(dyFromStart) > SLOP_PX) {
          pendingRef.current = false
          pointerIdRef.current = null
          return
        }
        capturedRef.current = true
        dragMovedRef.current = true
        modeRef.current = 'drag'
        setIsDragging(true)
        e.currentTarget.style.touchAction = 'none'
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // capture optional
        }
        stopRaf()
      }

      const rect = e.currentTarget.getBoundingClientRect()
      const polar = pointerPolar(e.clientX, e.clientY, rect)
      const now = e.timeStamp
      const dt = Math.max(8, now - lastMoveTsRef.current) / 1000

      let dRot = 0
      if (useAngularRef.current && polar.dist > polar.radius * RING_RATIO * 0.75) {
        dRot = unwrapDelta(lastAngleRef.current, polar.angle)
      } else {
        dRot = -(e.clientX - lastXRef.current) * HORIZ_DEG_PER_PX
      }

      rotationRef.current += dRot
      const instVel = dRot / dt
      velocityRef.current = velocityRef.current * 0.65 + instVel * 0.35

      lastAngleRef.current = polar.angle
      lastXRef.current = e.clientX
      lastYRef.current = e.clientY
      lastMoveTsRef.current = now

      applyWheel()
      commitIndex(nearestIndex(rotationRef.current, packCountRef.current))
    },
    [applyWheel, commitIndex, stopRaf]
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return
      const wasCaptured = capturedRef.current
      if (!wasCaptured && !pendingRef.current) return
      if (!wasCaptured) {
        pendingRef.current = false
        pointerIdRef.current = null
        return
      }
      endGesture(e.currentTarget)
    },
    [endGesture]
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return
      endGesture(e.currentTarget)
    },
    [endGesture]
  )

  const onLostPointerCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return
      if (!capturedRef.current) return
      endGesture(e.currentTarget)
    },
    [endGesture]
  )

  const onSlotSelect = useCallback(
    (index: number) => {
      if (lockedRef.current) return
      if (dragMovedRef.current) return
      velocityRef.current = 0
      rotateToIndex(index)
    },
    [rotateToIndex]
  )

  useLayoutEffect(() => {
    applyWheel()
  }, [applyWheel, packCount])

  useEffect(() => {
    return () => {
      stopRaf()
      window.clearTimeout(flashTimerRef.current)
    }
  }, [stopRaf])

  useEffect(() => {
    const becameLocked = locked && !wasLockedRef.current
    wasLockedRef.current = locked
    if (!becameLocked) return
    if (capturedRef.current) {
      endGesture(surfaceNodeRef.current)
    } else {
      rotateToIndex(targetIndexRef.current)
    }
  }, [endGesture, locked, rotateToIndex])

  return {
    packs,
    packCount,
    selectedIndex,
    isDragging,
    selectorLit,
    idTick,
    rotateToIndex,
    onSlotSelect,
    wheelRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  }
}
