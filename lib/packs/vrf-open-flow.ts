/**
 * Switchboard VRF commit → reveal for a single pack open (same request).
 * Reuses raffle Switchboard helpers; stores VRF audit fields on pack_opens.
 */

import {
  switchboardCommitRandomness,
  switchboardRevealRandomness,
  VRF_PROVIDER_SWITCHBOARD,
} from '@/lib/raffles/draw/vrf-switchboard'
import { updatePackOpen } from '@/lib/packs/db'
import { resolvePackVrfRevealWaitMs } from '@/lib/packs/vrf-config'
import { PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'

export type PackVrfResult =
  | {
      ok: true
      openSeed: string
      requestTx: string
      fulfillTx: string
      randomnessAccount: string
    }
  | {
      ok: false
      error: string
      requestTx?: string | null
      randomnessAccount?: string | null
    }

/**
 * Commit + reveal Switchboard randomness for this open.
 * On failure, patches open row with open_vrf_status=failed and returns error
 * (caller should set refund_needed).
 */
export async function runPackOpenVrf(openId: string): Promise<PackVrfResult> {
  const commit = await switchboardCommitRandomness()
  if (!commit.ok) {
    await updatePackOpen(openId, {
      open_algo: PACK_OPEN_ALGO_V2_VRF,
      open_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
      open_vrf_status: 'failed',
      open_vrf_error: commit.error,
      open_vrf_account: null,
      open_vrf_request_tx: null,
      open_vrf_fulfill_tx: null,
    } as Parameters<typeof updatePackOpen>[1])
    return { ok: false, error: commit.error }
  }

  await updatePackOpen(openId, {
    open_algo: PACK_OPEN_ALGO_V2_VRF,
    open_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
    open_vrf_status: 'pending',
    open_vrf_account: commit.randomnessAccount,
    open_vrf_request_tx: commit.commitTx,
    open_vrf_fulfill_tx: null,
    open_vrf_error: null,
  } as Parameters<typeof updatePackOpen>[1])

  const reveal = await switchboardRevealRandomness({
    randomnessAccount: commit.randomnessAccount,
    randomnessSecretKeyBase58: commit.randomnessSecretKeyBase58,
    maxWaitMs: resolvePackVrfRevealWaitMs(),
  })

  if (!reveal.ok) {
    await updatePackOpen(openId, {
      open_vrf_status: 'failed',
      open_vrf_error: reveal.error,
    } as Parameters<typeof updatePackOpen>[1])
    return {
      ok: false,
      error: reveal.error,
      requestTx: commit.commitTx,
      randomnessAccount: commit.randomnessAccount,
    }
  }

  await updatePackOpen(openId, {
    open_vrf_status: 'fulfilled',
    open_vrf_fulfill_tx: reveal.revealTx,
    open_vrf_error: null,
  } as Parameters<typeof updatePackOpen>[1])

  return {
    ok: true,
    openSeed: reveal.drawSeed,
    requestTx: commit.commitTx,
    fulfillTx: reveal.revealTx,
    randomnessAccount: commit.randomnessAccount,
  }
}
