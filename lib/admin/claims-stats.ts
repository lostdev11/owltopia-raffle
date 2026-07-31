import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { listGenOwlRevSharePeriods, type GenOwlRevSharePeriodRow } from '@/lib/db/gen-owl-rev-share-periods'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import {
  estimateClaimableRewards,
} from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'

export type ClaimsStatsPeriodRow = {
  periodMonth: string
  finalized: boolean
  eligibleGen1: number
  eligibleGen2: number
  eligibleTotal: number
  claimedGen1: number
  claimedGen2: number
  claimedTotal: number
  claimRate: number | null
  paidSol: number
  paidUsdc: number
  uniqueWallets: number
  liabilitySol: number
  liabilityUsdc: number
  medianHoursToClaim: number | null
  p90HoursToClaim: number | null
  partialCount: number
}

export type ClaimsStatsPayload = {
  claimsEnabled: boolean
  pulse: {
    periodMonth: string | null
    claimRate: number | null
    paidSol: number
    paidUsdc: number
    liabilitySol: number
    liabilityUsdc: number
    uniqueWallets: number
  }
  periods: ClaimsStatsPeriodRow[]
  risk: {
    partialClaims: Array<{
      id: string
      periodMonth: string
      walletAddress: string
      amountSol: number
      amountUsdc: number
      hasSolSig: boolean
      hasUsdcSig: boolean
    }>
  }
  engagement: {
    avgUnclaimedMonthsPerWallet: number | null
    top10WalletSharePaid: number | null
    claimWithin48hRate: number | null
  }
  owl: {
    claimVolume24h: { amount: number; count: number }
    claimVolume7d: { amount: number; count: number }
    claimVolume30d: { amount: number; count: number }
    claimableOverhang: number
    activeOwlNests: number
    onchainShare: number | null
    dbOnlyShare: number | null
  }
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null
  if (sortedAsc.length === 1) return sortedAsc[0]!
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]!
  const w = idx - lo
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w
}

function claimWindowOpenMs(periodMonth: string, finalizedAt: string | null): number {
  // Claims open 00:00 UTC on the last calendar day of the period month
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m) return finalizedAt ? new Date(finalizedAt).getTime() : Date.now()
  const lastDay = new Date(Date.UTC(y, m, 0, 0, 0, 0, 0))
  const openMs = lastDay.getTime()
  if (finalizedAt) {
    const fin = new Date(finalizedAt).getTime()
    if (Number.isFinite(fin)) return Math.max(openMs, fin)
  }
  return openMs
}

function periodPoolTotals(p: GenOwlRevSharePeriodRow): { sol: number; usdc: number } {
  return {
    sol: (p.gen1_total_sol ?? 0) + (p.gen2_total_sol ?? 0),
    usdc: (p.gen1_total_usdc ?? 0) + (p.gen2_total_usdc ?? 0),
  }
}

/**
 * Admin Claims Analytics (Tier 1 + Tier 2) for Gen Owl rev share and OWL nest rewards.
 */
export async function getClaimsStats(): Promise<ClaimsStatsPayload> {
  const db = getSupabaseAdmin()
  const now = Date.now()
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [periods, claimsRes, schedule, owlEventsRes, owlPositionsRes] = await Promise.all([
    listGenOwlRevSharePeriods(36),
    db
      .from('gen_owl_rev_share_claims')
      .select(
        'id, period_month, wallet_address, group_key, amount_sol, amount_usdc, sol_transaction_signature, usdc_transaction_signature, claimed_at'
      )
      .limit(50000),
    getRevShareSchedule(),
    db
      .from('staking_reward_events')
      .select('amount, execution_path, created_at')
      .eq('event_type', 'claim')
      .gte('created_at', since30d)
      .limit(50000),
    db
      .from('staking_positions')
      .select(
        'amount, reward_rate_snapshot, reward_rate_unit_snapshot, claimed_rewards, staked_at, reward_token_snapshot, status'
      )
      .eq('status', 'active')
      .ilike('reward_token_snapshot', 'OWL')
      .limit(20000),
  ])

  const claims = (claimsRes.data ?? []).map((row) => ({
    id: String(row.id),
    periodMonth: String(row.period_month),
    walletAddress: String(row.wallet_address),
    groupKey: String(row.group_key || ''),
    amountSol: Number(row.amount_sol) || 0,
    amountUsdc: Number(row.amount_usdc) || 0,
    solSig: row.sol_transaction_signature != null ? String(row.sol_transaction_signature).trim() : '',
    usdcSig:
      row.usdc_transaction_signature != null ? String(row.usdc_transaction_signature).trim() : '',
    claimedAt: String(row.claimed_at),
  }))

  const claimsByPeriod = new Map<string, typeof claims>()
  for (const c of claims) {
    const list = claimsByPeriod.get(c.periodMonth) ?? []
    list.push(c)
    claimsByPeriod.set(c.periodMonth, list)
  }

  const periodRows: ClaimsStatsPeriodRow[] = periods.map((p) => {
    const periodClaims = claimsByPeriod.get(p.period_month) ?? []
    const eligibleGen1 = p.gen1_eligible_count ?? 0
    const eligibleGen2 = p.gen2_eligible_count ?? 0
    const eligibleTotal = eligibleGen1 + eligibleGen2
    let claimedGen1 = 0
    let claimedGen2 = 0
    let paidSol = 0
    let paidUsdc = 0
    let partialCount = 0
    const wallets = new Set<string>()
    const hoursToClaim: number[] = []
    const openMs = claimWindowOpenMs(p.period_month, p.finalized_at)

    for (const c of periodClaims) {
      wallets.add(c.walletAddress)
      if (c.groupKey.includes('gen1')) claimedGen1 += 1
      else if (c.groupKey.includes('gen2')) claimedGen2 += 1
      else claimedGen1 += 1

      const needSol = c.amountSol > 0
      const needUsdc = c.amountUsdc > 0
      const hasSol = !!c.solSig
      const hasUsdc = !!c.usdcSig
      if (needSol && hasSol) paidSol += c.amountSol
      if (needUsdc && hasUsdc) paidUsdc += c.amountUsdc

      const solOk = !needSol || hasSol
      const usdcOk = !needUsdc || hasUsdc
      if ((needSol || needUsdc) && (hasSol || hasUsdc) && !(solOk && usdcOk)) {
        partialCount += 1
      }

      const claimedMs = new Date(c.claimedAt).getTime()
      if (Number.isFinite(claimedMs) && claimedMs >= openMs) {
        hoursToClaim.push((claimedMs - openMs) / (60 * 60 * 1000))
      }
    }

    const claimedTotal = periodClaims.length
    const pool = periodPoolTotals(p)
    const hoursSorted = [...hoursToClaim].sort((a, b) => a - b)

    return {
      periodMonth: p.period_month,
      finalized: !!p.finalized_at,
      eligibleGen1,
      eligibleGen2,
      eligibleTotal,
      claimedGen1,
      claimedGen2,
      claimedTotal,
      claimRate: eligibleTotal > 0 ? claimedTotal / eligibleTotal : null,
      paidSol,
      paidUsdc,
      uniqueWallets: wallets.size,
      liabilitySol: Math.max(0, pool.sol - paidSol),
      liabilityUsdc: Math.max(0, pool.usdc - paidUsdc),
      medianHoursToClaim: percentile(hoursSorted, 0.5),
      p90HoursToClaim: percentile(hoursSorted, 0.9),
      partialCount,
    }
  })

  const pulsePeriod = periodRows[0] ?? null

  const partialClaims = claims
    .filter((c) => {
      const needSol = c.amountSol > 0
      const needUsdc = c.amountUsdc > 0
      const solOk = !needSol || !!c.solSig
      const usdcOk = !needUsdc || !!c.usdcSig
      return (needSol || needUsdc) && (!!c.solSig || !!c.usdcSig) && !(solOk && usdcOk)
    })
    .slice(0, 50)
    .map((c) => ({
      id: c.id,
      periodMonth: c.periodMonth,
      walletAddress: c.walletAddress,
      amountSol: c.amountSol,
      amountUsdc: c.amountUsdc,
      hasSolSig: !!c.solSig,
      hasUsdcSig: !!c.usdcSig,
    }))

  // Engagement: stacking — for each wallet with any claim, how many finalized periods still unclaimed
  const finalizedPeriods = periods.filter((p) => p.finalized_at)
  const claimedKeys = new Set(claims.map((c) => `${c.walletAddress}|${c.periodMonth}`))
  const walletsWithClaims = new Set(claims.map((c) => c.walletAddress))
  let stackSum = 0
  let stackWallets = 0
  for (const wallet of walletsWithClaims) {
    let unclaimed = 0
    for (const p of finalizedPeriods) {
      if (!claimedKeys.has(`${wallet}|${p.period_month}`)) unclaimed += 1
    }
    if (finalizedPeriods.length > 0) {
      stackSum += unclaimed
      stackWallets += 1
    }
  }

  // Whale concentration: top 10 wallets by paid SOL+USDC share
  const paidByWallet = new Map<string, number>()
  let paidAll = 0
  for (const c of claims) {
    const paid = (c.solSig ? c.amountSol : 0) + (c.usdcSig ? c.amountUsdc : 0)
    if (paid <= 0) continue
    paidAll += paid
    paidByWallet.set(c.walletAddress, (paidByWallet.get(c.walletAddress) ?? 0) + paid)
  }
  const top10 = [...paidByWallet.values()].sort((a, b) => b - a).slice(0, 10)
  const top10Sum = top10.reduce((s, n) => s + n, 0)

  // 48h claim rate among claims that eventually happened
  let within48 = 0
  let withLatency = 0
  for (const c of claims) {
    const period = periods.find((p) => p.period_month === c.periodMonth)
    if (!period) continue
    const openMs = claimWindowOpenMs(c.periodMonth, period.finalized_at)
    const claimedMs = new Date(c.claimedAt).getTime()
    if (!Number.isFinite(claimedMs) || claimedMs < openMs) continue
    withLatency += 1
    if (claimedMs - openMs <= 48 * 60 * 60 * 1000) within48 += 1
  }

  // OWL volumes
  const vol = {
    claimVolume24h: { amount: 0, count: 0 },
    claimVolume7d: { amount: 0, count: 0 },
    claimVolume30d: { amount: 0, count: 0 },
  }
  let onchain = 0
  let dbOnly = 0
  for (const row of owlEventsRes.data ?? []) {
    const amount = Number(row.amount) || 0
    const created = String(row.created_at)
    const path = String(row.execution_path || '')
    if (path === 'onchain_transfer') onchain += 1
    else if (path === 'database_only') dbOnly += 1
    vol.claimVolume30d.amount += amount
    vol.claimVolume30d.count += 1
    if (created >= since7d) {
      vol.claimVolume7d.amount += amount
      vol.claimVolume7d.count += 1
    }
    if (created >= since24h) {
      vol.claimVolume24h.amount += amount
      vol.claimVolume24h.count += 1
    }
  }
  const pathTotal = onchain + dbOnly

  let claimableOverhang = 0
  let activeOwlNests = 0
  for (const row of owlPositionsRes.data ?? []) {
    activeOwlNests += 1
    const claimable = estimateClaimableRewards({
      amount: Number(row.amount) || 0,
      rewardRateSnapshot: Number(row.reward_rate_snapshot) || 0,
      rewardRateUnitSnapshot: (row.reward_rate_unit_snapshot || 'daily') as RewardRateUnit,
      claimedRewards: Number(row.claimed_rewards) || 0,
      stakedAtMs: new Date(String(row.staked_at)).getTime(),
      asOfMs: now,
    })
    if (claimable > 0) claimableOverhang += claimable
  }

  return {
    claimsEnabled: schedule?.claims_enabled !== false,
    pulse: {
      periodMonth: pulsePeriod?.periodMonth ?? null,
      claimRate: pulsePeriod?.claimRate ?? null,
      paidSol: pulsePeriod?.paidSol ?? 0,
      paidUsdc: pulsePeriod?.paidUsdc ?? 0,
      liabilitySol: pulsePeriod?.liabilitySol ?? 0,
      liabilityUsdc: pulsePeriod?.liabilityUsdc ?? 0,
      uniqueWallets: pulsePeriod?.uniqueWallets ?? 0,
    },
    periods: periodRows,
    risk: { partialClaims },
    engagement: {
      avgUnclaimedMonthsPerWallet: stackWallets > 0 ? stackSum / stackWallets : null,
      top10WalletSharePaid: paidAll > 0 ? top10Sum / paidAll : null,
      claimWithin48hRate: withLatency > 0 ? within48 / withLatency : null,
    },
    owl: {
      ...vol,
      claimableOverhang,
      activeOwlNests,
      onchainShare: pathTotal > 0 ? onchain / pathTotal : null,
      dbOnlyShare: pathTotal > 0 ? dbOnly / pathTotal : null,
    },
  }
}
