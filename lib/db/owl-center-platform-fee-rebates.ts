import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

import {
  clampPlatformFeeRebateBps,
  computePlatformFeeRebateLamports,
  isOwlCenterLaunchMintEndedForRebate,
  isPlatformFeeRebateEnabled,
  type OwlCenterPlatformFeeRebateState,
} from '@/lib/owl-center/platform-fee-rebate'
import { loadOwlCenterPlatformFeeRebatePayoutKeypair } from '@/lib/owl-center/platform-fee-rebate-payout'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getLaunchSolanaRpcUrl, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type OwlCenterPlatformFeeRebateRow = {
  id: string
  launch_id: string
  mint_tx_signature: string
  minter_wallet: string
  fee_lamports: number
  rebate_lamports: number
  rebate_bps: number
  rebate_wallet: string
  state: OwlCenterPlatformFeeRebateState
  quantity: number
  release_tx_signature: string | null
  admin_wallet: string | null
  notes: string | null
  created_at: string
  updated_at: string
  released_at: string | null
}

function mapRebateRow(data: Record<string, unknown>): OwlCenterPlatformFeeRebateRow {
  return {
    id: String(data.id),
    launch_id: String(data.launch_id),
    mint_tx_signature: String(data.mint_tx_signature),
    minter_wallet: String(data.minter_wallet),
    fee_lamports: Number(data.fee_lamports ?? 0),
    rebate_lamports: Number(data.rebate_lamports ?? 0),
    rebate_bps: Number(data.rebate_bps ?? 0),
    rebate_wallet: String(data.rebate_wallet),
    state: String(data.state) as OwlCenterPlatformFeeRebateState,
    quantity: Number(data.quantity ?? 1),
    release_tx_signature: data.release_tx_signature != null ? String(data.release_tx_signature) : null,
    admin_wallet: data.admin_wallet != null ? String(data.admin_wallet) : null,
    notes: data.notes != null ? String(data.notes) : null,
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
    released_at: data.released_at != null ? String(data.released_at) : null,
  }
}

export async function accrueOwlCenterPlatformFeeRebate(params: {
  launch: Pick<OwlCenterLaunchPublic, 'id'> & {
    platform_fee_rebate_bps?: number | null
    platform_fee_rebate_wallet?: string | null
  }
  mintTxSignature: string
  minterWallet: string
  feeLamports: bigint
  quantity: number
}): Promise<{ ok: true; row: OwlCenterPlatformFeeRebateRow | null; skipped?: string } | { ok: false; error: string }> {
  if (!isPlatformFeeRebateEnabled(params.launch)) {
    return { ok: true, row: null, skipped: 'rebate_disabled' }
  }
  const rebateWallet = normalizeSolanaWalletAddress(params.launch.platform_fee_rebate_wallet ?? '')
  if (!rebateWallet) return { ok: false, error: 'invalid_rebate_wallet' }

  const bps = clampPlatformFeeRebateBps(params.launch.platform_fee_rebate_bps)
  const rebateLamports = computePlatformFeeRebateLamports(params.feeLamports, bps)
  if (rebateLamports <= 0n) return { ok: true, row: null, skipped: 'zero_rebate' }

  const qty = Math.max(1, Math.floor(params.quantity))
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: existing } = await db
    .from('owl_center_platform_fee_rebates')
    .select('*')
    .eq('mint_tx_signature', params.mintTxSignature)
    .maybeSingle()
  if (existing) {
    return { ok: true, row: mapRebateRow(existing as Record<string, unknown>), skipped: 'duplicate' }
  }

  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .insert({
      launch_id: params.launch.id,
      mint_tx_signature: params.mintTxSignature,
      minter_wallet: params.minterWallet,
      fee_lamports: Number(params.feeLamports),
      rebate_lamports: Number(rebateLamports),
      rebate_bps: bps,
      rebate_wallet: rebateWallet,
      state: 'locked',
      quantity: qty,
      updated_at: now,
    })
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      const again = await db
        .from('owl_center_platform_fee_rebates')
        .select('*')
        .eq('mint_tx_signature', params.mintTxSignature)
        .maybeSingle()
      if (again.data) {
        return { ok: true, row: mapRebateRow(again.data as Record<string, unknown>), skipped: 'duplicate' }
      }
    }
    console.error('accrueOwlCenterPlatformFeeRebate', error)
    return { ok: false, error: error.message }
  }

  return { ok: true, row: data ? mapRebateRow(data as Record<string, unknown>) : null }
}

export async function markOwlCenterPlatformFeeRebatesReleasable(
  launchId: string
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .update({ state: 'releasable', updated_at: now })
    .eq('launch_id', launchId)
    .eq('state', 'locked')
    .select('id')

  if (error) {
    console.error('markOwlCenterPlatformFeeRebatesReleasable', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, updated: data?.length ?? 0 }
}

export type RebateLaunchSummary = {
  launch_id: string
  locked_lamports: number
  releasable_lamports: number
  released_lamports: number
  forfeited_lamports: number
  locked_count: number
  releasable_count: number
  released_count: number
  forfeited_count: number
  rebate_wallet: string | null
}

export async function summarizeOwlCenterPlatformFeeRebates(launchId: string): Promise<RebateLaunchSummary> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .select('state, rebate_lamports, rebate_wallet')
    .eq('launch_id', launchId)

  const empty: RebateLaunchSummary = {
    launch_id: launchId,
    locked_lamports: 0,
    releasable_lamports: 0,
    released_lamports: 0,
    forfeited_lamports: 0,
    locked_count: 0,
    releasable_count: 0,
    released_count: 0,
    forfeited_count: 0,
    rebate_wallet: null,
  }
  if (error || !data) {
    if (error) console.error('summarizeOwlCenterPlatformFeeRebates', error)
    return empty
  }

  const out = { ...empty }
  for (const row of data) {
    const lamports = Number(row.rebate_lamports ?? 0)
    const state = String(row.state)
    if (!out.rebate_wallet && row.rebate_wallet) out.rebate_wallet = String(row.rebate_wallet)
    if (state === 'locked') {
      out.locked_lamports += lamports
      out.locked_count += 1
    } else if (state === 'releasable') {
      out.releasable_lamports += lamports
      out.releasable_count += 1
    } else if (state === 'released') {
      out.released_lamports += lamports
      out.released_count += 1
    } else if (state === 'forfeited') {
      out.forfeited_lamports += lamports
      out.forfeited_count += 1
    }
  }
  return out
}

export async function listOwlCenterPlatformFeeRebatesForLaunch(
  launchId: string,
  limit = 100
): Promise<OwlCenterPlatformFeeRebateRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .select('*')
    .eq('launch_id', launchId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, limit)))
  if (error || !data) {
    if (error) console.error('listOwlCenterPlatformFeeRebatesForLaunch', error)
    return []
  }
  return data.map((r) => mapRebateRow(r as Record<string, unknown>))
}

async function payRebateBatch(params: {
  launch: Pick<OwlCenterLaunchPublic, 'id' | 'mint_mode' | 'mint_network'>
  rows: OwlCenterPlatformFeeRebateRow[]
  adminWallet?: string | null
  notes?: string | null
}): Promise<{ ok: true; signature: string; released_ids: string[] } | { ok: false; error: string }> {
  if (params.rows.length === 0) return { ok: false, error: 'no_rows' }
  const payer = loadOwlCenterPlatformFeeRebatePayoutKeypair()
  if (!payer) return { ok: false, error: 'payout_key_missing' }

  const byWallet = new Map<string, { lamports: number; ids: string[] }>()
  for (const row of params.rows) {
    const dest = normalizeSolanaWalletAddress(row.rebate_wallet)
    if (!dest) continue
    const cur = byWallet.get(dest) ?? { lamports: 0, ids: [] }
    cur.lamports += row.rebate_lamports
    cur.ids.push(row.id)
    byWallet.set(dest, cur)
  }
  if (byWallet.size === 0) return { ok: false, error: 'no_valid_destinations' }

  const network = resolveLaunchMintNetwork(params.launch)
  const rpc = getLaunchSolanaRpcUrl(network)
  const connection = new Connection(rpc, 'confirmed')
  const tx = new Transaction()
  const releasedIds: string[] = []
  for (const [dest, bag] of byWallet) {
    if (bag.lamports <= 0) continue
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(dest),
        lamports: bag.lamports,
      })
    )
    releasedIds.push(...bag.ids)
  }
  if (releasedIds.length === 0) return { ok: false, error: 'nothing_to_pay' }

  let signature: string
  try {
    signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })
  } catch (e) {
    console.error('payRebateBatch', e)
    return { ok: false, error: e instanceof Error ? e.message : 'payout_failed' }
  }

  const db = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { error } = await db
    .from('owl_center_platform_fee_rebates')
    .update({
      state: 'released',
      release_tx_signature: signature,
      admin_wallet: params.adminWallet ?? null,
      notes: params.notes ?? null,
      released_at: now,
      updated_at: now,
    })
    .in('id', releasedIds)
    .in('state', ['locked', 'releasable'])

  if (error) {
    console.error('payRebateBatch update', error)
    return { ok: false, error: `paid_on_chain_but_db_failed:${signature}` }
  }

  return { ok: true, signature, released_ids: releasedIds }
}

export async function unlockOwlCenterPlatformFeeRebatesAfterMintEnd(
  launch: Pick<
    OwlCenterLaunchPublic,
    'id' | 'active_phase' | 'status' | 'minted_count' | 'total_supply' | 'mint_mode' | 'mint_network'
  >,
  opts?: { attemptPayout?: boolean }
): Promise<
  | {
      ok: true
      marked: number
      payout?: { signature: string; released_ids: string[] } | { skipped: string }
    }
  | { ok: false; error: string }
> {
  if (!isOwlCenterLaunchMintEndedForRebate(launch)) {
    return { ok: true, marked: 0, payout: { skipped: 'mint_not_ended' } }
  }
  const marked = await markOwlCenterPlatformFeeRebatesReleasable(launch.id)
  if (!marked.ok) return marked

  if (opts?.attemptPayout === false) {
    return { ok: true, marked: marked.updated }
  }

  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_platform_fee_rebates')
    .select('*')
    .eq('launch_id', launch.id)
    .eq('state', 'releasable')

  const rows = (data ?? []).map((r) => mapRebateRow(r as Record<string, unknown>))
  if (rows.length === 0) {
    return { ok: true, marked: marked.updated, payout: { skipped: 'nothing_releasable' } }
  }

  const paid = await payRebateBatch({ launch, rows, notes: 'auto_release_on_mint_end' })
  if (!paid.ok) {
    return { ok: true, marked: marked.updated, payout: { skipped: paid.error } }
  }
  return {
    ok: true,
    marked: marked.updated,
    payout: { signature: paid.signature, released_ids: paid.released_ids },
  }
}

export async function adminReleaseOwlCenterPlatformFeeRebates(params: {
  launch: Pick<OwlCenterLaunchPublic, 'id' | 'mint_mode' | 'mint_network'>
  adminWallet: string
  includeLocked?: boolean
  notes?: string | null
}): Promise<
  | { ok: true; signature: string; released_ids: string[]; released_lamports: number }
  | { ok: false; error: string }
> {
  const db = getSupabaseAdmin()
  const states = params.includeLocked ? ['locked', 'releasable'] : ['releasable']
  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .select('*')
    .eq('launch_id', params.launch.id)
    .in('state', states)

  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []).map((r) => mapRebateRow(r as Record<string, unknown>))
  if (rows.length === 0) return { ok: false, error: 'nothing_to_release' }

  const paid = await payRebateBatch({
    launch: params.launch,
    rows,
    adminWallet: params.adminWallet,
    notes: params.notes ?? 'admin_release',
  })
  if (!paid.ok) return paid
  const released_lamports = rows
    .filter((r) => paid.released_ids.includes(r.id))
    .reduce((s, r) => s + r.rebate_lamports, 0)
  return {
    ok: true,
    signature: paid.signature,
    released_ids: paid.released_ids,
    released_lamports,
  }
}

export async function adminForfeitOwlCenterPlatformFeeRebates(params: {
  launchId: string
  adminWallet: string
  includeReleasable?: boolean
  notes?: string | null
}): Promise<{ ok: true; forfeited: number } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const states = params.includeReleasable !== false ? ['locked', 'releasable'] : ['locked']
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('owl_center_platform_fee_rebates')
    .update({
      state: 'forfeited',
      admin_wallet: params.adminWallet,
      notes: params.notes ?? 'admin_forfeit',
      updated_at: now,
    })
    .eq('launch_id', params.launchId)
    .in('state', states)
    .select('id')

  if (error) return { ok: false, error: error.message }
  return { ok: true, forfeited: data?.length ?? 0 }
}
