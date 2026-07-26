import { create } from 'zustand'

export type RaceMotionState =
  | 'hover'
  | 'fly'
  | 'boost'
  | 'climb'
  | 'dive'

export type RaceStatus = 'ready' | 'countdown' | 'racing' | 'finished'

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
  status: RaceStatus
  countdown: number
  currentCheckpoint: number
  checkpointCount: number
  startedAt: number | null
  elapsedMs: number
  bestTimeMs: number | null
  feedback: string | null
  setInput: (key: keyof RaceInputState, pressed: boolean) => void
  setGrounded: (grounded: boolean) => void
  setStamina: (stamina: number) => void
  setMotion: (motion: RaceMotionState) => void
  resetInput: () => void
  prepareRace: () => void
  setCountdown: (countdown: number) => void
  beginRace: () => void
  updateElapsed: () => void
  crossCheckpoint: (index: number) => void
  loadBestTime: (time: number | null) => void
  clearFeedback: () => void
}

const CHECKPOINT_COUNT = 5

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
  status: 'ready',
  countdown: 3,
  currentCheckpoint: 0,
  checkpointCount: CHECKPOINT_COUNT,
  startedAt: null,
  elapsedMs: 0,
  bestTimeMs: null,
  feedback: null,
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
  resetInput: () => set({ input: { ...EMPTY_INPUT } }),
  prepareRace: () =>
    set({
      input: { ...EMPTY_INPUT },
      status: 'countdown',
      countdown: 3,
      currentCheckpoint: 0,
      startedAt: null,
      elapsedMs: 0,
      stamina: 100,
      motion: 'hover',
      feedback: null,
    }),
  setCountdown: (countdown) => set({ countdown }),
  beginRace: () =>
    set({
      status: 'racing',
      countdown: 0,
      startedAt: Date.now(),
      elapsedMs: 0,
      feedback: 'GO!',
    }),
  updateElapsed: () => {
    const state = get()
    if (state.status !== 'racing' || state.startedAt === null) return
    set({ elapsedMs: Date.now() - state.startedAt })
  },
  crossCheckpoint: (index) => {
    const state = get()
    if (state.status !== 'racing') return

    if (index !== state.currentCheckpoint) {
      if (index > state.currentCheckpoint) {
        set({ feedback: `Missed gate ${state.currentCheckpoint + 1}` })
      }
      return
    }

    const elapsedMs =
      state.startedAt === null ? state.elapsedMs : Date.now() - state.startedAt
    const isFinish = index === state.checkpointCount - 1

    if (isFinish) {
      const bestTimeMs =
        state.bestTimeMs === null
          ? elapsedMs
          : Math.min(state.bestTimeMs, elapsedMs)
      set({
        status: 'finished',
        elapsedMs,
        bestTimeMs,
        currentCheckpoint: state.checkpointCount,
        feedback: elapsedMs === bestTimeMs ? 'New personal best!' : 'Race complete!',
        input: { ...EMPTY_INPUT },
      })
      return
    }

    set({
      currentCheckpoint: index + 1,
      feedback: `Gate ${index + 1} cleared`,
    })
  },
  loadBestTime: (bestTimeMs) => set({ bestTimeMs }),
  clearFeedback: () => set({ feedback: null }),
}))
