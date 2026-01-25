import { NextRequest, NextResponse } from 'next/server'
import { getRestoredEntries } from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * GET restored entries
 * Query params: wallet - optional wallet address to filter by
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const walletAddress = searchParams.get('wallet')

    // Optional: Check if user is admin (for security)
    const authHeader = request.headers.get('authorization')
    if (authHeader) {
      try {
        const walletFromHeader = authHeader.replace('Bearer ', '')
        const isUserAdmin = await isAdmin(walletFromHeader)
        if (!isUserAdmin) {
          return NextResponse.json(
            { error: 'Unauthorized: Admin access required' },
            { status: 403 }
          )
        }
      } catch (e) {
        // If auth check fails, continue anyway (for flexibility)
      }
    }

    // Get restored entries
    const restoredEntries = await getRestoredEntries(walletAddress || undefined)

    // Enrich entries with raffle information
    const entriesWithRaffles = await Promise.all(
      restoredEntries.map(async (entry) => {
        const raffle = await getRaffleById(entry.raffle_id)
        return {
          ...entry,
          raffle: raffle ? {
            id: raffle.id,
            slug: raffle.slug,
            title: raffle.title,
          } : null,
        }
      })
    )

    // Group by wallet address to show wallets with multiple failed entries
    const byWallet = entriesWithRaffles.reduce((acc, entry) => {
      const wallet = entry.wallet_address.toLowerCase()
      if (!acc[wallet]) {
        acc[wallet] = []
      }
      acc[wallet].push(entry)
      return acc
    }, {} as Record<string, typeof entriesWithRaffles>)

    return NextResponse.json({
      restoredEntries: entriesWithRaffles,
      byWallet: Object.entries(byWallet).map(([wallet, entries]) => ({
        wallet,
        count: entries.length,
        entries,
      })),
      total: entriesWithRaffles.length,
      uniqueWallets: Object.keys(byWallet).length,
    })
  } catch (error) {
    console.error('Error fetching restored entries:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    )
  }
}
