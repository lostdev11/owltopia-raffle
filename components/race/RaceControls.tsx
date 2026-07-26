'use client'

import { useCallback, useEffect } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RotateCcw,
  Wind,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRaceGameStore } from '@/lib/race/store'

const KEY_BINDINGS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'glide',
} as const

type InputKey = (typeof KEY_BINDINGS)[keyof typeof KEY_BINDINGS]

function ControlButton({
  label,
  input,
  children,
}: {
  label: string
  input: InputKey
  children: React.ReactNode
}) {
  const setInput = useRaceGameStore((state) => state.setInput)

  const setPressed = useCallback(
    (pressed: boolean) => setInput(input, pressed),
    [input, setInput]
  )

  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-12 w-12 touch-none select-none items-center justify-center rounded-xl border border-white/20 bg-black/65 text-white shadow-lg backdrop-blur active:scale-95 active:bg-emerald-500/35"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setPressed(true)
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onLostPointerCapture={() => setPressed(false)}
    >
      {children}
    </button>
  )
}

export function RaceControls() {
  const resetInput = useRaceGameStore((state) => state.resetInput)
  const setInput = useRaceGameStore((state) => state.setInput)
  const queueJump = useRaceGameStore((state) => state.queueJump)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        if (!event.repeat) queueJump()
        return
      }

      const input = KEY_BINDINGS[event.code as keyof typeof KEY_BINDINGS]
      if (input) {
        event.preventDefault()
        setInput(input, true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const input = KEY_BINDINGS[event.code as keyof typeof KEY_BINDINGS]
      if (input) setInput(input, false)
    }

    const onBlur = () => resetInput()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      resetInput()
    }
  }, [queueJump, resetInput, setInput])

  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 left-4 grid grid-cols-3 gap-1 md:hidden">
        <span />
        <ControlButton label="Move forward" input="forward">
          <ArrowUp className="h-5 w-5" />
        </ControlButton>
        <span />
        <ControlButton label="Move left" input="left">
          <ArrowLeft className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Move backward" input="backward">
          <ArrowDown className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Move right" input="right">
          <ArrowRight className="h-5 w-5" />
        </ControlButton>
      </div>

      <div className="pointer-events-auto absolute bottom-4 right-4 flex items-end gap-2 md:hidden">
        <ControlButton label="Sprint" input="sprint">
          <Zap className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Glide" input="glide">
          <Wind className="h-5 w-5" />
        </ControlButton>
        <button
          type="button"
          aria-label="Jump"
          className="flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-500/35 text-sm font-bold text-white shadow-lg backdrop-blur active:scale-95"
          onPointerDown={(event) => {
            event.preventDefault()
            queueJump()
          }}
        >
          Jump
        </button>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="pointer-events-auto absolute right-3 top-3 border-white/20 bg-black/55 text-white hover:bg-black/75"
        onClick={() => window.dispatchEvent(new Event('owl-race-reset'))}
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Reset
      </Button>
    </>
  )
}
