import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

export interface RevenueBucket {
  usdc: number
  sol: number
  owl: number
  ticketsSold: number
  confirmedEntries: number
}

export interface CurrencyThresholdBreakdown {
  revenueToThreshold: number
  profit: number
  /** Estimated tickets sold that count toward threshold (by revenue share) */
  ticketsToThreshold: number
  /** Estimated tickets sold beyond threshold (profit) */
  ticketsBeyondThreshold: number
}

export interface ProjectedRevenueResponse {
  allTime: RevenueBucket
  last7Days: RevenueBucket
  last30Days: RevenueBucket
  avgPerDay7: Omit<RevenueBucket, 'confirmedEntries'>
  avgPerDay30: Omit<RevenueBucket, 'confirmedEntries'>
  /** Thresholds: computed from raffle prize/floor values; env vars override when set. */
  thresholds?: { usdc?: number; sol?: number; owl?: number }
  /** When threshold is set for a currency: revenue to threshold, profit, tickets to/beyond threshold */
  byCurrency?: {
    usdc?: CurrencyThresholdBreakdown
    sol?: CurrencyThresholdBreakdown
    owl?: CurrencyThresholdBreakdown
  }
}

function parseThreshold(envKey: string): number | undefined {
  const v = process.env[envKey]
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Compute total threshold per currency from all raffles (prize value or floor price). */
async function getThresholdsFromRaffles(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<{ usdc: number; sol: number; owl: number }> {
  const { data: raffles, error } = await supabase
    .from('raffles')
    .select('prize_type, prize_amount, prize_currency, floor_price, currency')

  const out = { usdc: 0, sol: 0, owl: 0 }
  if (error || !raffles?.length) return out

  for (const r of raffles) {
    const prizeType = (r.prize_type || 'crypto').toString().toLowerCase()
    if (prizeType === 'nft') {
      const fp = r.floor_price != null ? parseFloat(String(r.floor_price)) : NaN
      const cur = (r.currency || 'SOL').toString().toUpperCase()
      if (Number.isFinite(fp) && fp >= 0 && (cur === 'USDC' || cur === 'SOL' || cur === 'OWL')) {
        if (cur === 'USDC') out.usdc += fp
        else if (cur === 'SOL') out.sol += fp
        else out.owl += fp
      }
    } else {
      const amount = r.prize_amount != null ? Number(r.prize_amount) : NaN
      const cur = (r.prize_currency || r.currency || 'SOL').toString().toUpperCase()
      if (Number.isFinite(amount) && amount >= 0 && (cur === 'USDC' || cur === 'SOL' || cur === 'OWL')) {
        if (cur === 'USDC') out.usdc += amount
        else if (cur === 'SOL') out.sol += amount
        else out.owl += amount
      }
    }
  }
  return out
}

function aggregate(rows: Array<{ amount_paid: unknown; currency: unknown; ticket_quantity: unknown }>): RevenueBucket {
  let usdc = 0
  let sol = 0
  let owl = 0
  let ticketsSold = 0
  for (const row of rows) {
    const amount = Number(row.amount_paid) || 0
    const qty = Number(row.ticket_quantity) || 0
    ticketsSold += qty
    const currency = (String(row.currency || '')).toUpperCase()
    if (currency === 'USDC') usdc += amount
    else if (currency === 'SOL') sol += amount
    else if (currency === 'OWL') owl += amount
  }
  return { usdc, sol, owl, ticketsSold, confirmedEntries: rows.length }
}

/** Also return ticket counts per currency for threshold breakdown. */
function aggregateWithTicketCounts(rows: Array<{ amount_paid: unknown; currency: unknown; ticket_quantity: unknown }>) {
  let usdc = 0
  let sol = 0
  let owl = 0
  let ticketsUsdc = 0
  let ticketsSol = 0
  let ticketsOwl = 0
  for (const row of rows) {
    const amount = Number(row.amount_paid) || 0
    const qty = Number(row.ticket_quantity) || 0
    const currency = (String(row.currency || '')).toUpperCase()
    if (currency === 'USDC') {
      usdc += amount
      ticketsUsdc += qty
    } else if (currency === 'SOL') {
      sol += amount
      ticketsSol += qty
    } else if (currency === 'OWL') {
      owl += amount
      ticketsOwl += qty
    }
  }
  return {
    usdc,
    sol,
    owl,
    ticketsSold: ticketsUsdc + ticketsSol + ticketsOwl,
    confirmedEntries: rows.length,
    ticketsUsdc,
    ticketsSol,
    ticketsOwl,
  }
}

/**
 * GET /api/admin/projected-revenue
 * Returns projected revenue from confirmed entries. Admin only (session required).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { data: entries, error } = await getSupabaseAdmin()
      .from('entries')
      .select('amount_paid, currency, ticket_quantity, verified_at, created_at')
      .eq('status', 'confirmed')

    if (error) {
      console.error('Error fetching confirmed entries for revenue:', error)
      return NextResponse.json(
        { error: 'Failed to load revenue data' },
        { status: 500 }
      )
    }

    const rows = entries || []
    const now = Date.now()
    const ms7 = 7 * 24 * 60 * 60 * 1000
    const ms30 = 30 * 24 * 60 * 60 * 1000
    const since7 = new Date(now - ms7).toISOString()
    const since30 = new Date(now - ms30).toISOString()

    const rows7 = rows.filter((r: { verified_at?: string | null; created_at?: string | null }) => {
      const t = r.verified_at || r.created_at
      return t && t >= since7
    })
    const rows30 = rows.filter((r: { verified_at?: string | null; created_at?: string | null }) => {
      const t = r.verified_at || r.created_at
      return t && t >= since30
    })

    const allTimeAgg = aggregateWithTicketCounts(rows)
    const allTime: RevenueBucket = {
      usdc: allTimeAgg.usdc,
      sol: allTimeAgg.sol,
      owl: allTimeAgg.owl,
      ticketsSold: allTimeAgg.ticketsSold,
      confirmedEntries: allTimeAgg.confirmedEntries,
    }
    const last7Days = aggregate(rows7)
    const last30Days = aggregate(rows30)
    const avgPerDay7 = {
      usdc: last7Days.usdc / 7,
      sol: last7Days.sol / 7,
      owl: last7Days.owl / 7,
      ticketsSold: last7Days.ticketsSold / 7,
    }
    const avgPerDay30 = {
      usdc: last30Days.usdc / 30,
      sol: last30Days.sol / 30,
      owl: last30Days.owl / 30,
      ticketsSold: last30Days.ticketsSold / 30,
    }

    const fromRaffles = await getThresholdsFromRaffles(getSupabaseAdmin())
    const thresholdUsdc = parseThreshold('REVENUE_THRESHOLD_USDC') ?? (fromRaffles.usdc > 0 ? fromRaffles.usdc : undefined)
    const thresholdSol = parseThreshold('REVENUE_THRESHOLD_SOL') ?? (fromRaffles.sol > 0 ? fromRaffles.sol : undefined)
    const thresholdOwl = parseThreshold('REVENUE_THRESHOLD_OWL') ?? (fromRaffles.owl > 0 ? fromRaffles.owl : undefined)
    const hasThresholds = thresholdUsdc != null || thresholdSol != null || thresholdOwl != null

    const byCurrency: ProjectedRevenueResponse['byCurrency'] = {}
    const thresholds: ProjectedRevenueResponse['thresholds'] = {}

    if (thresholdUsdc != null) {
      thresholds.usdc = thresholdUsdc
      const rev = allTimeAgg.usdc
      const toThresh = Math.min(rev, thresholdUsdc)
      const profit = Math.max(0, rev - thresholdUsdc)
      const ticketsInCurrency = allTimeAgg.ticketsUsdc
      const revRatio = rev > 0 ? toThresh / rev : 0
      byCurrency.usdc = {
        revenueToThreshold: toThresh,
        profit,
        ticketsToThreshold: Math.round(ticketsInCurrency * revRatio),
        ticketsBeyondThreshold: Math.round(ticketsInCurrency * (1 - revRatio)),
      }
    }
    if (thresholdSol != null) {
      thresholds.sol = thresholdSol
      const rev = allTimeAgg.sol
      const toThresh = Math.min(rev, thresholdSol)
      const profit = Math.max(0, rev - thresholdSol)
      const ticketsInCurrency = allTimeAgg.ticketsSol
      const revRatio = rev > 0 ? toThresh / rev : 0
      byCurrency.sol = {
        revenueToThreshold: toThresh,
        profit,
        ticketsToThreshold: Math.round(ticketsInCurrency * revRatio),
        ticketsBeyondThreshold: Math.round(ticketsInCurrency * (1 - revRatio)),
      }
    }
    if (thresholdOwl != null) {
      thresholds.owl = thresholdOwl
      const rev = allTimeAgg.owl
      const toThresh = Math.min(rev, thresholdOwl)
      const profit = Math.max(0, rev - thresholdOwl)
      const ticketsInCurrency = allTimeAgg.ticketsOwl
      const revRatio = rev > 0 ? toThresh / rev : 0
      byCurrency.owl = {
        revenueToThreshold: toThresh,
        profit,
        ticketsToThreshold: Math.round(ticketsInCurrency * revRatio),
        ticketsBeyondThreshold: Math.round(ticketsInCurrency * (1 - revRatio)),
      }
    }

    const response: ProjectedRevenueResponse = {
      allTime,
      last7Days,
      last30Days,
      avgPerDay7,
      avgPerDay30,
      ...(hasThresholds && { thresholds, byCurrency }),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in projected-revenue:', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
