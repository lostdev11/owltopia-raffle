/**
 * Gen2 mint-out thaw orchestration: enqueue, batch process, unlock, optionally open trading.
 */
import {
  getOwlCenterLaunchBySlugAdmin,
  updateOwlCenterLaunchAdmin,
} from '@/lib/db/owl-center-launch'
import {
  fetchGen2CollectionAssets,
  mergeFreezeProgress,
  resolveGen2FreezeIds,
  thawGen2AssetBatch,
  unlockGen2FreezeEscrow,
  GEN2_THAW_BATCH_SIZE,
} from '@/lib/owl-center/gen2-freeze-thaw'
import type { OwlCenterFreezeProgress, OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getGen2CandyMachineId, getGen2CollectionMint } from '@/lib/solana/network'

function freezeIdsFromLaunch(launch: OwlCenterLaunchPublic) {
  return resolveGen2FreezeIds({
    candyMachineId: getGen2CandyMachineId(launch) || undefined,
    collectionMint: getGen2CollectionMint(launch) || undefined,
  })
}

export function freezeStatusPayload(launch: OwlCenterLaunchPublic) {
  return {
    freeze_status: launch.freeze_status,
    freeze_thawed_at: launch.freeze_thawed_at,
    freeze_progress: launch.freeze_progress,
    active_phase: launch.active_phase,
    status: launch.status,
    magic_eden_url: launch.magic_eden_url,
    tensor_url: launch.tensor_url,
    minted_count: launch.minted_count,
    total_supply: launch.total_supply,
  }
}

/** Idempotent: set freeze_status=thawing when collection is SOLD_OUT. */
export async function enqueueGen2ThawIfSoldOut(
  launch?: OwlCenterLaunchPublic | null
): Promise<{ enqueued: boolean; launch: OwlCenterLaunchPublic | null }> {
  const cur = launch ?? (await getOwlCenterLaunchBySlugAdmin('gen2'))
  if (!cur) return { enqueued: false, launch: null }

  const soldOut =
    cur.active_phase === 'SOLD_OUT' ||
    cur.status === 'SOLD_OUT' ||
    cur.minted_count >= cur.total_supply

  if (!soldOut) return { enqueued: false, launch: cur }

  if (cur.freeze_status === 'thawing' || cur.freeze_status === 'thawed') {
    return { enqueued: false, launch: cur }
  }

  const now = new Date().toISOString()
  const progress = mergeFreezeProgress(cur.freeze_progress, {
    started_at: cur.freeze_progress.started_at ?? now,
    updated_at: now,
    thawed_count: cur.freeze_progress.thawed_count ?? 0,
    offset: cur.freeze_progress.offset ?? 0,
    attempts: (cur.freeze_progress.attempts ?? 0) + 1,
    error: undefined,
  })

  const updated = await updateOwlCenterLaunchAdmin('gen2', {
    freeze_status: 'thawing',
    freeze_progress: progress,
  })
  return { enqueued: true, launch: updated }
}

export async function startGen2ThawManual(): Promise<{
  ok: true
  launch: OwlCenterLaunchPublic
} | { ok: false; error: string }> {
  const cur = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!cur) return { ok: false, error: 'Launch not found' }

  if (cur.freeze_status === 'thawed') {
    return { ok: false, error: 'Collection already thawed' }
  }

  const ids = freezeIdsFromLaunch(cur)
  let total = cur.freeze_progress.total ?? 0
  try {
    const assets = await fetchGen2CollectionAssets(ids.collectionMint, ids.rpcUrl)
    total = assets.length
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Could not enumerate collection for thaw: ${msg}` }
  }

  const now = new Date().toISOString()
  const progress = mergeFreezeProgress(cur.freeze_progress, {
    total,
    remaining_count: Math.max(0, total - (cur.freeze_progress.thawed_count ?? 0)),
    offset: cur.freeze_status === 'thawing' ? (cur.freeze_progress.offset ?? 0) : 0,
    thawed_count: cur.freeze_status === 'thawing' ? (cur.freeze_progress.thawed_count ?? 0) : 0,
    started_at: cur.freeze_progress.started_at ?? now,
    updated_at: now,
    attempts: (cur.freeze_progress.attempts ?? 0) + 1,
    error: undefined,
  })

  const updated = await updateOwlCenterLaunchAdmin('gen2', {
    freeze_status: 'thawing',
    freeze_progress: progress,
  })
  if (!updated) return { ok: false, error: 'Failed to update launch' }
  return { ok: true, launch: updated }
}

export async function processGen2ThawBatch(): Promise<{
  ok: boolean
  skipped?: boolean
  reason?: string
  batch?: {
    thawed: number
    skipped: number
    remaining_unprocessed: number
  }
  completed?: boolean
  unlocked?: boolean
  trading_activated?: boolean
  error?: string
}> {
  let launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) return { ok: false, error: 'Launch not found' }

  // Self-heal: SOLD_OUT but not yet thawing/thawed.
  if (
    (launch.active_phase === 'SOLD_OUT' || launch.minted_count >= launch.total_supply) &&
    launch.freeze_status !== 'thawing' &&
    launch.freeze_status !== 'thawed'
  ) {
    const enq = await enqueueGen2ThawIfSoldOut(launch)
    launch = enq.launch ?? launch
  }

  if (launch.freeze_status !== 'thawing') {
    return { ok: true, skipped: true, reason: `freeze_status=${launch.freeze_status}` }
  }

  const ids = freezeIdsFromLaunch(launch)
  const now = new Date().toISOString()

  try {
    const assets = await fetchGen2CollectionAssets(ids.collectionMint, ids.rpcUrl)
    const offset = launch.freeze_progress.offset ?? 0
    const batch = await thawGen2AssetBatch({
      assets,
      offset,
      limit: GEN2_THAW_BATCH_SIZE,
      ids,
    })

    const newOffset = offset + batch.attempted
    const thawed_count = (launch.freeze_progress.thawed_count ?? 0) + batch.thawed
    const done = newOffset >= assets.length

    const progress: OwlCenterFreezeProgress = mergeFreezeProgress(launch.freeze_progress, {
      total: assets.length,
      offset: newOffset,
      thawed_count,
      remaining_count: Math.max(0, assets.length - newOffset),
      updated_at: now,
      last_run_at: now,
      last_signature: batch.last_signature ?? launch.freeze_progress.last_signature,
      error: undefined,
    })

    if (!done) {
      await updateOwlCenterLaunchAdmin('gen2', { freeze_progress: progress })
      return {
        ok: true,
        batch: {
          thawed: batch.thawed,
          skipped: batch.skipped,
          remaining_unprocessed: batch.remaining_unprocessed,
        },
        completed: false,
      }
    }

    // Complete: mark thawed, unlock, maybe open trading.
    let unlocked = false
    let unlockError: string | undefined
    try {
      const unlockRes = await unlockGen2FreezeEscrow(ids)
      unlocked = true
      progress.unlocked_at = now
      progress.last_signature = unlockRes.signature
    } catch (e) {
      unlockError = e instanceof Error ? e.message : String(e)
      progress.error = `Thaw complete but unlock failed: ${unlockError}`
    }

    const hasMarketplace = Boolean(launch.magic_eden_url?.trim() || launch.tensor_url?.trim())
    const trading_activated = hasMarketplace
    const patch: Parameters<typeof updateOwlCenterLaunchAdmin>[1] = {
      freeze_status: 'thawed',
      freeze_thawed_at: now,
      freeze_progress: progress,
    }
    if (trading_activated) {
      patch.active_phase = 'TRADING_ACTIVE'
      patch.status = 'TRADING_ACTIVE'
    }

    await updateOwlCenterLaunchAdmin('gen2', patch)

    return {
      ok: true,
      batch: {
        thawed: batch.thawed,
        skipped: batch.skipped,
        remaining_unprocessed: 0,
      },
      completed: true,
      unlocked,
      trading_activated,
      error: unlockError,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const progress = mergeFreezeProgress(launch.freeze_progress, {
      error: msg,
      updated_at: now,
      last_run_at: now,
      attempts: (launch.freeze_progress.attempts ?? 0) + 1,
    })
    await updateOwlCenterLaunchAdmin('gen2', { freeze_progress: progress })
    return { ok: false, error: msg }
  }
}

export async function unlockGen2FreezeEscrowAdmin(): Promise<
  { ok: true; signature: string; launch: OwlCenterLaunchPublic } | { ok: false; error: string }
> {
  const cur = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!cur) return { ok: false, error: 'Launch not found' }
  if (cur.freeze_status !== 'thawed' && cur.freeze_status !== 'thawing') {
    return { ok: false, error: 'Unlock requires thawing/thawed status (thaw NFTs first)' }
  }

  try {
    const ids = freezeIdsFromLaunch(cur)
    const res = await unlockGen2FreezeEscrow(ids)
    const now = new Date().toISOString()
    const progress = mergeFreezeProgress(cur.freeze_progress, {
      unlocked_at: now,
      updated_at: now,
      last_signature: res.signature,
      error: undefined,
    })
    const hasMarketplace = Boolean(cur.magic_eden_url?.trim() || cur.tensor_url?.trim())
    const patch: Parameters<typeof updateOwlCenterLaunchAdmin>[1] = {
      freeze_status: 'thawed',
      freeze_thawed_at: cur.freeze_thawed_at ?? now,
      freeze_progress: progress,
    }
    if (hasMarketplace && cur.active_phase === 'SOLD_OUT') {
      patch.active_phase = 'TRADING_ACTIVE'
      patch.status = 'TRADING_ACTIVE'
    }
    const updated = await updateOwlCenterLaunchAdmin('gen2', patch)
    if (!updated) return { ok: false, error: 'Unlock on-chain ok but DB update failed' }
    return { ok: true, signature: res.signature, launch: updated }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
