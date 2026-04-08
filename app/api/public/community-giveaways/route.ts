import { NextResponse } from 'next/server'
import { countEntriesByGiveawayId, listPublicCommunityGiveaways } from '@/lib/db/community-giveaways'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export type PublicCommunityGiveawayListItem = {
  id: string
  title: string
  description: string | null
  access_gate: string
  status: string
  starts_at: string
  ends_at: string | null
  nft_mint_address: string
  entryCount: number
  prizeDeposited: boolean
  winnerDrawn: boolean
  claimed: boolean
}

function sortForBrowse(a: PublicCommunityGiveawayListItem, b: PublicCommunityGiveawayListItem): number {
  const rank = (g: PublicCommunityGiveawayListItem) => {
    if (g.status === 'open' && g.prizeDeposited) return 0
    if (g.status === 'open') return 1
    if (g.status === 'drawn') return 2
    return 3
  }
  const dr = rank(a) - rank(b)
  if (dr !== 0) return dr
  return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
}

/**
 * GET /api/public/community-giveaways
 * Browse list for the /raffles Giveaways tab (no secrets).
 */
export async function GET() {
  try {
    const rows = await listPublicCommunityGiveaways(80)
    const items: PublicCommunityGiveawayListItem[] = await Promise.all(
      rows.map(async (g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        access_gate: g.access_gate,
        status: g.status,
        starts_at: g.starts_at,
        ends_at: g.ends_at,
        nft_mint_address: g.nft_mint_address,
        entryCount: await countEntriesByGiveawayId(g.id),
        prizeDeposited: Boolean(g.prize_deposited_at),
        winnerDrawn: Boolean(g.winner_wallet),
        claimed: Boolean(g.claimed_at),
      }))
    )
    items.sort(sortForBrowse)
    return NextResponse.json(
      { giveaways: items },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (error) {
    console.error('[public/community-giveaways list]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
