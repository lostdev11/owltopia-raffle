import { NextRequest, NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getCoinArtUpgradeAuthorityPublic,
  upsertCoinArtUpgradeAuthority,
} from '@/lib/db/coin-art-upgrade-authority'
import { getCoinArtUpgradeDelegateStatus } from '@/lib/coin-upgrade/delegate-status'
import {
  clearCoinArtUpdateAuthorityKeypairCache,
  getCoinArtUpdateAuthorityKeypairFromEnv,
  resolveCoinArtUpdateAuthoritySource,
  resolveCoinArtUpdateAuthorityWallet,
} from '@/lib/coin-upgrade/update-authority-keypair'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/coin-upgrade/hot-key
 * Public hot-key status for admin (never returns the secret).
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const [wallet, source, dbPublic, delegate] = await Promise.all([
      resolveCoinArtUpdateAuthorityWallet(),
      resolveCoinArtUpdateAuthoritySource(),
      getCoinArtUpgradeAuthorityPublic(),
      getCoinArtUpgradeDelegateStatus(),
    ])
    const envOverride = Boolean(getCoinArtUpdateAuthorityKeypairFromEnv())
    return NextResponse.json({
      wallet_address: wallet || null,
      source,
      env_override: envOverride,
      database: dbPublic,
      authorized: delegate.authorized,
      authorize_url: '/coin-upgrade/authorize',
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/hot-key GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * POST /api/admin/coin-upgrade/hot-key
 * Body: { rotate?: boolean }
 * Creates (or rotates) the server hot key in the DB. Secret never leaves the server.
 * If COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY is set in Vercel, env still wins for signing —
 * clear that env to use the DB key.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const rotate = body?.rotate === true

    const existing = await getCoinArtUpgradeAuthorityPublic()
    if (existing && !rotate) {
      return NextResponse.json(
        {
          error: 'A hot key already exists. Pass rotate: true to replace it (Gembird must re-authorize).',
          wallet_address: existing.wallet_address,
        },
        { status: 409 }
      )
    }

    if (getCoinArtUpdateAuthorityKeypairFromEnv()) {
      return NextResponse.json(
        {
          error:
            'COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY is set in the server environment and takes precedence. Remove that env (and WALLET) to manage the hot key from Admin.',
        },
        { status: 409 }
      )
    }

    const kp = Keypair.generate()
    const secretJson = JSON.stringify(Array.from(kp.secretKey))
    const row = await upsertCoinArtUpgradeAuthority({
      wallet_address: kp.publicKey.toBase58(),
      secret_key: secretJson,
      created_by: session.wallet,
      rotating: Boolean(existing),
    })
    clearCoinArtUpdateAuthorityKeypairCache()

    return NextResponse.json({
      ok: true,
      wallet_address: row.wallet_address,
      rotated: Boolean(existing),
      authorize_url: '/coin-upgrade/authorize',
      message:
        'Hot key saved on the server. Fund this address with a little SOL, then send Gembird /coin-upgrade/authorize.',
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/hot-key POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
