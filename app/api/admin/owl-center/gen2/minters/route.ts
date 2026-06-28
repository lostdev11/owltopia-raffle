import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type MinterRow = { wallet: string; quantity: number }

type MintersPayload = {
  network: 'mainnet' | 'devnet'
  totalWallets: number
  totalMints: number
  wallets: MinterRow[]
}

/**
 * Aggregate unique minter wallets (with summed mint quantity) for the Gen2 launch
 * from owl_center_mint_events, newest-first paginated past PostgREST's 1000-row cap.
 */
async function aggregateGen2Minters(
  launchId: string,
  network: 'mainnet' | 'devnet'
): Promise<MintersPayload> {
  const db = getSupabaseAdmin()
  const pageSize = 1000
  let from = 0
  const totals = new Map<string, number>()

  for (;;) {
    const { data, error } = await db
      .from('owl_center_mint_events')
      .select('wallet_address,quantity')
      .eq('launch_id', launchId)
      .eq('network', network)
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    for (const r of rows) {
      const row = r as Record<string, unknown>
      const wallet = String(row.wallet_address ?? '').trim()
      const qty = Math.max(0, Math.floor(Number(row.quantity ?? 0)))
      if (!wallet || qty <= 0) continue
      totals.set(wallet, (totals.get(wallet) ?? 0) + qty)
    }

    if (rows.length < pageSize) break
    from += pageSize
  }

  const wallets = Array.from(totals.entries())
    .map(([wallet, quantity]) => ({ wallet, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.wallet.localeCompare(b.wallet))

  const totalMints = wallets.reduce((sum, w) => sum + w.quantity, 0)

  return { network, totalWallets: wallets.length, totalMints, wallets }
}

function toCsv(payload: MintersPayload): string {
  const lines = ['wallet,quantity', ...payload.wallets.map((w) => `${w.wallet},${w.quantity}`)]
  return lines.join('\n')
}

/**
 * GET /api/admin/owl-center/gen2/minters?network=mainnet&format=csv
 * Unique minter wallets with summed quantity for the Gen2 launch.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
    if (!launch) {
      return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
    }

    const sp = request.nextUrl.searchParams
    const network: 'mainnet' | 'devnet' = sp.get('network') === 'devnet' ? 'devnet' : 'mainnet'

    const payload = await aggregateGen2Minters(launch.id, network)

    if (sp.get('format') === 'csv') {
      return new NextResponse(toCsv(payload), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="gen2-minters-${network}.csv"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[admin/owl-center/gen2/minters]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
