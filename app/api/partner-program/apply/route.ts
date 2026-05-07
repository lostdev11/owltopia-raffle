import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { insertPartnerProgramApplication } from '@/lib/db/partner-program-applications'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const VALID_TIERS = new Set(['$0_partner', 'partner_pro', 'white_label'])

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`partner-apply:${ip}`, 8, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many submissions. Please wait a minute and try again.' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const project_name = typeof body.project_name === 'string' ? body.project_name.trim() : ''
    const contact_name = typeof body.contact_name === 'string' ? body.contact_name.trim() : ''
    const contact_handle = typeof body.contact_handle === 'string' ? body.contact_handle.trim() : ''
    const wallet_address_raw = typeof body.wallet_address === 'string' ? body.wallet_address : ''
    const wallet_address = normalizeSolanaWalletAddress(wallet_address_raw)
    const interested_tier = typeof body.interested_tier === 'string' ? body.interested_tier.trim() : ''
    const details = typeof body.details === 'string' ? body.details.trim() : ''

    if (!project_name || project_name.length > 120) {
      return NextResponse.json({ error: 'Project name is required (max 120 chars).' }, { status: 400 })
    }
    if (!contact_handle || contact_handle.length > 120) {
      return NextResponse.json({ error: 'Discord or Telegram handle is required (max 120 chars).' }, { status: 400 })
    }
    if (!wallet_address) {
      return NextResponse.json({ error: 'Wallet address must be a valid Solana address.' }, { status: 400 })
    }
    if (!VALID_TIERS.has(interested_tier)) {
      return NextResponse.json({ error: 'Please choose a valid partner tier.' }, { status: 400 })
    }
    if (details.length > 2000) {
      return NextResponse.json({ error: 'Details are too long (max 2000 chars).' }, { status: 400 })
    }

    const row = await insertPartnerProgramApplication({
      project_name,
      contact_name: contact_name || null,
      contact_handle,
      wallet_address,
      interested_tier,
      details: details || null,
    })
    return NextResponse.json({ ok: true, id: row.id })
  } catch (error) {
    console.error('[POST /api/partner-program/apply]', error)
    return NextResponse.json({ error: 'Could not submit application right now.' }, { status: 500 })
  }
}
