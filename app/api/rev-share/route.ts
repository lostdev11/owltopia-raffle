import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Compute total threshold per currency from all raffles (prize/floor). */
async function getThresholdsFromRaffles(supabase: ReturnType<typeof getSupabaseAdmin>) {
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

/**
 * GET /api/rev-share
 * Public. Returns total rev share pool (profit over threshold) in SOL and USDC.
 * 50% goes to founder, 50% to community; this returns the total pool amounts.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    const { data: entries, error: entriesError } = await supabase
      .from('entries')
      .select('amount_paid, currency')
      .eq('status', 'confirmed')

    if (entriesError) {
      console.error('Error fetching entries for rev-share:', entriesError)
      return NextResponse.json({ error: 'Failed to load rev share data' }, { status: 500 })
    }

    let sol = 0
    let usdc = 0
    for (const row of entries || []) {
      const amount = Number(row.amount_paid) || 0
      const c = (String(row.currency || '')).toUpperCase()
      if (c === 'SOL') sol += amount
      else if (c === 'USDC') usdc += amount
    }

    const thresholds = await getThresholdsFromRaffles(supabase)
    const thresholdSol = process.env.REVENUE_THRESHOLD_SOL != null && process.env.REVENUE_THRESHOLD_SOL !== ''
      ? Number(process.env.REVENUE_THRESHOLD_SOL)
      : thresholds.sol > 0 ? thresholds.sol : 0
    const thresholdUsdc = process.env.REVENUE_THRESHOLD_USDC != null && process.env.REVENUE_THRESHOLD_USDC !== ''
      ? Number(process.env.REVENUE_THRESHOLD_USDC)
      : thresholds.usdc > 0 ? thresholds.usdc : 0

    const profitSol = Math.max(0, sol - thresholdSol)
    const profitUsdc = Math.max(0, usdc - thresholdUsdc)

    return NextResponse.json({
      sol: Math.round(profitSol * 1e4) / 1e4,
      usdc: Math.round(profitUsdc * 1e2) / 1e2,
      // For showing the calculation: revenue, threshold, profit (over threshold), then 50/50 split
      calculation: {
        revenueSol: Math.round(sol * 1e4) / 1e4,
        revenueUsdc: Math.round(usdc * 1e2) / 1e2,
        thresholdSol: Math.round(thresholdSol * 1e4) / 1e4,
        thresholdUsdc: Math.round(thresholdUsdc * 1e2) / 1e2,
        overThresholdSol: Math.round(profitSol * 1e4) / 1e4,
        overThresholdUsdc: Math.round(profitUsdc * 1e2) / 1e2,
        founderSol: Math.round(profitSol * 0.5 * 1e4) / 1e4,
        founderUsdc: Math.round(profitUsdc * 0.5 * 1e2) / 1e2,
        communitySol: Math.round(profitSol * 0.5 * 1e4) / 1e4,
        communityUsdc: Math.round(profitUsdc * 0.5 * 1e2) / 1e2,
      },
    })
  } catch (error) {
    console.error('Error in rev-share API:', error)
    return NextResponse.json({ error: 'Failed to load rev share' }, { status: 500 })
  }
}
