/**
 * After payment is confirmed, choose the open seed.
 * Prefer Switchboard VRF; if it fails, fall back to a local CSPRNG seed so the
 * buyer still gets a prize instead of refund_needed + a dead UI.
 */
import { PACK_OPEN_ALGO_V1, PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'

export type PackSeedResolution =
  | {
      seed: string
      algo: typeof PACK_OPEN_ALGO_V2_VRF
      usedVrfFallback: false
    }
  | {
      seed: string
      algo: typeof PACK_OPEN_ALGO_V1
      usedVrfFallback: true
      vrfError: string
    }

export function resolvePackSeedFromVrfResult(params: {
  vrfOk: boolean
  vrfOpenSeed?: string
  vrfError?: string
  localSeed: string
}): PackSeedResolution {
  if (params.vrfOk && params.vrfOpenSeed) {
    return {
      seed: params.vrfOpenSeed,
      algo: PACK_OPEN_ALGO_V2_VRF,
      usedVrfFallback: false,
    }
  }
  return {
    seed: params.localSeed,
    algo: PACK_OPEN_ALGO_V1,
    usedVrfFallback: true,
    vrfError: (params.vrfError ?? 'VRF failed').trim() || 'VRF failed',
  }
}
