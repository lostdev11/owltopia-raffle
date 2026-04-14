import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { HOLDER_FEE_BPS, PARTNER_COMMUNITY_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'
import { ownsOwltopia } from '@/lib/platform-fees'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'

export const dynamic = 'force-dynamic'

type FeeTierReason = 'holder' | 'standard' | 'partner_community'
type FeeTier = { feeBps: number; reason: FeeTierReason }

async function resolveCreatorFeeTier(
  creatorWallet: string,
  cache: Map<string, FeeTier>,
  partnerSet: Set<string>
): Promise<FeeTier> {
  const normalized = creatorWallet.trim()
  if (!normalized) return { feeBps: STANDARD_FEE_BPS, reason: 'standard' }
  const cached = cache.get(normalized)
  if (cached) return cached

  if (partnerSet.has(normalized)) {
    const tier: FeeTier = { feeBps: PARTNER_COMMUNITY_FEE_BPS, reason: 'partner_community' }
    cache.set(normalized, tier)
    return tier
  }

  const isHolder = await ownsOwltopia(normalized, { skipCache: true, deepWalletScan: true })
  const tier: FeeTier = isHolder
    ? { feeBps: HOLDER_FEE_BPS, reason: 'holder' }
    : { feeBps: STANDARD_FEE_BPS, reason: 'standard' }
  cache.set(normalized, tier)
  return tier
}

/**
 * GET /api/rev-share
 * Public. Returns site fee revenue and holder rev share amounts.
 * 50% of raffle site fee revenue goes to holders.
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

    const feeTierByCreator = new Map<string, FeeTier>()
    const partnerSet = await getActivePartnerCommunityWalletSet()
    let siteRevenueSol = 0
    let siteRevenueUsdc = 0

    for (const row of entries || []) {
      const amount = Number(row.amount_paid) || 0
      if (!Number.isFinite(amount) || amount <= 0) continue
      const c = String(row.currency || '').toUpperCase()
      if (c !== 'SOL' && c !== 'USDC') continue

      const raffleId = String(row.raffle_id || '')
      const creatorWallet = raffleCreatorById.get(raffleId) || ''
      const { feeBps } = await resolveCreatorFeeTier(creatorWallet, feeTierByCreator, partnerSet)
      const feeAmount = Math.floor(Math.round(amount * 1_000_000_000) * feeBps / 10_000) / 1_000_000_000

      if (c === 'SOL') siteRevenueSol += feeAmount
      else siteRevenueUsdc += feeAmount
    }

    const holdersSol = siteRevenueSol * 0.5
    const holdersUsdc = siteRevenueUsdc * 0.5

    return NextResponse.json({
      sol: Math.round(holdersSol * 1e4) / 1e4,
      usdc: Math.round(holdersUsdc * 1e2) / 1e2,
      // Calculation details for transparency.
      calculation: {
        siteRevenueSol: Math.round(siteRevenueSol * 1e4) / 1e4,
        siteRevenueUsdc: Math.round(siteRevenueUsdc * 1e2) / 1e2,
        holdersSol: Math.round(holdersSol * 1e4) / 1e4,
        holdersUsdc: Math.round(holdersUsdc * 1e2) / 1e2,
      },
    })
  } catch (error) {
    console.error('Error in rev-share API:', error)
    return NextResponse.json({ error: 'Failed to load rev share' }, { status: 500 })
  }
}
