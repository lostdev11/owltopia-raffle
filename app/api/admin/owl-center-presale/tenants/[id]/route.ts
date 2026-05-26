import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getOwlCenterPresaleTenantById,
  sanitizePreviewImagesInput,
  updateOwlCenterPresaleTenant,
} from '@/lib/db/owl-center-presale-tenants'
import { sumOwlCenterPresaleSold } from '@/lib/owl-center-presale/db'
import { OWL_CENTER_PRESALE_DEFAULT_THEME } from '@/lib/owl-center-presale/constants'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function parseHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const t = raw.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(t) ? t : fallback
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number | undefined {
  if (raw === undefined) return undefined
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  return Math.min(max, n)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await context.params
    const existing = await getOwlCenterPresaleTenantById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Parameters<typeof updateOwlCenterPresaleTenant>[1] = {
      updated_by_wallet: session.wallet,
    }

    if (typeof body.slug === 'string') {
      const slug = normalizeOwlCenterPresaleSlug(body.slug)
      if (!slug) {
        return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
      }
      patch.slug = slug
    }
    if (typeof body.display_name === 'string' && body.display_name.trim()) {
      patch.display_name = body.display_name.trim()
    }
    if (body.headline !== undefined) {
      patch.headline = typeof body.headline === 'string' ? body.headline : null
    }
    if (body.description !== undefined) {
      patch.description = typeof body.description === 'string' ? body.description : null
    }
    if (typeof body.treasury_wallet === 'string') {
      const treasury = normalizeSolanaWalletAddress(body.treasury_wallet)
      if (!treasury) {
        return NextResponse.json({ error: 'Invalid treasury_wallet' }, { status: 400 })
      }
      patch.treasury_wallet = treasury
    }
    if (body.partner_wallet !== undefined) {
      if (body.partner_wallet === null || body.partner_wallet === '') {
        patch.partner_wallet = null
      } else if (typeof body.partner_wallet === 'string') {
        const pw = normalizeSolanaWalletAddress(body.partner_wallet)
        if (!pw) {
          return NextResponse.json({ error: 'Invalid partner_wallet' }, { status: 400 })
        }
        patch.partner_wallet = pw
      }
    }
    if (typeof body.is_enabled === 'boolean') patch.is_enabled = body.is_enabled
    if (typeof body.is_live === 'boolean') patch.is_live = body.is_live

    const unitPrice = parsePositiveInt(body.unit_price_usdc, existing.unit_price_usdc, 10_000)
    if (unitPrice !== undefined) patch.unit_price_usdc = unitPrice
    const supply = parsePositiveInt(body.presale_supply, existing.presale_supply, 1_000_000)
    if (supply !== undefined) patch.presale_supply = supply
    const maxPurchase = parsePositiveInt(body.max_spots_per_purchase, existing.max_spots_per_purchase, 100)
    if (maxPurchase !== undefined) patch.max_spots_per_purchase = maxPurchase
    const maxWallet = parsePositiveInt(body.max_credits_per_wallet, existing.max_credits_per_wallet, 500)
    if (maxWallet !== undefined) patch.max_credits_per_wallet = maxWallet
    const sortOrder = parsePositiveInt(body.sort_order, existing.sort_order, 10_000)
    if (sortOrder !== undefined) patch.sort_order = sortOrder

    if (body.preview_images !== undefined) {
      patch.preview_images = sanitizePreviewImagesInput(body.preview_images)
    }

    if (body.theme && typeof body.theme === 'object') {
      const themeBody = body.theme as Record<string, unknown>
      patch.theme = {
        primary: parseHexColor(themeBody.primary, existing.theme.primary),
        accent: parseHexColor(themeBody.accent, existing.theme.accent),
        background: parseHexColor(themeBody.background, existing.theme.background),
        surface: parseHexColor(themeBody.surface, existing.theme.surface),
        muted: parseHexColor(themeBody.muted, existing.theme.muted),
      }
    }

    const tenant = await updateOwlCenterPresaleTenant(id, patch)
    if (!tenant) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    const sold = await sumOwlCenterPresaleSold(tenant.id)
    return NextResponse.json({
      tenant: { ...tenant, sold, remaining: Math.max(0, tenant.presale_supply - sold) },
    })
  } catch (error) {
    console.error('[admin/owl-center-presale PATCH]', error)
    const msg = safeErrorMessage(error)
    if (msg.includes('owl_center_presale_tenants_slug_unique')) {
      return NextResponse.json({ error: 'That slug is already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
