import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getDisplayNamesByWallets, upsertWalletProfile } from '@/lib/db/wallet-profiles'
import { profileUpdateBody } from '@/lib/validations'

export const dynamic = 'force-dynamic'

const MAX_WALLETS_QUERY = 200

/**
 * GET /api/profiles?wallets=addr1,addr2,...
 * Returns display names for the given wallet addresses. Public (no auth). Used by participant lists.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const walletsParam = searchParams.get('wallets')
    const wallets = walletsParam
      ? walletsParam
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean)
          .slice(0, MAX_WALLETS_QUERY)
      : []

    if (wallets.length === 0) {
      return NextResponse.json({})
    }

    const map = await getDisplayNamesByWallets(wallets)
    return NextResponse.json(map)
  } catch (error) {
    console.error('Profiles GET error:', error)
    return NextResponse.json({}, { status: 500 })
  }
}

/**
 * POST /api/profiles
 * Body: { displayName }. Sets display name for the signed-in wallet. Requires session.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const parsed = profileUpdateBody.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors.displayName?.join(', ') || 'Invalid display name (1–32 characters)'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const result = await upsertWalletProfile(session.wallet, parsed.data.displayName)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Profiles POST error:', error)
    return NextResponse.json(
      { error: 'Failed to save display name' },
      { status: 500 }
    )
  }
}
