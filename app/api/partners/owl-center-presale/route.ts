import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import {
  insertOwlCenterPresaleTenant,
  listOwlCenterPresaleTenantsByCreator,
  sanitizePreviewImagesInput,
} from '@/lib/db/owl-center-presale-tenants'
import { requirePartnerOrAdminForPresale } from '@/lib/owl-center-presale/access'
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
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function parseHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const t = raw.trim()
  return /^#[0-9A-Fa-f]{6}$/.test(t) ? t : fallback
}

/** GET — list partner's own presale campaigns. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const access = await requirePartnerOrAdminForPresale(session.wallet)
    if (!access.ok) return access.response

    const wallet = normalizeSolanaWalletAddress(session.wallet)
    if (!wallet) return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })

    const tenants = await listOwlCenterPresaleTenantsByCreator(wallet)
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
          presale_url: owlCenterPresalePublicPath(t.slug),
        }
      })
    )
    return NextResponse.json({ tenants: enriched })
  } catch (error) {
    console.error('[partners/owl-center-presale GET]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

/** POST — partner self-serve create (pending admin approval). */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const access = await requirePartnerOrAdminForPresale(session.wallet)
    if (!access.ok) return access.response

    const ip = getClientIp(request)
    const rl = rateLimit(`partner-oc-presale-create:${session.wallet}:${ip}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests — wait a minute.' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const slug = normalizeOwlCenterPresaleSlug(typeof body.slug === 'string' ? body.slug : '')
    if (!slug) {
      return NextResponse.json(
        { error: 'slug must be lowercase letters, numbers, and hyphens' },
        { status: 400 }
      )
    }

    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
    if (!displayName) {
      return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
    }

    const partnerRaw = typeof body.partner_wallet === 'string' ? body.partner_wallet : session.wallet
    const partnerWallet = normalizeSolanaWalletAddress(partnerRaw)
    if (!partnerWallet) {
      return NextResponse.json({ error: 'partner_wallet must be a valid Solana address' }, { status: 400 })
    }

    const themeBody = body.theme && typeof body.theme === 'object' ? (body.theme as Record<string, unknown>) : {}
    const caps = normalizeOwlCenterPresaleCaps({
      max_spots_per_purchase: parseOwlCenterPresaleMaxSpotsPerPurchase(body.max_spots_per_purchase),
      max_credits_per_wallet: parseOwlCenterPresaleMaxCreditsPerWallet(body.max_credits_per_wallet),
    })

    const creator = normalizeSolanaWalletAddress(session.wallet)!
    const tenant = await insertOwlCenterPresaleTenant({
      slug,
      display_name: displayName,
      headline: typeof body.headline === 'string' ? body.headline : null,
      description: typeof body.description === 'string' ? body.description : null,
      // Legacy column: keep equal to partner receive wallet.
      treasury_wallet: partnerWallet,
      partner_wallet: partnerWallet,
      is_enabled: false,
      is_live: false,
      approval_status: 'pending',
      created_by_wallet: creator,
      unit_price_usdc: parseOwlCenterPresalePriceUsdc(body.unit_price_usdc),
      presale_supply: parseOwlCenterPresaleSupply(body.presale_supply),
      max_spots_per_purchase: caps.max_spots_per_purchase,
      max_credits_per_wallet: caps.max_credits_per_wallet,
      preview_images: sanitizePreviewImagesInput(body.preview_images),
      theme: {
        primary: parseHexColor(themeBody.primary, OWL_CENTER_PRESALE_DEFAULT_THEME.primary),
        accent: parseHexColor(themeBody.accent, OWL_CENTER_PRESALE_DEFAULT_THEME.accent),
        background: parseHexColor(themeBody.background, OWL_CENTER_PRESALE_DEFAULT_THEME.background),
        surface: parseHexColor(themeBody.surface, OWL_CENTER_PRESALE_DEFAULT_THEME.surface),
        muted: parseHexColor(themeBody.muted, OWL_CENTER_PRESALE_DEFAULT_THEME.muted),
      },
      updated_by_wallet: creator,
    })

    return NextResponse.json(
      {
        tenant: {
          ...tenant,
          sold: 0,
          remaining: tenant.presale_supply,
          presale_url: owlCenterPresalePublicPath(tenant.slug),
        },
        message: 'Submitted for Owltopia admin approval. You can gift credits after approval.',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[partners/owl-center-presale POST]', error)
    const msg = safeErrorMessage(error)
    if (msg.includes('owl_center_presale_tenants_slug_unique') || msg.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: 'That slug is already in use' }, { status: 409 })
    }
    if (msg.includes('approval_status') || msg.includes('created_by_wallet') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Partner presale tables need migration 215_owl_center_partner_presale_ready.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
