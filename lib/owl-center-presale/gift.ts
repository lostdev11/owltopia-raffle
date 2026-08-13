import { NextResponse } from 'next/server'

import { getOwlCenterPresaleMaxGiftQuantity } from '@/lib/owl-center-presale/constants'
import { getOwlCenterPresaleBalanceByWallet } from '@/lib/owl-center-presale/db'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export async function giftOwlCenterPresaleCredits(params: {
  tenant: OwlCenterPresaleTenantAdmin
  actorWallet: string
  recipientWallet: string
  quantity: number
}): Promise<
  | { ok: true; balance: Awaited<ReturnType<typeof getOwlCenterPresaleBalanceByWallet>> }
  | { ok: false; status: number; error: string; code?: string }
> {
  const actorNorm = normalizeSolanaWalletAddress(params.actorWallet)
  const recipient = normalizeSolanaWalletAddress(params.recipientWallet)
  if (!actorNorm) return { ok: false, status: 401, error: 'Invalid actor wallet' }
  if (!recipient) return { ok: false, status: 400, error: 'Invalid recipient wallet' }

  const maxGift = getOwlCenterPresaleMaxGiftQuantity()
  const qty = params.quantity
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > maxGift) {
    return { ok: false, status: 400, error: `quantity must be an integer from 1 to ${maxGift}` }
  }

  const db = getSupabaseAdmin()
  const { error } = await db.rpc('gift_owl_center_presale_mints', {
    p_tenant_id: params.tenant.id,
    p_actor_wallet: actorNorm,
    p_recipient_wallet: recipient,
    p_quantity: qty,
    p_max_credits_per_wallet: params.tenant.max_credits_per_wallet,
  })

  if (error) {
    const msg = error.message || ''
    if (msg.includes('owl_center_presale_wallet_cap_exceeded')) {
      return {
        ok: false,
        status: 409,
        code: 'wallet_cap',
        error: `Recipient would exceed ${params.tenant.max_credits_per_wallet} total credits for this wallet.`,
      }
    }
    if (msg.includes('does not exist') || msg.includes('42883')) {
      return {
        ok: false,
        status: 503,
        error: 'Gift RPC missing. Apply Supabase migration 213_owl_center_partner_presale_ready.sql.',
      }
    }
    console.error('gift_owl_center_presale_mints:', error)
    return { ok: false, status: 500, error: error.message || 'Gift failed' }
  }

  console.info(
    JSON.stringify({
      tag: 'owl_center_presale_gift',
      tenantId: params.tenant.id,
      slug: params.tenant.slug,
      actorWallet: actorNorm,
      recipientWallet: recipient,
      quantity: qty,
      ts: new Date().toISOString(),
    })
  )

  const balance = await getOwlCenterPresaleBalanceByWallet(params.tenant.id, recipient)
  return { ok: true, balance }
}

export function giftErrorResponse(
  result: Extract<Awaited<ReturnType<typeof giftOwlCenterPresaleCredits>>, { ok: false }>
): NextResponse {
  return NextResponse.json(
    { error: result.error, ...(result.code ? { code: result.code } : {}) },
    { status: result.status }
  )
}
