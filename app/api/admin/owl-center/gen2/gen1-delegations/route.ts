import { NextRequest, NextResponse } from 'next/server'

import {
  deleteDelegation,
  getDelegationBySourceWallet,
  listDelegations,
  upsertDelegation,
} from '@/lib/db/gen2-gen1-delegations'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwltopiaGen1Snapshot } from '@/lib/owl-center/owltopia-gen1'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Gen2 AIRDROP "switch wallet for mint" delegations (migration 170).
 *
 * Maps a Gen1 holder's wallet (source_wallet) to a different mint_wallet so the holder
 * can claim their free Gen2 from another wallet without transferring the Gen1 NFT.
 *
 * GET    — list delegations.
 * POST   — { source_wallet, mint_wallet, note? } add/update a mapping.
 * DELETE — { source_wallet } remove a mapping.
 *
 * After editing, the Gen1 snapshot picks up delegations automatically when re-taken
 * (POST /api/admin/owl-center/gen2/gen1-snapshot). If the on-chain merkle root is
 * already frozen, re-take the snapshot and run `sugar guard update`.
 */

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session
  const delegations = await listDelegations()
  return NextResponse.json({ delegations })
}

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const rl = rateLimit(`gen1-delegations:${session.wallet}`, 20, 60_000)
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

  const result = await upsertDelegation({
    source_wallet: source,
    mint_wallet: mint,
    note: body.note ?? null,
    created_by: session.wallet,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  // Live source holdings (informational — warn the admin if the source holds 0 Gen1).
  let source_gen1_count = 0
  let source_is_holder = false
  try {
    const snapshot = await getOwltopiaGen1Snapshot(source)
    source_gen1_count = snapshot.gen1_nft_count
    source_is_holder = snapshot.is_holder
  } catch {
    // Helius unavailable — leave defaults; the live check still runs at mint time.
  }

  console.info('[admin/gen1-delegations] upsert', {
    admin: session.wallet,
    source,
    mint,
    source_gen1_count,
  })

  return NextResponse.json({
    ok: true,
    delegation: result.delegation,
    source_gen1_count,
    source_is_holder,
    warning: source_is_holder
      ? null
      : 'Source wallet currently holds 0 Gen1 NFTs — the mint wallet will only be eligible while the source actually holds Gen1.',
  })
}

export async function DELETE(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const rl = rateLimit(`gen1-delegations:${session.wallet}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = (await request.json().catch(() => ({}))) as { source_wallet?: string }
  const source = body.source_wallet ? normalizeSolanaWalletAddress(body.source_wallet.trim()) : null
  if (!source) return NextResponse.json({ error: 'Invalid source wallet' }, { status: 400 })

  const existing = await getDelegationBySourceWallet(source)
  if (!existing) {
    return NextResponse.json({ error: 'No delegation for that source wallet' }, { status: 404 })
  }

  const result = await deleteDelegation(source)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  console.info('[admin/gen1-delegations] delete', { admin: session.wallet, source })
  return NextResponse.json({ ok: true, deleted: result.deleted })
}
