import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { getEscrowTokenAccountForMint } from '@/lib/raffles/prize-escrow'
import { PublicKey } from '@solana/web3.js'

export const dynamic = 'force-dynamic'

const rpcUrl =
  process.env.SOLANA_RPC_URL?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  ''
const isDevnet = /devnet/i.test(rpcUrl)

/**
 * GET /api/raffles/[id]/escrow-check-url
 * Returns a block explorer URL to view the escrow's token account for this raffle's NFT.
 * Used so users can verify the NFT is in escrow without exposing the escrow address on the app.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address) {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }

    const mint = new PublicKey(raffle.nft_mint_address)
    const ata = await getEscrowTokenAccountForMint(mint)
    if (!ata) {
      return NextResponse.json(
        {
          error:
            'Escrow account not found on-chain. The NFT may not have been transferred to escrow yet (e.g. raffle still draft or transfer was not completed). Supports SPL Token and Token-2022 NFTs.',
        },
        { status: 404 }
      )
    }

    const cluster = isDevnet ? '?cluster=devnet' : ''
    const url = `https://solscan.io/account/${ata.toBase58()}${cluster}`

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Escrow check URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build URL' },
      { status: 500 }
    )
  }
}
