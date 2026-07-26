import { create } from 'zustand'

export type RaceMotionState =
  | 'hover'
  | 'fly'
  | 'boost'
  | 'climb'
  | 'dive'

type RaceInputState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  sprint: boolean
  climb: boolean
  dive: boolean
}

type RaceGameState = {
  input: RaceInputState
  grounded: boolean
  stamina: number
  motion: RaceMotionState
  setInput: (key: keyof RaceInputState, pressed: boolean) => void
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
  climb: false,
  dive: false,
}

export const useRaceGameStore = create<RaceGameState>((set, get) => ({
  input: { ...EMPTY_INPUT },
  grounded: false,
  stamina: 100,
  motion: 'hover',
  setInput: (key, pressed) =>
    set((state) => ({
      input: {
        ...state.input,
        [key]: pressed,
      },
    })),
  setGrounded: (grounded) => set({ grounded }),
  setStamina: (stamina) =>
    set({ stamina: Math.max(0, Math.min(100, stamina)) }),
  setMotion: (motion) => {
    if (get().motion !== motion) set({ motion })
  },
  resetInput: () =>
    set({
      input: { ...EMPTY_INPUT },
    }),
}))
