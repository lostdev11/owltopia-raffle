import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  insertPartnerCommunityCreator,
  listPartnerCommunityCreatorsAdmin,
  type PartnerCommunityCreatorRow,
} from '@/lib/db/partner-community-creators-admin'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-community-creators — full admin; lists all allowlisted partner creator wallets.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const creators = await listPartnerCommunityCreatorsAdmin()
    const wallets = creators.map((c) => c.creator_wallet).filter(Boolean)
    const profileNames = await getDisplayNamesByWallets(wallets)
    const enriched: (PartnerCommunityCreatorRow & { profile_display_name: string | null })[] = creators.map(
      (c) => ({
        ...c,
        profile_display_name: profileNames[c.creator_wallet]?.trim() || null,
      })
    )
    return NextResponse.json({ creators: enriched })
  } catch (error) {
    console.error('[admin/partner-community-creators GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('partner_community') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Table missing. Run migration 062_partner_community_creators.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/partner-community-creators
 * Body: { creator_wallet, display_label?, sort_order?, is_active? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const rawWallet = typeof body.creator_wallet === 'string' ? body.creator_wallet : ''
    const creator_wallet = normalizeSolanaWalletAddress(rawWallet)
    if (!creator_wallet) {
      return NextResponse.json({ error: 'creator_wallet must be a valid Solana address' }, { status: 400 })
    }

    let display_label: string | null | undefined
    if (body.display_label === null || body.display_label === undefined) {
      display_label = body.display_label === null ? null : undefined
    } else if (typeof body.display_label === 'string') {
      display_label = body.display_label.trim() || null
    } else {
      return NextResponse.json({ error: 'display_label must be a string or null' }, { status: 400 })
    }

    let sort_order = 0
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = Number(body.sort_order)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return NextResponse.json({ error: 'sort_order must be an integer' }, { status: 400 })
      }
      sort_order = n
    }

    const is_active = typeof body.is_active === 'boolean' ? body.is_active : true

    let discord_partner_tenant_id: string | null | undefined
    if (body.discord_partner_tenant_id === null) {
      discord_partner_tenant_id = null
    } else if (body.discord_partner_tenant_id === undefined) {
      discord_partner_tenant_id = undefined
    } else if (typeof body.discord_partner_tenant_id === 'string') {
      const t = body.discord_partner_tenant_id.trim()
      discord_partner_tenant_id = t || null
    } else {
      return NextResponse.json(
        { error: 'discord_partner_tenant_id must be a string, null, or omitted' },
        { status: 400 }
      )
    }

    const row = await insertPartnerCommunityCreator({
      creator_wallet,
      display_label: display_label === undefined ? null : display_label,
      sort_order,
      is_active,
      discord_partner_tenant_id,
    })
    clearPartnerCommunityWalletCache()
    return NextResponse.json({ creator: row })
  } catch (error) {
    console.error('[admin/partner-community-creators POST]', error)
    const msg = safeErrorMessage(error)
    if (msg.includes('duplicate') || msg.toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'That wallet is already in the partner list.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
