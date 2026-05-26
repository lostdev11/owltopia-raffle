import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { StakingRewardEventRow } from '@/lib/db/staking-reward-events'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  estimateAccruedRewards,
  estimateClaimableRewards,
  meetsMinOwlClaimThreshold,
  MIN_OWL_CLAIMABLE_TO_CLAIM,
} from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'

export type ClaimLedgerAuditFlag =
  | 'high_claimable_after_recent_payout'
  | 'repeat_onchain_claim_24h'
  | 'position_claimed_above_accrued'
  | 'ledger_behind_onchain_payouts'

export type PositionClaimAuditRow = {
  position_id: string
  status: StakingPositionRow['status']
  accrued_owl: number
  claimed_rewards_field: number
  claimable_owl: number
  ledger_claim_owl: number
  flags: string[]
}

export type WalletClaimLedgerAudit = {
  wallet_address: string
  active_nest_count: number
  estimated_claimable_owl: number
  nests_claimable_over_min: number
  ledger_claim_owl_total: number
  ledger_claim_event_count: number
  onchain_claim_tx_count_24h: number
  onchain_claim_owl_24h: number
  onchain_claim_tx_count_7d: number
  onchain_claim_owl_7d: number
  positions_claimed_above_accrued: number
  risk_flags: ClaimLedgerAuditFlag[]
  risk_summary: string
  positions: PositionClaimAuditRow[]
}

const MS_24H = 24 * 60 * 60 * 1000
const MS_7D = 7 * MS_24H

function isOwlPosition(row: Pick<StakingPositionRow, 'reward_token_snapshot'>): boolean {
  return (row.reward_token_snapshot ?? '').trim().toUpperCase() === 'OWL'
}

function auditPosition(
  row: StakingPositionRow,
  asOfMs: number,
  ledgerByPosition: Map<string, number>
): PositionClaimAuditRow {
  const stakedAtMs = new Date(row.staked_at).getTime()
  const accrued = estimateAccruedRewards({
    amount: Number(row.amount),
    rewardRateSnapshot: Number(row.reward_rate_snapshot),
    rewardRateUnitSnapshot: row.reward_rate_unit_snapshot as RewardRateUnit,
    stakedAtMs,
    asOfMs,
  })
  const claimedField = Number(row.claimed_rewards)
  const claimable =
    row.status === 'active'
      ? estimateClaimableRewards({
          amount: Number(row.amount),
          rewardRateSnapshot: Number(row.reward_rate_snapshot),
          rewardRateUnitSnapshot: row.reward_rate_unit_snapshot as RewardRateUnit,
          claimedRewards: claimedField,
          stakedAtMs,
          asOfMs,
        })
      : 0

  const flags: string[] = []
  if (claimedField > accrued + 1e-6) {
    flags.push('claimed_above_accrued')
  }

  return {
    position_id: row.id,
    status: row.status,
    accrued_owl: accrued,
    claimed_rewards_field: claimedField,
    claimable_owl: claimable,
    ledger_claim_owl: ledgerByPosition.get(row.id) ?? 0,
    flags,
  }
}

function buildWalletAudit(
  wallet: string,
  positions: StakingPositionRow[],
  claimEvents: StakingRewardEventRow[],
  asOfMs: number
): WalletClaimLedgerAudit {
  const ledgerByPosition = new Map<string, number>()
  for (const ev of claimEvents) {
    if (ev.event_type !== 'claim') continue
    const prev = ledgerByPosition.get(ev.position_id) ?? 0
    ledgerByPosition.set(ev.position_id, prev + Number(ev.amount))
  }

  const owlPositions = positions.filter(isOwlPosition)
  const positionRows = owlPositions.map((row) => auditPosition(row, asOfMs, ledgerByPosition))

  let estimatedClaimable = 0
  let nestsClaimableOverMin = 0
  let positionsAboveAccrued = 0
  for (const p of positionRows) {
    if (p.status !== 'active') continue
    estimatedClaimable += p.claimable_owl
    if (meetsMinOwlClaimThreshold(p.claimable_owl)) nestsClaimableOverMin += 1
    if (p.flags.includes('claimed_above_accrued')) positionsAboveAccrued += 1
  }

  const since24h = new Date(asOfMs - MS_24H).toISOString()
  const since7d = new Date(asOfMs - MS_7D).toISOString()

  const onchain24h = claimEvents.filter(
    (e) =>
      e.execution_path === 'onchain_transfer' &&
      e.transaction_signature?.trim() &&
      e.created_at >= since24h
  )
  const onchain7d = claimEvents.filter(
    (e) =>
      e.execution_path === 'onchain_transfer' &&
      e.transaction_signature?.trim() &&
      e.created_at >= since7d
  )

  const tx24h = new Set(onchain24h.map((e) => e.transaction_signature!.trim()))
  const tx7d = new Set(onchain7d.map((e) => e.transaction_signature!.trim()))
  const owl24h = onchain24h.reduce((s, e) => s + Number(e.amount), 0)
  const owl7d = onchain7d.reduce((s, e) => s + Number(e.amount), 0)
  const ledgerTotal = claimEvents
    .filter((e) => e.event_type === 'claim')
    .reduce((s, e) => s + Number(e.amount), 0)

  const riskFlags: ClaimLedgerAuditFlag[] = []

  if (tx24h.size >= 2 && owl24h >= MIN_OWL_CLAIMABLE_TO_CLAIM) {
    riskFlags.push('repeat_onchain_claim_24h')
  }
  if (positionsAboveAccrued > 0) {
    riskFlags.push('position_claimed_above_accrued')
  }
  if (
    meetsMinOwlClaimThreshold(estimatedClaimable) &&
    owl24h >= MIN_OWL_CLAIMABLE_TO_CLAIM &&
    estimatedClaimable >= 10
  ) {
    riskFlags.push('high_claimable_after_recent_payout')
  }
  if (owl7d > ledgerTotal + 1 && owl7d >= 10 && estimatedClaimable >= MIN_OWL_CLAIMABLE_TO_CLAIM) {
    riskFlags.push('ledger_behind_onchain_payouts')
  }

  const riskSummary =
    riskFlags.length === 0
      ? 'No incident patterns detected.'
      : riskFlags
          .map((f) => {
            switch (f) {
              case 'repeat_onchain_claim_24h':
                return `${tx24h.size} on-chain claim tx(s) in 24h (${owl24h.toFixed(4)} OWL) — possible Claim all double-pay.`
              case 'high_claimable_after_recent_payout':
                return `UI would show ~${estimatedClaimable.toFixed(4)} OWL claimable after ${owl24h.toFixed(4)} OWL on-chain in 24h.`
              case 'position_claimed_above_accrued':
                return `${positionsAboveAccrued} nest(s) have claimed_rewards above accrued (DB inconsistency).`
              case 'ledger_behind_onchain_payouts':
                return `7d on-chain claims (${owl7d.toFixed(4)} OWL) exceed ledger total (${ledgerTotal.toFixed(4)} OWL).`
              default:
                return f
            }
          })
          .join(' ')

  return {
    wallet_address: wallet,
    active_nest_count: owlPositions.filter((p) => p.status === 'active').length,
    estimated_claimable_owl: estimatedClaimable,
    nests_claimable_over_min: nestsClaimableOverMin,
    ledger_claim_owl_total: ledgerTotal,
    ledger_claim_event_count: claimEvents.filter((e) => e.event_type === 'claim').length,
    onchain_claim_tx_count_24h: tx24h.size,
    onchain_claim_owl_24h: owl24h,
    onchain_claim_tx_count_7d: tx7d.size,
    onchain_claim_owl_7d: owl7d,
    positions_claimed_above_accrued: positionsAboveAccrued,
    risk_flags: riskFlags,
    risk_summary: riskSummary,
    positions: positionRows,
  }
}

async function listRecentClaimEvents(sinceIso: string): Promise<StakingRewardEventRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_reward_events')
    .select(
      'id, position_id, wallet_address, event_type, amount, note, transaction_signature, execution_path, created_at'
    )
    .eq('event_type', 'claim')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) throw new Error(error.message)
  return (data || []) as StakingRewardEventRow[]
}

async function listActiveOwlWallets(): Promise<string[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('wallet_address')
    .eq('status', 'active')
    .ilike('reward_token_snapshot', 'owl')

  if (error) throw new Error(error.message)
  const set = new Set<string>()
  for (const row of data || []) {
    const w = (row as { wallet_address?: string }).wallet_address?.trim()
    if (w) set.add(w)
  }
  return [...set]
}

export type AuditNestingClaimLedgerParams = {
  /** Audit one wallet in detail. */
  wallet?: string
  /** Only return wallets with at least one risk flag. Default true for list mode. */
  flaggedOnly?: boolean
  /** Look back this many hours for claim events (default 168 = 7d). */
  lookbackHours?: number
}

export async function auditNestingClaimLedger(
  params: AuditNestingClaimLedgerParams = {}
): Promise<{ generated_at: string; wallets: WalletClaimLedgerAudit[] }> {
  const asOfMs = Date.now()
  const lookbackHours = Math.max(1, Math.min(params.lookbackHours ?? 168, 24 * 30))
  const sinceIso = new Date(asOfMs - lookbackHours * 60 * 60 * 1000).toISOString()
  const flaggedOnly = params.flaggedOnly !== false

  const recentEvents = await listRecentClaimEvents(sinceIso)
  const eventsByWallet = new Map<string, StakingRewardEventRow[]>()
  for (const ev of recentEvents) {
    const w = ev.wallet_address.trim()
    const list = eventsByWallet.get(w) ?? []
    list.push(ev)
    eventsByWallet.set(w, list)
  }

  const walletList = params.wallet?.trim()
    ? [params.wallet.trim()]
    : [...new Set([...(await listActiveOwlWallets()), ...eventsByWallet.keys()])]

  const wallets: WalletClaimLedgerAudit[] = []
  for (const wallet of walletList) {
    const positions = await listStakingPositionsByWallet(wallet)
    const events = eventsByWallet.get(wallet) ?? []
    const audit = buildWalletAudit(wallet, positions, events, asOfMs)
    if (!flaggedOnly || audit.risk_flags.length > 0) {
      wallets.push(audit)
    }
  }

  wallets.sort((a, b) => b.estimated_claimable_owl - a.estimated_claimable_owl)

  return { generated_at: new Date(asOfMs).toISOString(), wallets }
}

export type CatchUpClaimLedgerResult = {
  dry_run: boolean
  wallet: string
  positions_updated: number
  total_claimable_zeroed_owl: number
  adjustments: Array<{
    position_id: string
    previous_claimed_rewards: number
    new_claimed_rewards: number
    delta_owl: number
  }>
}

/**
 * After a failed Claim-all ledger sync, bump each active OWL nest's `claimed_rewards` to current accrued
 * so the holder cannot Claim all again for rewards already sent on-chain.
 */
export async function catchUpClaimLedgerForWallet(params: {
  wallet: string
  dryRun: boolean
  adminWallet: string
  note?: string
}): Promise<CatchUpClaimLedgerResult> {
  const wallet = params.wallet.trim()
  if (!wallet) throw new Error('wallet is required')

  const asOfMs = Date.now()
  const rows = await listStakingPositionsByWallet(wallet)
  const adjustments: CatchUpClaimLedgerResult['adjustments'] = []
  let totalZeroed = 0

  for (const row of rows) {
    if (row.status !== 'active' || !isOwlPosition(row)) continue

    const stakedAtMs = new Date(row.staked_at).getTime()
    const accrued = estimateAccruedRewards({
      amount: Number(row.amount),
      rewardRateSnapshot: Number(row.reward_rate_snapshot),
      rewardRateUnitSnapshot: row.reward_rate_unit_snapshot as RewardRateUnit,
      stakedAtMs,
      asOfMs,
    })
    const previous = Number(row.claimed_rewards)
    if (accrued <= previous + 1e-9) continue

    const delta = accrued - previous
    totalZeroed += delta
    adjustments.push({
      position_id: row.id,
      previous_claimed_rewards: previous,
      new_claimed_rewards: accrued,
      delta_owl: delta,
    })
  }

  if (!params.dryRun && adjustments.length > 0) {
    const db = getSupabaseAdmin()
    const note = (params.note ?? `admin_catchup:${params.adminWallet}`).trim()

    for (const adj of adjustments) {
      const { error: posErr } = await db
        .from('staking_positions')
        .update({ claimed_rewards: adj.new_claimed_rewards })
        .eq('id', adj.position_id)
        .eq('wallet_address', wallet)

      if (posErr) throw new Error(posErr.message)

      const { error: evErr } = await db.from('staking_reward_events').insert({
        position_id: adj.position_id,
        wallet_address: wallet,
        event_type: 'adjustment',
        amount: adj.delta_owl,
        note,
        transaction_signature: null,
        execution_path: null,
      })

      if (evErr) throw new Error(evErr.message)
    }
  }

  return {
    dry_run: params.dryRun,
    wallet,
    positions_updated: adjustments.length,
    total_claimable_zeroed_owl: totalZeroed,
    adjustments,
  }
}
