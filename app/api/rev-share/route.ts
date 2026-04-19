import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { STANDARD_FEE_BPS } from '@/lib/config/raffles'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rev-share
 * Public. Returns site fee revenue and holder rev share amounts (50% of site fee to holders).
 *
 * Uses list-style fee tier resolution (search-first DAS, no deep wallet scan) to limit Helius credits.
 * Not consumed by the web app; intended for transparency tools or manual checks.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    const { data: entries, error: entriesError } = await supabase
      .from('entries')
      .select('amount_paid, currency, raffle_id')
      .eq('status', 'confirmed')

    if (entriesError) {
      console.error('Error fetching entries for rev-share:', entriesError)
      return NextResponse.json({ error: 'Failed to load rev share data' }, { status: 500 })
    }

    const raffleIds = Array.from(
      new Set((entries || []).map((e) => String(e.raffle_id || '').trim()).filter(Boolean))
    )

    const raffleCreatorById = new Map<string, string>()
    if (raffleIds.length > 0) {
      const { data: raffles, error: rafflesError } = await supabase
        .from('raffles')
        .select('id, creator_wallet, created_by')
        .in('id', raffleIds)

      if (rafflesError) {
        console.error('Error fetching raffles for rev-share:', rafflesError)
        return NextResponse.json({ error: 'Failed to load rev share data' }, { status: 500 })
      }

      for (const r of raffles || []) {
        const creatorWallet = String(r.creator_wallet || r.created_by || '').trim()
        raffleCreatorById.set(String(r.id), creatorWallet)
      }
    }

    const feeTierByCreator = new Map<string, number>()
    let siteRevenueSol = 0
    let siteRevenueUsdc = 0

    for (const row of entries || []) {
      const amount = Number(row.amount_paid) || 0
      if (!Number.isFinite(amount) || amount <= 0) continue
      const c = String(row.currency || '').toUpperCase()
      if (c !== 'SOL' && c !== 'USDC') continue

      const raffleId = String(row.raffle_id || '')
      const creatorWallet = raffleCreatorById.get(raffleId) || ''
      const normalized = creatorWallet.trim()

      let feeBps = STANDARD_FEE_BPS
      if (normalized) {
        let bps = feeTierByCreator.get(normalized)
        if (bps == null) {
          const tier = await getCreatorFeeTier(normalized, { listDisplayOnly: true })
          bps = tier.feeBps
          feeTierByCreator.set(normalized, bps)
        }
        feeBps = bps
      }

      const feeAmount = Math.floor(Math.round(amount * 1_000_000_000) * feeBps / 10_000) / 1_000_000_000

      if (c === 'SOL') siteRevenueSol += feeAmount
      else siteRevenueUsdc += feeAmount
    }

    const holdersSol = siteRevenueSol * 0.5
    const holdersUsdc = siteRevenueUsdc * 0.5

    return NextResponse.json({
      sol: Math.round(holdersSol * 1e4) / 1e4,
      usdc: Math.round(holdersUsdc * 1e2) / 1e2,
      calculation: {
        siteRevenueSol: Math.round(siteRevenueSol * 1e4) / 1e4,
        siteRevenueUsdc: Math.round(siteRevenueUsdc * 1e2) / 1e2,
        holdersSol: Math.round(holdersSol * 1e4) / 1e4,
        holdersUsdc: Math.round(holdersUsdc * 1e2) / 1e2,
        feeTierNote:
          'Creator fee bps use list-style holder detection (Helius search-first). Deep wallet scans are not run here.',
      },
    })
  } catch (error) {
    console.error('Error in rev-share API:', error)
    return NextResponse.json({ error: 'Failed to load rev share' }, { status: 500 })
  }
}
