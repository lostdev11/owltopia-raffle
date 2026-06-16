import 'server-only'

import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import {
  getOwlCenterLaunchByIdAdmin,
  listOwlCenterLaunchesDueForReveal,
  updateOwlCenterLaunchByIdAdmin,
} from '@/lib/db/owl-center-launch'
import { ensureMarketplaceRow } from '@/lib/db/owl-center-marketplace'
import {
  formatOwlCenterRevealDayFeeLabel,
  formatOwlCenterRevealDayFeeSolLabel,
  isOwlCenterRevealDayFeeEnabled,
  owlCenterRevealDayFeeLamports,
  shouldRequireOwlCenterRevealDayFeeServer,
} from '@/lib/owl-center/reveal-day-fee'
import { runMetadataRefreshForLaunch } from '@/lib/owl-center/metadata-refresh'
import { resolveRevealPlaceholderMetadataUri } from '@/lib/owl-center/reveal-placeholder'
import { verifyOwlCenterRevealDayPayment } from '@/lib/owl-center/reveal-day-payment'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import type {
  OwlCenterLaunchPublic,
  OwlCenterRevealProgress,
  OwlCenterRevealStatus,
} from '@/lib/owl-center/types'

export type RevealDayStatus = {
  eligible: boolean
  reveal_mode: OwlCenterLaunchPublic['reveal_mode']
  reveal_status: OwlCenterRevealStatus
  reveal_at: string | null
  reveal_completed_at: string | null
  placeholder_metadata_uri: string | null
  reveal_payment_tx_signature: string | null
  payment_required: boolean
  payment_received: boolean
  fee_label: string
  fee_lamports_estimate: string | null
  sol_usd_price: number | null
  treasury_wallet: string | null
  minted_count: number
  collection_mint: string | null
  candy_machine_deployed: boolean
  reveal_progress: OwlCenterRevealProgress
  checklist: {
    reveal_day_enabled: boolean
    arweave_ready: boolean
    placeholder_ready: boolean
    cm_deployed: boolean
    payment_ok: boolean
    scheduled: boolean
    revealed: boolean
  }
}

export function isRevealDayLaunch(
  launch: Pick<OwlCenterLaunchPublic, 'reveal_mode' | 'mint_mode'>
): boolean {
  return launch.mint_mode === 'public_simple' && launch.reveal_mode === 'reveal_day'
}

export function isCollectionUnrevealed(
  launch: Pick<OwlCenterLaunchPublic, 'reveal_mode' | 'reveal_status'>
): boolean {
  return (
    launch.reveal_mode === 'reveal_day' &&
    launch.reveal_status !== 'completed' &&
    launch.reveal_status !== 'disabled'
  )
}

export async function getRevealDayStatusForLaunch(launchId: string): Promise<RevealDayStatus | null> {
  const [launch, job, marketplace] = await Promise.all([
    getOwlCenterLaunchByIdAdmin(launchId),
    getLatestAssetUploadJobForLaunch(launchId),
    ensureMarketplaceRow(launchId),
  ])
  if (!launch) return null

  const arweaveReady = job?.status === 'completed'
  const collectionMint = marketplace?.collection_mint?.trim() || launch.collection_mint?.trim() || null
  const cmDeployed = Boolean(marketplace?.candy_machine_id?.trim() || launch.candy_machine_id?.trim())
  const paymentReceived = Boolean(launch.reveal_payment_tx_signature?.trim())
  const paymentRequired = shouldRequireOwlCenterRevealDayFeeServer()
  const feeQuote = await owlCenterRevealDayFeeLamports()

  const revealDayEnabled = launch.reveal_mode === 'reveal_day'
  const placeholderReady = Boolean(launch.placeholder_metadata_uri?.trim())

  return {
    eligible: launch.mint_mode === 'public_simple',
    reveal_mode: launch.reveal_mode,
    reveal_status: launch.reveal_status,
    reveal_at: launch.reveal_at,
    reveal_completed_at: launch.reveal_completed_at,
    placeholder_metadata_uri: launch.placeholder_metadata_uri,
    reveal_payment_tx_signature: launch.reveal_payment_tx_signature,
    payment_required: paymentRequired,
    payment_received: paymentReceived || !paymentRequired,
    fee_label: feeQuote
      ? formatOwlCenterRevealDayFeeSolLabel(feeQuote.lamports)
      : formatOwlCenterRevealDayFeeLabel(),
    fee_lamports_estimate: feeQuote ? feeQuote.lamports.toString() : null,
    sol_usd_price: feeQuote?.solUsdPrice ?? null,
    treasury_wallet: getOwlCenterPlatformTreasuryWallet(),
    minted_count: launch.minted_count,
    collection_mint: collectionMint,
    candy_machine_deployed: cmDeployed,
    reveal_progress: launch.reveal_progress ?? {},
    checklist: {
      reveal_day_enabled: revealDayEnabled,
      arweave_ready: Boolean(arweaveReady),
      placeholder_ready: placeholderReady,
      cm_deployed: cmDeployed,
      payment_ok: paymentReceived || !paymentRequired,
      scheduled: launch.reveal_status === 'scheduled' || launch.reveal_status === 'running',
      revealed: launch.reveal_status === 'completed',
    },
  }
}

export type RevealDayActionResult =
  | { ok: true; launch: OwlCenterLaunchPublic }
  | { ok: false; error: string; code?: string }

export async function enableRevealDayForLaunch(launchId: string): Promise<RevealDayActionResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (launch.mint_mode !== 'public_simple') {
    return { ok: false, error: 'Reveal Day is only available for public_simple collections.', code: 'wrong_mode' }
  }
  if (launch.candy_machine_id || launch.collection_mint) {
    return {
      ok: false,
      error: 'Enable Reveal Day before deploying the Candy Machine.',
      code: 'already_deployed',
    }
  }

  const job = await getLatestAssetUploadJobForLaunch(launchId)
  if (!job || job.status !== 'completed') {
    return { ok: false, error: 'Complete Arweave upload before enabling Reveal Day.', code: 'arweave_incomplete' }
  }

  const placeholderUri = await resolveRevealPlaceholderMetadataUri({ launch, job })
  if (!placeholderUri) {
    return { ok: false, error: 'Could not prepare placeholder metadata on Arweave.', code: 'placeholder_failed' }
  }

  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, {
    reveal_mode: 'reveal_day',
    reveal_status: 'draft',
    placeholder_metadata_uri: placeholderUri,
    reveal_at: null,
    reveal_completed_at: null,
    reveal_progress: {},
  })
  if (!updated) return { ok: false, error: 'Failed to save reveal day settings', code: 'db_error' }

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: 'Reveal Day enabled — CM deploy will use placeholder metadata until scheduled reveal.',
    event_type: 'system',
  })

  return { ok: true, launch: updated }
}

export async function confirmRevealDayPaymentForLaunch(
  launchId: string,
  txSignature: string
): Promise<RevealDayActionResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (!isRevealDayLaunch(launch)) {
    return { ok: false, error: 'Reveal Day is not enabled for this launch.', code: 'not_enabled' }
  }
  if (launch.reveal_payment_tx_signature?.trim()) {
    return { ok: true, launch }
  }

  const sig = txSignature.trim()
  if (!sig) return { ok: false, error: 'Missing transaction signature', code: 'invalid_input' }

  const network = resolveLaunchMintNetwork(launch)
  const feeQuote = await owlCenterRevealDayFeeLamports()
  const verify = await verifyOwlCenterRevealDayPayment({
    txSignature: sig,
    network,
    quotedLamports: feeQuote?.lamports,
  })
  if (!verify.ok) return { ok: false, error: verify.error, code: 'payment_invalid' }

  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, {
    reveal_payment_tx_signature: sig,
  })
  if (!updated) return { ok: false, error: 'Failed to record payment', code: 'db_error' }

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Reveal Day fee confirmed · ${sig.slice(0, 12)}…`,
    event_type: 'system',
  })

  return { ok: true, launch: updated }
}

export async function scheduleRevealDayForLaunch(
  launchId: string,
  revealAtIso: string,
  opts?: { adminWaivePayment?: boolean }
): Promise<RevealDayActionResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (!isRevealDayLaunch(launch)) {
    return { ok: false, error: 'Reveal Day is not enabled for this launch.', code: 'not_enabled' }
  }
  if (launch.reveal_status === 'completed') {
    return { ok: false, error: 'Collection already revealed.', code: 'already_revealed' }
  }
  if (launch.reveal_status === 'running') {
    return { ok: false, error: 'Reveal is in progress — wait for completion.', code: 'in_progress' }
  }

  const ms = new Date(revealAtIso).getTime()
  if (!Number.isFinite(ms)) {
    return { ok: false, error: 'Invalid reveal time', code: 'invalid_input' }
  }
  if (ms < Date.now() - 60_000) {
    return { ok: false, error: 'Reveal time must be in the future', code: 'invalid_input' }
  }

  const paymentOk =
    opts?.adminWaivePayment ||
    Boolean(launch.reveal_payment_tx_signature?.trim()) ||
    !shouldRequireOwlCenterRevealDayFeeServer()
  if (!paymentOk) {
    return { ok: false, error: 'Pay the Reveal Day fee before scheduling.', code: 'payment_required' }
  }

  if (!launch.candy_machine_id && !launch.collection_mint) {
    return { ok: false, error: 'Deploy the Candy Machine before scheduling reveal.', code: 'not_deployed' }
  }

  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, {
    reveal_at: new Date(ms).toISOString(),
    reveal_status: 'scheduled',
  })
  if (!updated) return { ok: false, error: 'Failed to schedule reveal', code: 'db_error' }

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Reveal Day scheduled · ${updated.reveal_at}`,
    event_type: 'system',
  })

  return { ok: true, launch: updated }
}

export type RunRevealDayResult =
  | {
      ok: true
      refreshed_count: number
      skipped_count: number
      launch: OwlCenterLaunchPublic
    }
  | { ok: false; error: string; code?: string }

export async function runRevealDayForLaunch(launchId: string): Promise<RunRevealDayResult> {
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return { ok: false, error: 'Launch not found', code: 'not_found' }
  if (!isRevealDayLaunch(launch)) {
    return { ok: false, error: 'Reveal Day is not enabled for this launch.', code: 'not_enabled' }
  }
  if (launch.reveal_status === 'completed') {
    return { ok: false, error: 'Collection already revealed.', code: 'already_revealed' }
  }
  if (launch.reveal_status === 'running') {
    return { ok: false, error: 'Reveal already in progress.', code: 'in_progress' }
  }

  const attempts = (launch.reveal_progress?.attempts ?? 0) + 1
  await updateOwlCenterLaunchByIdAdmin(launchId, {
    reveal_status: 'running',
    reveal_progress: {
      ...launch.reveal_progress,
      attempts,
      last_run_at: new Date().toISOString(),
      error: undefined,
    },
  })

  const refresh = await runMetadataRefreshForLaunch(launchId)
  if (!refresh.ok) {
    await updateOwlCenterLaunchByIdAdmin(launchId, {
      reveal_status: 'failed',
      reveal_progress: {
        ...launch.reveal_progress,
        attempts,
        last_run_at: new Date().toISOString(),
        error: refresh.error,
      },
    })
    return { ok: false, error: refresh.error, code: refresh.code ?? 'refresh_failed' }
  }

  const refreshedCount = refresh.refreshed.length
  const skippedCount = refresh.skipped.length

  if (refreshedCount === 0) {
    const errMsg =
      refresh.skipped
        .filter((s): s is { mint: string; ok: false; error: string } => !s.ok)
        .map((s) => s.error)
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ') || 'No mints were updated on-chain'
    await updateOwlCenterLaunchByIdAdmin(launchId, {
      reveal_status: 'failed',
      reveal_progress: {
        attempts,
        last_run_at: new Date().toISOString(),
        refreshed_count: 0,
        skipped_count: skippedCount,
        error: errMsg,
      },
    })
    return { ok: false, error: errMsg, code: 'nothing_updated' }
  }

  const completedAt = new Date().toISOString()

  const updated = await updateOwlCenterLaunchByIdAdmin(launchId, {
    reveal_status: 'completed',
    reveal_completed_at: completedAt,
    reveal_progress: {
      attempts,
      last_run_at: completedAt,
      refreshed_count: refreshedCount,
      skipped_count: skippedCount,
    },
  })
  if (!updated) return { ok: false, error: 'Reveal ran but failed to update status', code: 'db_error' }

  await getSupabaseAdmin().from('owl_center_activity_logs').insert({
    launch_id: launchId,
    message: `Reveal Day complete · updated ${refreshedCount} mint${refreshedCount === 1 ? '' : 's'} on-chain`,
    event_type: 'system',
  })

  return { ok: true, refreshed_count: refreshedCount, skipped_count: skippedCount, launch: updated }
}
