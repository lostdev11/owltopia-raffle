import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  deletePartnerCommunityCreator,
  updatePartnerCommunityCreator,
} from '@/lib/db/partner-community-creators-admin'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
const VALID_PARTNER_TIERS = new Set(['$0_partner', 'partner_pro', 'white_label'])

function parseOptionalPartnerProMonthlyQuoteUsdc(body: Record<string, unknown>):
  | { ok: true; value: number | null | undefined }
  | { ok: false; error: string } {
  if (!('partner_pro_monthly_quote_usdc' in body)) return { ok: true, value: undefined }
  const raw = body.partner_pro_monthly_quote_usdc
  if (raw === null) return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 500) {
    return { ok: false, error: 'partner_pro_monthly_quote_usdc must be null or an integer 1–500' }
  }
  return { ok: true, value: n }
}

function walletFromParams(params: { wallet: string }): string | null {
  const decoded = decodeURIComponent(params.wallet ?? '').trim()
  return normalizeSolanaWalletAddress(decoded)
}

/**
 * PATCH /api/admin/partner-community-creators/[wallet]
 * Body: { display_label?, sort_order?, is_active? }
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ wallet: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const creator_wallet = walletFromParams(params)
    if (!creator_wallet) {
      return NextResponse.json({ error: 'Invalid wallet in path' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: {
      display_label?: string | null
      partner_tier?: '$0_partner' | 'partner_pro' | 'white_label'
      sort_order?: number
      is_active?: boolean
      discord_partner_tenant_id?: string | null
      partner_pro_monthly_quote_usdc?: number | null
    } = {}

    if ('display_label' in body) {
      if (body.display_label === null) {
        patch.display_label = null
      } else if (typeof body.display_label === 'string') {
        patch.display_label = body.display_label.trim() || null
      } else {
        return NextResponse.json({ error: 'display_label must be a string or null' }, { status: 400 })
      }
    }
    if ('sort_order' in body && body.sort_order !== null && body.sort_order !== undefined) {
      const n = Number(body.sort_order)
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return NextResponse.json({ error: 'sort_order must be an integer' }, { status: 400 })
      }
      patch.sort_order = n
    }
    if ('partner_tier' in body) {
      if (typeof body.partner_tier !== 'string') {
        return NextResponse.json({ error: 'partner_tier must be a string' }, { status: 400 })
      }
      const tier = body.partner_tier.trim()
      if (!VALID_PARTNER_TIERS.has(tier)) {
        return NextResponse.json({ error: 'partner_tier must be $0_partner, partner_pro, or white_label' }, { status: 400 })
      }
      patch.partner_tier = tier as '$0_partner' | 'partner_pro' | 'white_label'
    }
    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 })
      }
      patch.is_active = body.is_active
    }
    if ('discord_partner_tenant_id' in body) {
      if (body.discord_partner_tenant_id === null) {
        patch.discord_partner_tenant_id = null
      } else if (typeof body.discord_partner_tenant_id === 'string') {
        const t = body.discord_partner_tenant_id.trim()
        patch.discord_partner_tenant_id = t || null
      } else {
        return NextResponse.json(
          { error: 'discord_partner_tenant_id must be a string or null' },
          { status: 400 }
        )
      }
    }

    if ('partner_pro_monthly_quote_usdc' in body) {
      const parsed = parseOptionalPartnerProMonthlyQuoteUsdc(body as Record<string, unknown>)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      patch.partner_pro_monthly_quote_usdc = parsed.value as number | null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const row = await updatePartnerCommunityCreator(creator_wallet, patch)
    clearPartnerCommunityWalletCache()
    return NextResponse.json({ creator: row })
  } catch (error) {
    console.error('[admin/partner-community-creators PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/partner-community-creators/[wallet] — removes the row (not just inactive).
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ wallet: string }> }) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const creator_wallet = walletFromParams(params)
    if (!creator_wallet) {
      return NextResponse.json({ error: 'Invalid wallet in path' }, { status: 400 })
    }

    await deletePartnerCommunityCreator(creator_wallet)
    clearPartnerCommunityWalletCache()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin/partner-community-creators DELETE]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
