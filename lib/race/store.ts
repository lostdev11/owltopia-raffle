import { create } from 'zustand'

export type RaceMotionState =
  | 'idle'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'glide'

type RaceInputState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  sprint: boolean
  glide: boolean
}

type RaceGameState = {
  input: RaceInputState
  jumpQueued: boolean
  grounded: boolean
  stamina: number
  motion: RaceMotionState
  setInput: (key: keyof RaceInputState, pressed: boolean) => void
  queueJump: () => void
  consumeJump: () => boolean
  setGrounded: (grounded: boolean) => void
  setStamina: (stamina: number) => void
  setMotion: (motion: RaceMotionState) => void
  resetInput: () => void
}

const EMPTY_INPUT: RaceInputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  glide: false,
}

export const useRaceGameStore = create<RaceGameState>((set, get) => ({
  input: { ...EMPTY_INPUT },
  jumpQueued: false,
  grounded: false,
  stamina: 100,
  motion: 'idle',
  setInput: (key, pressed) =>
    set((state) => ({
      input: {
        ...state.input,
        [key]: pressed,
      },
    })),
  queueJump: () => set({ jumpQueued: true }),
  consumeJump: () => {
    if (!get().jumpQueued) return false
    set({ jumpQueued: false })
    return true
  },
  setGrounded: (grounded) => set({ grounded }),
  setStamina: (stamina) =>
    set({ stamina: Math.max(0, Math.min(100, stamina)) }),
  setMotion: (motion) => {
    if (get().motion !== motion) set({ motion })
  },
  resetInput: () =>
    set({
      input: { ...EMPTY_INPUT },
      jumpQueued: false,
    }),
}))
