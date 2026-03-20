import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { getEscrowTokenAccountForMint, isMplCoreAssetInEscrow } from '@/lib/raffles/prize-escrow'
import { PublicKey } from '@solana/web3.js'

export const dynamic = 'force-dynamic'

const rpcUrl =
  process.env.SOLANA_RPC_URL?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  ''
const isDevnet = /devnet/i.test(rpcUrl)

/**
 * GET /api/raffles/[id]/escrow-check-url
 * Returns explorer URLs so users can verify the listed prize mint and (for SPL) escrow custody.
 * - `prizeMintUrl`: Solscan token page for the mint (matches the raffle’s prize identity).
 * - `custodyUrl`: SPL/Token-2022 = escrow’s ATA for that mint; Mpl Core = same as prizeMintUrl (owner on page).
 * - `url`: legacy field, same as `custodyUrl` for backward compatibility.
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

    const mintStr = raffle.nft_mint_address.trim()
    const mint = new PublicKey(mintStr)
    const cluster = isDevnet ? '?cluster=devnet' : ''
    // Mpl Core assets use an asset account (not SPL mint); /account/ is the correct Solscan URL.
    // SPL/Token-2022 use /token/ for the mint page.
    const prizeStandard = (raffle as { prize_standard?: string | null }).prize_standard
    const prizeMintUrl =
      prizeStandard === 'mpl_core'
        ? `https://solscan.io/account/${mintStr}${cluster}`
        : `https://solscan.io/token/${mintStr}${cluster}`

    const ata = await getEscrowTokenAccountForMint(mint)
    if (ata) {
      const custodyUrl = `https://solscan.io/account/${ata.toBase58()}${cluster}`
      return NextResponse.json({
        url: custodyUrl,
        prizeMintUrl,
        custodyUrl,
      })
    }

    let inCoreEscrow = false
    try {
      inCoreEscrow = await isMplCoreAssetInEscrow(mintStr)
    } catch {
      inCoreEscrow = false
    }
    if (inCoreEscrow) {
      return NextResponse.json({
        url: prizeMintUrl,
        prizeMintUrl,
        custodyUrl: prizeMintUrl,
      })
    }

    return NextResponse.json(
      {
        error:
          'Escrow custody not found on-chain for this mint. The NFT may not be in escrow yet, or it may use a standard this link does not cover (e.g. compressed NFT).',
      },
      { status: 404 }
    )
  } catch (error) {
    console.error('Escrow check URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build URL' },
      { status: 500 }
    )
  }
}
