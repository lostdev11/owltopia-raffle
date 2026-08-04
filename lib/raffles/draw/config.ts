/**
 * Feature flags for raffle draw algorithms.
 *
 * DRAW_VRF_ENABLED=true — new raffles use owltopia-draw-v3-vrf (Switchboard) instead of v2 commit–reveal.
 * DRAW_VRF_PILOT_RAFFLE_IDS — comma-separated raffle UUIDs that force VRF even when global flag is off.
 * DRAW_VRF_REVEAL_WAIT_MS — optional override for Switchboard reveal poll budget (default 75000).
 *
 * Safety: never switches an in-flight v2 commit–reveal raffle to VRF (draw_commit_hash wins).
 */
import { DRAW_ALGO_V2_COMMIT_REVEAL, DRAW_ALGO_V3_VRF } from '@/lib/raffles/draw/types'

export function isDrawVrfGloballyEnabled(): boolean {
  const raw = (process.env.DRAW_VRF_ENABLED || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function drawVrfPilotRaffleIds(): Set<string> {
  const raw = (process.env.DRAW_VRF_PILOT_RAFFLE_IDS || '').trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/**
 * Whether this raffle should use VRF at draw time.
 * - Explicit `draw_algo = owltopia-draw-v3-vrf` → yes
 * - Pilot ID list → yes only if there is no v2 commit hash already
 * - Otherwise → no (v2/v1 path)
 */
export function raffleUsesDrawVrf(raffle: {
  id: string
  draw_algo?: string | null
  draw_commit_hash?: string | null
}): boolean {
  const algo = (raffle.draw_algo ?? '').trim()
  if (algo === DRAW_ALGO_V3_VRF) return true
  // Never override an in-flight commit–reveal raffle.
  if ((raffle.draw_commit_hash ?? '').trim()) return false
  if (drawVrfPilotRaffleIds().has(raffle.id)) return true
  return false
}

/** Algo to stamp on newly created raffles. Default remains v2 unless DRAW_VRF_ENABLED. */
export function defaultDrawAlgoForCreate():
  | typeof DRAW_ALGO_V3_VRF
  | typeof DRAW_ALGO_V2_COMMIT_REVEAL {
  return isDrawVrfGloballyEnabled() ? DRAW_ALGO_V3_VRF : DRAW_ALGO_V2_COMMIT_REVEAL
}
