/**
 * Feature flags for pack open randomness.
 *
 * PACK_VRF_ENABLED=true — pack opens use Switchboard VRF (owltopia-pack-open-v2-vrf).
 * PACK_VRF_REVEAL_WAIT_MS — optional reveal poll budget (defaults to DRAW_VRF_REVEAL_WAIT_MS / 75s).
 */

import { PACK_OPEN_ALGO_V1, PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'

export function isPackVrfEnabled(): boolean {
  const raw = (process.env.PACK_VRF_ENABLED || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function resolvePackOpenAlgo():
  | typeof PACK_OPEN_ALGO_V1
  | typeof PACK_OPEN_ALGO_V2_VRF {
  return isPackVrfEnabled() ? PACK_OPEN_ALGO_V2_VRF : PACK_OPEN_ALGO_V1
}

export function resolvePackVrfRevealWaitMs(): number {
  const raw = (process.env.PACK_VRF_REVEAL_WAIT_MS || '').trim()
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 10_000) return Math.floor(n)
  }
  const drawRaw = (process.env.DRAW_VRF_REVEAL_WAIT_MS || '').trim()
  if (drawRaw) {
    const n = Number(drawRaw)
    if (Number.isFinite(n) && n >= 10_000) return Math.floor(n)
  }
  return 75_000
}
