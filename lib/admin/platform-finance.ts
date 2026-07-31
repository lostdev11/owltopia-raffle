import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { listGenOwlRevSharePeriods } from '@/lib/db/gen-owl-rev-share-periods'

export type CurrencyBucket = {
  sol: number
  usdc: number
  owl: number
}

export type CurrencyBucketWithCount = CurrencyBucket & { count: number }

export type TicketActivityBucket = CurrencyBucket & {
  ticketsSold: number
  confirmedEntries: number
}

export type PlatformFinancePayload = {
  raffleSettlementFees: {
    accrued: CurrencyBucketWithCount
    collected: CurrencyBucketWithCount
    collected30d: CurrencyBucketWithCount
    pendingEscrow: CurrencyBucketWithCount
    medianDaysToClaim: number | null
  }
  auctionSettlementFees: {
    accrued: CurrencyBucketWithCount
    collected: CurrencyBucketWithCount
    pendingEscrow: CurrencyBucketWithCount
  }
  cancellationFees: CurrencyBucketWithCount
  ticketActivity: {
    last7Days: TicketActivityBucket
    last30Days: TicketActivityBucket
  }
  revShare: {
    claimsEnabled: boolean
    deposited: { sol: number; usdc: number }
    paid: { sol: number; usdc: number }
    unclaimedLiability: { sol: number; usdc: number }
    periods: Array<{
      periodMonth: string
      depositedSol: number
      depositedUsdc: number
      paidSol: number
      paidUsdc: number
      liabilitySol: number
      liabilityUsdc: number
    }>
  }
}

function emptyBucket(): CurrencyBucket {
  return { sol: 0, usdc: 0, owl: 0 }
}

function emptyBucketWithCount(): CurrencyBucketWithCount {
  return { ...emptyBucket(), count: 0 }
}

function emptyTicketActivity(): TicketActivityBucket {
  return { ...emptyBucket(), ticketsSold: 0, confirmedEntries: 0 }
}

function addCurrency(bucket: CurrencyBucket, currency: string, amount: number): void {
  const c = currency.toUpperCase()
  if (!Number.isFinite(amount) || amount <= 0) return
  if (c === 'USDC') bucket.usdc += amount
  else if (c === 'SOL') bucket.sol += amount
  else if (c === 'OWL') bucket.owl += amount
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function claimIsPaid(row: {
  amount_sol: number
  amount_usdc: number
  sol_transaction_signature: string | null
  usdc_transaction_signature: string | null
}): { paidSol: number; paidUsdc: number } {
  const needSol = row.amount_sol > 0
  const needUsdc = row.amount_usdc > 0
  const solPaid = !needSol || !!row.sol_transaction_signature?.trim()
  const usdcPaid = !needUsdc || !!row.usdc_transaction_signature?.trim()
  return {
    paidSol: solPaid ? row.amount_sol : 0,
    paidUsdc: usdcPaid ? row.amount_usdc : 0,
  }
}

/**
 * Admin Platform Finance aggregates: settlement fees (accrued vs collected on claim-proceeds),
 * cancellation fees, ticket volume, and Gen Owl rev-share cashflow.
 */
export async function getPlatformFinance(): Promise<PlatformFinancePayload> {
  const db = getSupabaseAdmin()
  const now = Date.now()
  const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    raffleFeesRes,
    auctionFeesRes,
    cancelRes,
    entriesRes,
    depositsRes,
    claimsRes,
    periods,
    schedule,
  ] = await Promise.all([
    db
      .from('raffles')
      .select(
        'platform_fee_amount, platform_fee_currency, currency, settled_at, creator_claimed_at, ticket_payments_to_funds_escrow'
      )
      .not('platform_fee_amount', 'is', null)
      .not('settled_at', 'is', null)
      .limit(20000),
    db
      .from('nft_auctions')
      .select('platform_fee_amount, bid_currency, creator_claimed_at')
      .not('platform_fee_amount', 'is', null)
      .limit(5000),
    db
      .from('raffles')
      .select('cancellation_fee_amount, cancellation_fee_currency, cancellation_fee_paid_at')
      .not('cancellation_fee_paid_at', 'is', null)
      .not('cancellation_fee_amount', 'is', null)
      .limit(5000),
    db
      .from('entries')
      .select('amount_paid, currency, ticket_quantity, verified_at, created_at')
      .eq('status', 'confirmed')
      .gte('created_at', since30)
      .limit(80000),
    db.from('gen_owl_rev_share_deposits').select('period_month, currency, amount').limit(5000),
    db
      .from('gen_owl_rev_share_claims')
      .select(
        'period_month, amount_sol, amount_usdc, sol_transaction_signature, usdc_transaction_signature'
      )
      .limit(50000),
    listGenOwlRevSharePeriods(36),
    getRevShareSchedule(),
  ])

  const raffleAccrued = emptyBucketWithCount()
  const raffleCollected = emptyBucketWithCount()
  const raffleCollected30d = emptyBucketWithCount()
  const rafflePending = emptyBucketWithCount()
  const claimLatenciesDays: number[] = []

  for (const row of raffleFeesRes.data ?? []) {
    const amount = Number(row.platform_fee_amount) || 0
    if (amount <= 0) continue
    const currency = String(row.platform_fee_currency || row.currency || 'SOL').toUpperCase()
    const claimedAt = row.creator_claimed_at ? String(row.creator_claimed_at) : null
    const settledAt = row.settled_at ? String(row.settled_at) : null

    addCurrency(raffleAccrued, currency, amount)
    raffleAccrued.count += 1

    if (claimedAt) {
      addCurrency(raffleCollected, currency, amount)
      raffleCollected.count += 1
      if (claimedAt >= since30) {
        addCurrency(raffleCollected30d, currency, amount)
        raffleCollected30d.count += 1
      }
      if (settledAt) {
        const days =
          (new Date(claimedAt).getTime() - new Date(settledAt).getTime()) / (24 * 60 * 60 * 1000)
        if (Number.isFinite(days) && days >= 0) claimLatenciesDays.push(days)
      }
    } else {
      addCurrency(rafflePending, currency, amount)
      rafflePending.count += 1
    }
  }

  const auctionAccrued = emptyBucketWithCount()
  const auctionCollected = emptyBucketWithCount()
  const auctionPending = emptyBucketWithCount()
  for (const row of auctionFeesRes.data ?? []) {
    const amount = Number(row.platform_fee_amount) || 0
    if (amount <= 0) continue
    const currency = String(row.bid_currency || 'SOL').toUpperCase()
    addCurrency(auctionAccrued, currency, amount)
    auctionAccrued.count += 1
    if (row.creator_claimed_at) {
      addCurrency(auctionCollected, currency, amount)
      auctionCollected.count += 1
    } else {
      addCurrency(auctionPending, currency, amount)
      auctionPending.count += 1
    }
  }

  const cancellationFees = emptyBucketWithCount()
  for (const row of cancelRes.data ?? []) {
    const amount = Number(row.cancellation_fee_amount) || 0
    if (amount <= 0) continue
    const currency = String(row.cancellation_fee_currency || 'SOL').toUpperCase()
    addCurrency(cancellationFees, currency, amount)
    cancellationFees.count += 1
  }

  function aggregateEntries(
    rows: Array<{
      amount_paid: unknown
      currency: unknown
      ticket_quantity: unknown
      verified_at?: string | null
      created_at?: string | null
    }>,
    sinceIso: string
  ): TicketActivityBucket {
    const out = emptyTicketActivity()
    for (const row of rows) {
      const t = row.verified_at || row.created_at
      if (!t || t < sinceIso) continue
      const amount = Number(row.amount_paid) || 0
      const qty = Number(row.ticket_quantity) || 0
      out.ticketsSold += qty
      out.confirmedEntries += 1
      addCurrency(out, String(row.currency || ''), amount)
    }
    return out
  }

  const ticketActivity = {
    last7Days: aggregateEntries(entriesRes.data ?? [], since7),
    last30Days: aggregateEntries(entriesRes.data ?? [], since30),
  }

  const depositedByPeriod = new Map<string, { sol: number; usdc: number }>()
  for (const row of depositsRes.data ?? []) {
    const period = String(row.period_month)
    const cur = depositedByPeriod.get(period) ?? { sol: 0, usdc: 0 }
    const amount = Number(row.amount) || 0
    if (String(row.currency).toUpperCase() === 'USDC') cur.usdc += amount
    else cur.sol += amount
    depositedByPeriod.set(period, cur)
  }

  const paidByPeriod = new Map<string, { sol: number; usdc: number }>()
  for (const row of claimsRes.data ?? []) {
    const period = String(row.period_month)
    const cur = paidByPeriod.get(period) ?? { sol: 0, usdc: 0 }
    const paid = claimIsPaid({
      amount_sol: Number(row.amount_sol) || 0,
      amount_usdc: Number(row.amount_usdc) || 0,
      sol_transaction_signature:
        row.sol_transaction_signature != null ? String(row.sol_transaction_signature) : null,
      usdc_transaction_signature:
        row.usdc_transaction_signature != null ? String(row.usdc_transaction_signature) : null,
    })
    cur.sol += paid.paidSol
    cur.usdc += paid.paidUsdc
    paidByPeriod.set(period, cur)
  }

  const periodMonths = new Set<string>([
    ...periods.map((p) => p.period_month),
    ...depositedByPeriod.keys(),
    ...paidByPeriod.keys(),
  ])

  const revPeriods: PlatformFinancePayload['revShare']['periods'] = [...periodMonths]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 24)
    .map((periodMonth) => {
      const periodRow = periods.find((p) => p.period_month === periodMonth)
      const deposited = depositedByPeriod.get(periodMonth) ?? {
        sol: (periodRow?.gen1_total_sol ?? 0) + (periodRow?.gen2_total_sol ?? 0),
        usdc: (periodRow?.gen1_total_usdc ?? 0) + (periodRow?.gen2_total_usdc ?? 0),
      }
      // Prefer deposit ledger totals when present; else period pool totals
      const hasDepositRow = depositedByPeriod.has(periodMonth)
      const depositedSol = hasDepositRow
        ? deposited.sol
        : (periodRow?.gen1_total_sol ?? 0) + (periodRow?.gen2_total_sol ?? 0)
      const depositedUsdc = hasDepositRow
        ? deposited.usdc
        : (periodRow?.gen1_total_usdc ?? 0) + (periodRow?.gen2_total_usdc ?? 0)
      const paid = paidByPeriod.get(periodMonth) ?? { sol: 0, usdc: 0 }
      return {
        periodMonth,
        depositedSol,
        depositedUsdc,
        paidSol: paid.sol,
        paidUsdc: paid.usdc,
        liabilitySol: Math.max(0, depositedSol - paid.sol),
        liabilityUsdc: Math.max(0, depositedUsdc - paid.usdc),
      }
    })

  const depositedTotal = { sol: 0, usdc: 0 }
  const paidTotal = { sol: 0, usdc: 0 }
  const liabilityTotal = { sol: 0, usdc: 0 }
  for (const p of revPeriods) {
    depositedTotal.sol += p.depositedSol
    depositedTotal.usdc += p.depositedUsdc
    paidTotal.sol += p.paidSol
    paidTotal.usdc += p.paidUsdc
    liabilityTotal.sol += p.liabilitySol
    liabilityTotal.usdc += p.liabilityUsdc
  }

  return {
    raffleSettlementFees: {
      accrued: raffleAccrued,
      collected: raffleCollected,
      collected30d: raffleCollected30d,
      pendingEscrow: rafflePending,
      medianDaysToClaim: median(claimLatenciesDays),
    },
    auctionSettlementFees: {
      accrued: auctionAccrued,
      collected: auctionCollected,
      pendingEscrow: auctionPending,
    },
    cancellationFees,
    ticketActivity,
    revShare: {
      claimsEnabled: schedule?.claims_enabled !== false,
      deposited: depositedTotal,
      paid: paidTotal,
      unclaimedLiability: liabilityTotal,
      periods: revPeriods,
    },
  }
}
