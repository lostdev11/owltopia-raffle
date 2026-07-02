import { NextRequest, NextResponse } from 'next/server'

import {
  deletePresaleDelegation,
  getPresaleDelegationBySourceWallet,
  listPresaleDelegations,
  upsertPresaleDelegation,
} from '@/lib/db/gen2-presale-delegations'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * Gen2 PRESALE "switch wallet for mint" delegations (migration 180).
 *
 * Maps a presale credit holder's wallet (source_wallet) to a different mint_wallet so the holder
 * can redeem presale credits from a safe wallet without moving purchase records.
 *
 * After editing, update the on-chain presale merkle root if mint is live:
 *   npx tsx --env-file=.env.local scripts/inspect-gen2-allowlist.ts presale
 * then run the guard update with the new root.
 */

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session
  const delegations = await listPresaleDelegations()
  return NextResponse.json({ delegations })
}

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const rl = rateLimit(`presale-delegations:${session.wallet}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_wallet?: string
    mint_wallet?: string
    note?: string
  }

  const source = body.source_wallet ? normalizeSolanaWalletAddress(body.source_wallet.trim()) : null
  const mint = body.mint_wallet ? normalizeSolanaWalletAddress(body.mint_wallet.trim()) : null
  if (!source) return NextResponse.json({ error: 'Invalid source wallet' }, { status: 400 })
  if (!mint) return NextResponse.json({ error: 'Invalid mint wallet' }, { status: 400 })

  const result = await upsertPresaleDelegation({
    source_wallet: source,
    mint_wallet: mint,
    note: body.note ?? null,
    created_by: session.wallet,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const sourceBalance = await getBalanceByWallet(source)
  const available = sourceBalance?.available_mints ?? 0

  console.info('[admin/presale-delegations] upsert', {
    admin: session.wallet,
    source,
    mint,
    source_available_mints: available,
  })

  return NextResponse.json({
    ok: true,
    delegation: result.delegation,
    source_available_mints: available,
    warning:
      available > 0
        ? null
        : 'Source wallet currently has 0 presale credits — the mint wallet will only be eligible while the source still has credits.',
  })
}

export async function DELETE(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const rl = rateLimit(`presale-delegations:${session.wallet}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = (await request.json().catch(() => ({}))) as { source_wallet?: string }
  const source = body.source_wallet ? normalizeSolanaWalletAddress(body.source_wallet.trim()) : null
  if (!source) return NextResponse.json({ error: 'Invalid source wallet' }, { status: 400 })

  const existing = await getPresaleDelegationBySourceWallet(source)
  if (!existing) {
    return NextResponse.json({ error: 'No delegation for that source wallet' }, { status: 404 })
  }

  const result = await deletePresaleDelegation(source)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  console.info('[admin/presale-delegations] delete', { admin: session.wallet, source })
  return NextResponse.json({ ok: true, deleted: result.deleted })
}
