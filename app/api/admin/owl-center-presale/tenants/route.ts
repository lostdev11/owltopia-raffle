import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import {
  insertOwlCenterPresaleTenant,
  listOwlCenterPresaleTenantsAdmin,
  sanitizePreviewImagesInput,
} from '@/lib/db/owl-center-presale-tenants'
import { sumOwlCenterPresaleSold } from '@/lib/owl-center-presale/db'
import { OWL_CENTER_PRESALE_DEFAULT_THEME } from '@/lib/owl-center-presale/constants'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function parseHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const t = raw.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(t) ? t : fallback
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  return Math.min(max, n)
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const tenants = await listOwlCenterPresaleTenantsAdmin()
    const enriched = await Promise.all(
      tenants.map(async (t) => {
        let sold = 0
        try {
          sold = await sumOwlCenterPresaleSold(t.id)
        } catch {
          sold = 0
        }
        return {
          ...t,
          sold,
          remaining: Math.max(0, t.presale_supply - sold),
        }
      })
    )
    return NextResponse.json({ tenants: enriched })
  } catch (error) {
    console.error('[admin/owl-center-presale GET]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const slugRaw = typeof body.slug === 'string' ? body.slug : ''
    const slug = normalizeOwlCenterPresaleSlug(slugRaw)
    if (!slug) {
      return NextResponse.json({ error: 'slug must be lowercase letters, numbers, and hyphens' }, { status: 400 })
    }

    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
    if (!displayName) {
      return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
    }

    const treasuryRaw = typeof body.treasury_wallet === 'string' ? body.treasury_wallet : ''
    const treasury = normalizeSolanaWalletAddress(treasuryRaw)
    if (!treasury) {
      return NextResponse.json({ error: 'treasury_wallet must be a valid Solana address' }, { status: 400 })
    }

    let partnerWallet: string | null = null
    if (typeof body.partner_wallet === 'string' && body.partner_wallet.trim()) {
      partnerWallet = normalizeSolanaWalletAddress(body.partner_wallet)
      if (!partnerWallet) {
        return NextResponse.json({ error: 'partner_wallet is not a valid Solana address' }, { status: 400 })
      }
    }

    const themeBody = body.theme && typeof body.theme === 'object' ? (body.theme as Record<string, unknown>) : {}

    const tenant = await insertOwlCenterPresaleTenant({
      slug,
      display_name: displayName,
      headline: typeof body.headline === 'string' ? body.headline : null,
      description: typeof body.description === 'string' ? body.description : null,
      treasury_wallet: treasury,
      partner_wallet: partnerWallet,
      is_enabled: body.is_enabled === true,
      is_live: body.is_live === true,
      unit_price_usdc: parsePositiveInt(body.unit_price_usdc, 20, 10_000),
      presale_supply: parsePositiveInt(body.presale_supply, 100, 1_000_000),
      max_spots_per_purchase: parsePositiveInt(body.max_spots_per_purchase, 5, 100),
      max_credits_per_wallet: parsePositiveInt(body.max_credits_per_wallet, 20, 500),
      sort_order: parsePositiveInt(body.sort_order, 0, 10_000),
      preview_images: sanitizePreviewImagesInput(body.preview_images),
      theme: {
        primary: parseHexColor(themeBody.primary, OWL_CENTER_PRESALE_DEFAULT_THEME.primary),
        accent: parseHexColor(themeBody.accent, OWL_CENTER_PRESALE_DEFAULT_THEME.accent),
        background: parseHexColor(themeBody.background, OWL_CENTER_PRESALE_DEFAULT_THEME.background),
        surface: parseHexColor(themeBody.surface, OWL_CENTER_PRESALE_DEFAULT_THEME.surface),
        muted: parseHexColor(themeBody.muted, OWL_CENTER_PRESALE_DEFAULT_THEME.muted),
      },
      updated_by_wallet: session.wallet,
    })

    return NextResponse.json({ tenant }, { status: 201 })
  } catch (error) {
    console.error('[admin/owl-center-presale POST]', error)
    const msg = safeErrorMessage(error)
    if (msg.includes('owl_center_presale_tenants_slug_unique')) {
      return NextResponse.json({ error: 'That slug is already in use' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
