import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import {
  getOwlCenterPresaleTenantById,
  sanitizePreviewImagesInput,
  updateOwlCenterPresaleTenant,
} from '@/lib/db/owl-center-presale-tenants'
import {
  requirePartnerOrAdminForPresale,
  tenantOwnedByWallet,
} from '@/lib/owl-center-presale/access'
import { OWL_CENTER_PRESALE_DEFAULT_THEME } from '@/lib/owl-center-presale/constants'
import {
  normalizeOwlCenterPresaleCaps,
  parseOwlCenterPresaleMaxCreditsPerWallet,
  parseOwlCenterPresaleMaxSpotsPerPurchase,
  parseOwlCenterPresalePriceUsdc,
  parseOwlCenterPresaleSupply,
} from '@/lib/owl-center-presale/limits'
import { normalizeOwlCenterPresaleSlug, owlCenterPresalePublicPath } from '@/lib/owl-center-presale/slug'
import { sumOwlCenterPresaleSold } from '@/lib/owl-center-presale/db'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function parseHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const t = raw.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(t) ? t : fallback
}

/** PATCH — partner updates own campaign (content while pending; go-live when approved). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const access = await requirePartnerOrAdminForPresale(session.wallet)
    if (!access.ok) return access.response

    const { id } = await context.params
    const tenant = await getOwlCenterPresaleTenantById(id)
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!access.isAdmin && !tenantOwnedByWallet(tenant, session.wallet)) {
      return NextResponse.json({ error: 'Not your campaign' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Parameters<typeof updateOwlCenterPresaleTenant>[1] = {
      updated_by_wallet: normalizeSolanaWalletAddress(session.wallet),
    }

    const editableContent =
      access.isAdmin || tenant.approval_status === 'pending' || tenant.approval_status === 'approved'

    if (editableContent) {
      if (typeof body.display_name === 'string' && body.display_name.trim()) {
        patch.display_name = body.display_name.trim()
      }
      if (body.headline !== undefined) {
        patch.headline = typeof body.headline === 'string' ? body.headline : null
      }
      if (body.description !== undefined) {
        patch.description = typeof body.description === 'string' ? body.description : null
      }
      if (typeof body.partner_wallet === 'string' && body.partner_wallet.trim()) {
        const pw = normalizeSolanaWalletAddress(body.partner_wallet)
        if (!pw) return NextResponse.json({ error: 'Invalid partner_wallet' }, { status: 400 })
        patch.partner_wallet = pw
        patch.treasury_wallet = pw
      }
      if (body.unit_price_usdc !== undefined) {
        patch.unit_price_usdc = parseOwlCenterPresalePriceUsdc(body.unit_price_usdc, tenant.unit_price_usdc)
      }
      if (body.presale_supply !== undefined) {
        patch.presale_supply = parseOwlCenterPresaleSupply(body.presale_supply, tenant.presale_supply)
      }
      if (body.max_spots_per_purchase !== undefined || body.max_credits_per_wallet !== undefined) {
        const caps = normalizeOwlCenterPresaleCaps({
          max_spots_per_purchase: parseOwlCenterPresaleMaxSpotsPerPurchase(
            body.max_spots_per_purchase,
            tenant.max_spots_per_purchase
          ),
          max_credits_per_wallet: parseOwlCenterPresaleMaxCreditsPerWallet(
            body.max_credits_per_wallet,
            tenant.max_credits_per_wallet
          ),
        })
        patch.max_spots_per_purchase = caps.max_spots_per_purchase
        patch.max_credits_per_wallet = caps.max_credits_per_wallet
      }
      if (body.preview_images !== undefined) {
        patch.preview_images = sanitizePreviewImagesInput(body.preview_images)
      }
      if (body.theme && typeof body.theme === 'object') {
        const themeBody = body.theme as Record<string, unknown>
        patch.theme = {
          primary: parseHexColor(themeBody.primary, tenant.theme.primary),
          accent: parseHexColor(themeBody.accent, tenant.theme.accent),
          background: parseHexColor(themeBody.background, tenant.theme.background),
          surface: parseHexColor(themeBody.surface, tenant.theme.surface),
          muted: parseHexColor(themeBody.muted, tenant.theme.muted),
        }
      }
      if (typeof body.slug === 'string' && (access.isAdmin || tenant.approval_status === 'pending')) {
        const slug = normalizeOwlCenterPresaleSlug(body.slug)
        if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
        patch.slug = slug
      }
    }

    // Partner can flip live only after approval + enabled.
    if (typeof body.is_live === 'boolean') {
      if (tenant.approval_status !== 'approved' || !tenant.is_enabled) {
        if (!access.isAdmin) {
          return NextResponse.json(
            { error: 'Campaign must be approved before going live.' },
            { status: 403 }
          )
        }
      }
      patch.is_live = body.is_live
    }

    const updated = await updateOwlCenterPresaleTenant(id, patch)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let sold = 0
    try {
      sold = await sumOwlCenterPresaleSold(updated.id)
    } catch {
      sold = 0
    }

    return NextResponse.json({
      tenant: {
        ...updated,
        sold,
        remaining: Math.max(0, updated.presale_supply - sold),
        presale_url: owlCenterPresalePublicPath(updated.slug),
      },
    })
  } catch (error) {
    console.error('[partners/owl-center-presale PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
