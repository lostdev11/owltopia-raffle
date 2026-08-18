import {
  getOwlCenterLaunchByIdAdmin,
  updateOwlCenterLaunchByIdAdmin,
} from '@/lib/db/owl-center-launch'
import { thawCoreCollectionPermanentFreeze } from '@/lib/owl-center/core-cm-deploy-onchain'
import { mergeFreezeProgress } from '@/lib/owl-center/gen2-freeze-thaw'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

export type CoreCollectionThawResult =
  | { ok: true; signature: string; launch: OwlCenterLaunchPublic }
  | { ok: false; error: string; status: number }

/** Shared Core PermanentFreezeDelegate thaw for public_simple launches (admin or creator). */
export async function runCoreCollectionThawForLaunch(launchId: string): Promise<CoreCollectionThawResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', status: 404 }
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, error: 'Only public_simple launches use this thaw path', status: 400 }
  }
  if (launch.mint_standard !== 'core') {
    return { ok: false, error: 'Core thaw requires mint_standard=core', status: 400 }
  }
  if (!launch.freeze_enabled) {
    return { ok: false, error: 'Freeze was not enabled for this launch', status: 400 }
  }
  if (launch.freeze_status === 'thawed') {
    return { ok: false, error: 'Collection is already thawed', status: 400 }
  }
  const collection = launch.collection_mint?.trim()
  if (!collection) {
    return { ok: false, error: 'Missing collection address — deploy first', status: 400 }
  }

  const network = resolveLaunchMintNetwork(launch)
  const result = await thawCoreCollectionPermanentFreeze({
    collectionAddress: collection,
    network,
  })
  if (!result.ok) {
    return { ok: false, error: result.error, status: 500 }
  }

  const now = new Date().toISOString()
  const updated = await updateOwlCenterLaunchByIdAdmin(launch.id, {
    freeze_status: 'thawed',
    freeze_thawed_at: now,
    freeze_progress: mergeFreezeProgress(launch.freeze_progress, {
      last_run_at: now,
      unlocked_at: now,
      last_signature: result.signature,
    }),
  })

  return {
    ok: true,
    signature: result.signature,
    launch: updated ?? launch,
  }
}
