/**
 * Feature flags for pack open randomness.
 *
 * PACK_VRF_ENABLED — pack opens use Switchboard VRF (owltopia-pack-open-v2-vrf).
 * Default is on. Set PACK_VRF_ENABLED=false to fall back to local commit–reveal.
 * PACK_VRF_REVEAL_WAIT_MS — optional reveal poll budget (defaults to DRAW_VRF_REVEAL_WAIT_MS / 75s).
 */

import { PACK_OPEN_ALGO_V1, PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'

export function isPackVrfEnabled(): boolean {
  const raw = (process.env.PACK_VRF_ENABLED || '').trim().toLowerCase()
  if (!raw) return true
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off'
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
