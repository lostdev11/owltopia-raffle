import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/escrowed-nft-mints?wallet=<address>
 * Returns mint addresses of NFTs that are **still** in platform escrow for raffles created by this wallet.
 * Used by Create Raffle to hide those NFTs from "Load NFTs" so they don't appear as available.
 *
 * Important: `prize_deposited_at` stays set after the prize is returned to the creator or sent to a winner;
 * those rows must not be treated as escrowed or creators cannot re-list an NFT they got back.
 * Response: { mints: string[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet')?.trim()
  if (!wallet) {
    return NextResponse.json(
      { error: 'Missing wallet. Provide ?wallet=<address>.' },
      { status: 400 }
    )
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('raffles')
      .select('nft_mint_address, prize_returned_at, nft_transfer_transaction')
      .or(`created_by.eq.${wallet},creator_wallet.eq.${wallet}`)
      .not('prize_deposited_at', 'is', null)
      .not('nft_mint_address', 'is', null)

    if (error) {
      console.error('Error fetching escrowed NFT mints:', error)
      return NextResponse.json({ mints: [] })
    }

    const rows = (data || []) as Array<{
      nft_mint_address?: string | null
      prize_returned_at?: string | null
      nft_transfer_transaction?: string | null
    }>

    const mints = rows
      .filter((r) => !r.prize_returned_at && !(r.nft_transfer_transaction ?? '').trim())
      .map((r) => r.nft_mint_address)
      .filter((m): m is string => typeof m === 'string' && m.length > 0)

    return NextResponse.json({ mints })
  } catch {
    return NextResponse.json({ mints: [] })
  }
}
